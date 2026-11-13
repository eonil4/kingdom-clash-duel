import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  collectDirsUpToDepth,
  dirExistsAndNotEmpty,
  loadDefaultModel,
  processFolder,
  resolveDefaultDir,
  runClanClash,
  runNode,
  runWikiTablesAfterConvert,
} from "../../scripts/llm/clan-clash.mjs";

const dirs: string[] = [];

async function tmpDir(prefix = "kc-clan-clash-") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function fakeRun(result: number | ((args: string[]) => number) = 0) {
  const calls: { args: string[]; options?: { env?: NodeJS.ProcessEnv; logFd?: number } }[] = [];
  const run = async (
    args: string[],
    options?: { env?: NodeJS.ProcessEnv; logFd?: number },
  ) => {
    calls.push({ args, options });
    return typeof result === "function" ? result(args) : result;
  };
  return { run, calls };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe("discovery helpers", () => {
  it("loads the configured default model", () => {
    expect(loadDefaultModel()).toMatch(/\S/);
  });

  it("resolves the latest dated clan-clash folder", async () => {
    const root = await tmpDir();
    await fs.mkdir(path.join(root, "2026-01-01"));
    await fs.mkdir(path.join(root, "2026-01-02"));
    await fs.mkdir(path.join(root, "not-a-date"));
    expect(resolveDefaultDir(root)).toBe(path.join("data", "clan_clash", "2026-01-02"));

    const empty = await tmpDir();
    expect(resolveDefaultDir(empty)).toBeUndefined();
    expect(resolveDefaultDir(path.join(empty, "missing"))).toBeUndefined();
  });

  it("collects directories down to the recursion depth", async () => {
    const root = await tmpDir();
    await fs.mkdir(path.join(root, "a", "x"), { recursive: true });
    await fs.mkdir(path.join(root, "b"));
    await fs.mkdir(path.join(root, ".hidden"));

    expect(collectDirsUpToDepth(root, 0)).toEqual([root]);
    expect(collectDirsUpToDepth(root, 1)).toEqual([
      root,
      path.join(root, "a"),
      path.join(root, "b"),
    ]);
    expect(collectDirsUpToDepth(root, 2)).toContain(path.join(root, "a", "x"));
    expect(collectDirsUpToDepth(root, 2)).not.toContain(path.join(root, ".hidden"));
  });

  it("detects non-empty directories", async () => {
    const root = await tmpDir();
    const empty = path.join(root, "empty");
    const full = path.join(root, "full");
    await fs.mkdir(empty);
    await fs.mkdir(full);
    await fs.writeFile(path.join(full, "a.png"), "");
    const file = path.join(root, "file.txt");
    await fs.writeFile(file, "");

    expect(dirExistsAndNotEmpty(empty)).toBe(false);
    expect(dirExistsAndNotEmpty(full)).toBe(true);
    expect(dirExistsAndNotEmpty(file)).toBe(false);
    expect(dirExistsAndNotEmpty(path.join(root, "missing"))).toBe(false);
  });
});

describe("runNode", () => {
  it("tees stdout and returns the exit code", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const code = await runNode(["-e", "process.stdout.write('hello'); process.exit(0)"]);
    expect(code).toBe(0);
    expect(write.mock.calls.some(([chunk]) => String(chunk).includes("hello"))).toBe(true);
  });

  it("returns non-zero exit codes", async () => {
    expect(await runNode(["-e", "process.exit(3)"])).toBe(3);
  });
});

