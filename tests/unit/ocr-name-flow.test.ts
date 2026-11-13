import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import sharp from "sharp";
import { ocrEnemyName } from "../../scripts/ocr/ocr-enemy-name.mjs";

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
