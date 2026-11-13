import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import sharp from "sharp";
import {
  ocrEnemyName,
  refineEnemyNameWithTestFolderCrops,
  runNameCli,
} from "../../scripts/ocr/ocr-enemy-name.mjs";

sharp.cache(false);

const dirs: string[] = [];

async function sampleImage() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-ocr-flow-"));
  dirs.push(dir);
  const file = path.join(dir, "Screenshot.png");
  await sharp({ create: { width: 120, height: 240, channels: 3, background: "#222" } })
    .png()
    .toFile(file);
  return file;
}

function fakeWorker(
  responder: (call: number) => { text: string; confidence: number },
) {
  let call = 0;
  return {
    setParameters: vi.fn(async () => {}),
    recognize: vi.fn(async () => ({ data: responder(call++) })),
  };
}

function fakeRus() {
  return {
    setParameters: vi.fn(async () => {}),
    recognize: vi.fn(async () => ({ data: { text: "", confidence: 0 } })),
  };
}

const empty = { text: "", confidence: 0 };

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe("ocrEnemyName flow", () => {
  it("keeps a strong first pass and stops after four recognitions", async () => {
    const file = await sampleImage();
    const worker = fakeWorker((call) =>
      call === 0
        ? { text: "Clan|Fighter99", confidence: 90 }
        : { text: "junk", confidence: 5 },
    );
    const workerRus = fakeRus();

    const name = await ocrEnemyName(file, worker, workerRus);

    expect(name).toBe("Clan|Fighter99");
    expect(worker.recognize).toHaveBeenCalledTimes(4);
    expect(worker.setParameters).toHaveBeenCalledWith(
      expect.objectContaining({ tessedit_pageseg_mode: "8" }),
    );
    expect(workerRus.recognize).not.toHaveBeenCalled();
  });

  it("lets a primary-crop reading out-vote a one-off Cyrillic line", async () => {
    const file = await sampleImage();
    const worker = fakeWorker((call) => {
      if (call === 0) return { text: "Ailiec", confidence: 80 };
      if (call === 1) return { text: "Ailiec", confidence: 80 };
      if (call === 4) return { text: "Ailiec", confidence: 80 };
      if (call === 5) return { text: "сот аЖёст", confidence: 80 };
      return empty;
    });
    expect(await ocrEnemyName(file, worker, fakeRus())).toBe("Ailiec");
  });

  it("replaces a junk-shaped text winner with a clean primary reading", async () => {
    const file = await sampleImage();
    const worker = fakeWorker((call) => {
      if (call === 0) return { text: "Myxa", confidence: 80 };
      if (call === 4) return { text: "Myx г а", confidence: 80 };
      return empty;
    });
    expect(await ocrEnemyName(file, worker, fakeRus())).toBe("Myxa");
  });

  it("prefers a repeatedly-read Latin name over Cyrillic lookalikes", async () => {
    const file = await sampleImage();
    const worker = fakeWorker((call) => {
      if (call >= 4 && call <= 6) return { text: "Mazza", confidence: 80 };
      if (call === 7) return { text: "Махха", confidence: 80 };
      return empty;
    });
    expect(await ocrEnemyName(file, worker, fakeRus())).toBe("Mazza");
  });

  it("keeps a Cyrillic name when an all-caps Latin lookalike ties", async () => {
    const file = await sampleImage();
    const worker = fakeWorker((call) => {
      if (call >= 4 && call <= 5) return { text: "MCKAHAEP ZR", confidence: 80 };
      if (call >= 6 && call <= 7) return { text: "ИСКАНДЕР", confidence: 80 };
      return empty;
    });
    expect(await ocrEnemyName(file, worker, fakeRus())).toBe("ИСКАНДЕР");
  });

  it("keeps a multi-word candidate instead of falling back to the full image", async () => {
    const file = await sampleImage();
    const worker = fakeWorker((call) => {
      if (call === 4) return { text: "я Горький", confidence: 80 };
      if (call === 8) return { text: "GARBAGE NAME", confidence: 90 };
      return empty;
    });
    const workerRus = fakeRus();

    expect(await ocrEnemyName(file, worker, workerRus)).toBe("Горький");
    expect(worker.recognize).toHaveBeenCalledTimes(8);
  });

  it("strips a clipped label fragment from an arena candidate", async () => {
    const file = await sampleImage();
    const worker = fakeWorker((call) =>
      call === 4 ? { text: "hd Myasnik", confidence: 80 } : empty,
    );
    expect(await ocrEnemyName(file, worker, fakeRus())).toBe("Myasnik");
  });

  it("uses text-area candidates when the first pass is weak", async () => {
    const file = await sampleImage();
    const worker = fakeWorker((call) =>
      call === 4 ? { text: "Alfa|Beta", confidence: 80 } : empty,
    );
    const workerRus = fakeRus();

    const name = await ocrEnemyName(file, worker, workerRus);

    expect(name).toBe("Alfa|Beta");
    expect(worker.recognize).toHaveBeenCalledTimes(8);
    expect(worker.setParameters).toHaveBeenCalledWith(
      expect.objectContaining({ tessedit_pageseg_mode: "7" }),
    );
  });

  it("falls back to the full-image phrase when every candidate is weak", async () => {
    const file = await sampleImage();
    const worker = fakeWorker((call) =>
      call === 8
        ? { text: "VS\n000 123\nHuN MAG", confidence: 80 }
        : empty,
    );
    const workerRus = fakeRus();

    const name = await ocrEnemyName(file, worker, workerRus);

    expect(name).toBe("HuN MAG");
    expect(worker.recognize).toHaveBeenCalledTimes(9);
    expect(worker.setParameters).toHaveBeenLastCalledWith(
      expect.objectContaining({ tessedit_pageseg_mode: "11" }),
    );
  });

  it("prefers a top-right line over single-word lines", async () => {
    const file = await sampleImage();
    const worker = fakeWorker((call) =>
      call === 8
        ? {
            text: "Alpha\nBeta",
            confidence: 5,
            lines: [{ text: "HuN MAG", bbox: { x0: 1200, y0: 20 }, confidence: 90 }],
          }
        : empty,
    );
    const workerRus = fakeRus();

    expect(await ocrEnemyName(file, worker, workerRus)).toBe("HuN MAG");
  });

  it("falls back to a top-right word when no line matches", async () => {
    const file = await sampleImage();
    const worker = fakeWorker((call) =>
      call === 8
        ? {
            text: "Alpha",
            confidence: 5,
            words: [{ text: "Kilo", bbox: { x0: 1300, y0: 50 }, confidence: 80 }],
          }
        : empty,
    );
    const workerRus = fakeRus();

    expect(await ocrEnemyName(file, worker, workerRus)).toBe("Kilo");
  });

  it("runs the Latin repair pass for tight boxes and corrects the leading tag", async () => {
    const file = await sampleImage();
    const worker = fakeWorker((call) =>
      call >= 8 ? { text: "AulN | TOLDI", confidence: 90 } : empty,
    );
    const workerRus = fakeRus();

    const name = await ocrEnemyName(file, worker, workerRus, {
      nameBoxStyle: "tight",
    });

    expect(name).toBe("HuN|TOLDI");
    expect(worker.recognize).toHaveBeenCalledTimes(12);
    expect(worker.setParameters).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tessedit_pageseg_mode: "7",
        tessedit_char_whitelist: expect.not.stringMatching(/[А-Яа-я]/),
      }),
    );
  });
});