describe("wiki helpers", () => {
  it("runs formation extraction and wiki tables for clan folders", async () => {
    const root = await tmpDir();
    const clan = path.join(root, "clan");
    const duels = path.join(root, "clan_duels");
    await fs.mkdir(clan, { recursive: true });
    await fs.mkdir(duels, { recursive: true });
    await fs.writeFile(path.join(clan, "000_000_005-Name.png"), "");
    await fs.writeFile(path.join(duels, "duel.jpg"), "");
    const { run, calls } = fakeRun(0);

    expect(await runWikiTablesAfterConvert(root, undefined, {}, run)).toBe(0);

    expect(path.basename(calls[0].args[0])).toBe("generate-wiki-table.mjs");
    expect(calls[0].args).toContain("webp");
    const formation = calls.find((c) => path.basename(c.args[0]) === "llm-formation-extract.mjs");
    expect(formation?.args[1]).toContain("000_000_005-Name.png");
    expect(formation?.options?.logFd).toBeTypeOf("number");

    const clanWiki = calls.find(
      (c) => path.basename(c.args[0]) === "generate-wiki-table.mjs" && c.args.includes("jpg"),
    );
    expect(clanWiki?.args[1]).toContain("clan");
    expect(calls.at(-1)?.args[1]).toContain("clan_duels");
    await expect(fs.access(path.join(clan, "log.txt"))).resolves.toBeUndefined();
  });

  it("skips missing clan folders and stops on a failed wiki run", async () => {
    const root = await tmpDir();
    const { run, calls } = fakeRun(0);
    expect(await runWikiTablesAfterConvert(root, undefined, {}, run)).toBe(0);
    expect(calls).toHaveLength(1);

    const failing = fakeRun(5);
    expect(await runWikiTablesAfterConvert(root, undefined, {}, failing.run)).toBe(5);
    expect(failing.calls).toHaveLength(1);
  });

  it("continues after a failed formation extractor and stops on failing clan/duel wikis", async () => {
    const root = await tmpDir();
    const clan = path.join(root, "clan");
    const duels = path.join(root, "clan_duels");
    await fs.mkdir(clan, { recursive: true });
    await fs.mkdir(duels, { recursive: true });
    await fs.writeFile(path.join(clan, "000_000_005-Name.png"), "");
    await fs.writeFile(path.join(duels, "duel.jpg"), "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const formationFails = fakeRun((args) =>
      path.basename(args[0]) === "llm-formation-extract.mjs" ? 1 : 0,
    );
    expect(await runWikiTablesAfterConvert(root, undefined, {}, formationFails.run)).toBe(0);
    expect(warn).toHaveBeenCalled();

    const clanWikiFails = fakeRun((args) =>
      path.basename(args[0]) === "generate-wiki-table.mjs" && args.includes("jpg") ? 3 : 0,
    );
    expect(await runWikiTablesAfterConvert(root, undefined, {}, clanWikiFails.run)).toBe(3);

    const duelsOnly = await tmpDir();
    const duelsDir = path.join(duelsOnly, "clan_duels");
    await fs.mkdir(duelsDir, { recursive: true });
    await fs.writeFile(path.join(duelsDir, "duel.jpg"), "");
    const duelsFail = fakeRun((args) =>
      String(args[1]).includes("clan_duels") && args.includes("jpg") ? 4 : 0,
    );
    expect(await runWikiTablesAfterConvert(duelsOnly, undefined, {}, duelsFail.run)).toBe(4);
  });

});

describe("processFolder and runClanClash", () => {
  function job(dirAbs: string, overrides = {}) {
    return {
      folderAbs: dirAbs,
      convertScript: "/repo/scripts/llm/convert.mjs",
      convertMode: "crops" as const,
      passthrough: ["--force"],
      full: false,
      env: {},
      logFd: undefined,
      ...overrides,
    };
  }

  it("runs only convert without --full and stops on failure", async () => {
    const root = await tmpDir();
    const ok = fakeRun(0);
    expect(await processFolder(job(root), ok.run)).toBe(0);
    expect(ok.calls).toHaveLength(1);
    expect(ok.calls[0].args).toEqual([
      "/repo/scripts/llm/convert.mjs",
      root,
      "--mode",
      "crops",
      "--force",
    ]);

    const failing = fakeRun(2);
    expect(await processFolder(job(root), failing.run)).toBe(2);
    expect(failing.calls).toHaveLength(1);
  });

  it("runs wiki folders after a successful --full convert", async () => {
    const root = await tmpDir();
    const { run, calls } = fakeRun(0);
    expect(await processFolder(job(root, { full: true }), run)).toBe(0);
    expect(calls).toHaveLength(2);
    expect(path.basename(calls[1].args[0])).toBe("generate-wiki-table.mjs");
  });

  it("converts every folder down to the depth and returns the worst code", async () => {
    const root = await tmpDir();
    await fs.mkdir(path.join(root, "sub1"));
    const { run, calls } = fakeRun(0);
    const code = await runClanClash(
      {
        dirAbs: root,
        script: "convert",
        model: "test-model",
        recursive: 1,
        passthrough: ["--force"],
      },
      { run, env: {} },
    );

    expect(code).toBe(0);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(path.basename(call.args[0])).toBe("convert.mjs");
      expect(call.args).toContain("screenshot");
      expect(call.options?.env?.LLM_MODEL).toBe("test-model");
    }
    await expect(fs.access(path.join(root, "log.txt"))).resolves.toBeUndefined();

    const failing = fakeRun(7);
    expect(
      await runClanClash({ dirAbs: root, model: "m" }, { run: failing.run, env: {} }),
    ).toBe(7);
  });

  it("runs wiki tables after convert when --full is set", async () => {
    const root = await tmpDir();
    const { run, calls } = fakeRun(0);
    expect(await runClanClash({ dirAbs: root, full: true, model: "m" }, { run, env: {} })).toBe(0);
    expect(calls).toHaveLength(2);
    expect(path.basename(calls[1].args[0])).toBe("generate-wiki-table.mjs");
  });

  it("uses LLM_MODEL from the supplied environment", async () => {
    const root = await tmpDir();
    const { run, calls } = fakeRun(0);
    await runClanClash({ dirAbs: root }, { run, env: { LLM_MODEL: "env-model" } });
    expect(calls[0].options?.env?.LLM_MODEL).toBe("env-model");
  });
});