describe("runNameCli", () => {
  it("creates both workers, runs the OCR and terminates them", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-name-cli-"));
    dirs.push(dir);
    const file = path.join(dir, "shot.png");
    await fs.writeFile(file, "x");

    const workers: { lang: string; worker: { setParameters: any; terminate: any } }[] = [];
    const makeWorker = vi.fn(async (lang: string) => {
      const worker = { setParameters: vi.fn(async () => {}), terminate: vi.fn(async () => {}) };
      workers.push({ lang, worker });
      return worker;
    });
    const logs: string[] = [];
    const run = vi.fn(async () => "HuN|TOLDI");

    const code = await runNameCli([file], {
      makeWorker,
      run,
      log: (line) => logs.push(String(line)),
      error: () => {},
    });

    expect(code).toBe(0);
    expect(makeWorker).toHaveBeenCalledWith("eng+rus");
    expect(makeWorker).toHaveBeenCalledWith("rus");
    expect(logs).toEqual(["HuN|TOLDI"]);
    for (const { worker } of workers) {
      expect(worker.setParameters).toHaveBeenCalledWith({ preserve_interword_spaces: "1" });
      expect(worker.terminate).toHaveBeenCalled();
    }
    expect(await runNameCli([], { log: () => {}, error: () => {} })).toBe(1);
    expect(
      await runNameCli([path.join(dir, "missing.png")], { log: () => {}, error: () => {} }),
    ).toBe(1);
  });
});

describe("refineEnemyNameWithTestFolderCrops", () => {
  async function testFolder(files: Record<string, number | "tiny">) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kc-ocr-refine-"));
    dirs.push(root);
    const dir = path.join(root, "test");
    await fs.mkdir(dir, { recursive: true });
    for (const [name, spec] of Object.entries(files)) {
      const target = path.join(dir, name);
      if (spec === "tiny") {
        await sharp({ create: { width: 60, height: 120, channels: 3, background: "#444" } })
          .png()
          .toFile(target);
      } else {
        await fs.writeFile(target, Buffer.alloc(spec));
      }
    }
    return dir;
  }

  it("merges name OCR from small reference crops in test folders", async () => {
    const dir = await testFolder({
      "Screenshot_full.png": "tiny",
      "ref.png": "tiny",
      "001_000_000.png": "tiny",
      "big.png": 130_000,
    });
    const worker = fakeWorker(() => ({ text: String.raw`HuN\TOLDI`, confidence: 90 }));

    const name = await refineEnemyNameWithTestFolderCrops(
      dir,
      path.join(dir, "Screenshot_full.png"),
      "x",
      worker,
      fakeRus(),
    );

    expect(name).toBe(String.raw`HuN\TOLDI`);
  });

  it("keeps the preliminary name outside test folders or without usable crops", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "kc-ocr-refine-"));
    dirs.push(outside);
    const worker = fakeWorker(() => ({ text: "HuN | TOLDI", confidence: 90 }));
    expect(
      await refineEnemyNameWithTestFolderCrops(
        outside,
        path.join(outside, "a.png"),
        " Prelim ",
        worker,
        fakeRus(),
      ),
    ).toBe("Prelim");

    const onlyPrimary = await testFolder({ "Screenshot_full.png": "tiny", "test.png": "tiny" });
    expect(
      await refineEnemyNameWithTestFolderCrops(
        onlyPrimary,
        path.join(onlyPrimary, "Screenshot_full.png"),
        "Prelim",
        worker,
        fakeRus(),
      ),
    ).toBe("Prelim");
  });
});
