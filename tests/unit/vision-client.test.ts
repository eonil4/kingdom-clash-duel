import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import sharp from "sharp";
import {
  DEFAULT_HOST,
  createVisionTarget,
  cropRoiToPngBuffer,
  isInvokedDirectly,
  mimeForImagePath,
  parseExtractCliArgs,
  parseJsonFromLlm,
  parsePowerValue,
  reconcileDataJsonWithCanonicalFiles,
  resolveHost,
  resolveUserPromptImage,
  resolveVisionModel,
  runVisionExtract,
  upsertDataJsonForImage,
} from "../../scripts/llm/vision-client.mjs";

sharp.cache(false);

const dirs: string[] = [];
const savedEnv = {
  LLM_MODEL: process.env.LLM_MODEL,
  LLM_HOST: process.env.LLM_HOST,
  LM_API_TOKEN: process.env.LM_API_TOKEN,
};

async function tmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-vision-"));
  dirs.push(dir);
  return dir;
}

async function sampleImage() {
  const dir = await tmpDir();
  const file = path.join(dir, "shot.png");
  await sharp({ create: { width: 120, height: 240, channels: 3, background: "#333" } })
    .png()
    .toFile(file);
  return file;
}

function jsonResponse(payload: unknown, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Server Error",
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response;
}

function chatMessage(content: string) {
  return { output: [{ type: "message", content }] };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe("small helpers", () => {
  it("maps extensions to mime types", () => {
    expect(mimeForImagePath("a.JPG")).toBe("image/jpeg");
    expect(mimeForImagePath("a.jpeg")).toBe("image/jpeg");
    expect(mimeForImagePath("a.webp")).toBe("image/webp");
    expect(mimeForImagePath("a.gif")).toBe("image/gif");
    expect(mimeForImagePath("a.png")).toBe("image/png");
  });

  it("parses LLM JSON from prose and fences", () => {
    expect(parseJsonFromLlm('ok: {"name":"A"}')).toEqual({ name: "A" });
    expect(parseJsonFromLlm('```json\n{"power":5}\n```')).toEqual({ power: 5 });
    expect(() => parseJsonFromLlm("no json")).toThrow("did not contain a JSON object");
  });

  it("parses and validates power values", () => {
    expect(parsePowerValue(12.6)).toBe(13);
    expect(parsePowerValue("1 234 567")).toBe(1234567);
    expect(() => parsePowerValue("abc")).toThrow("Invalid power");
    expect(() => parsePowerValue(0)).toThrow("Invalid power");
    expect(() => parsePowerValue(1_000_000_000)).toThrow("Invalid power");
  });

  it("resolves host and prompt fallbacks", () => {
    delete process.env.LLM_HOST;
    expect(resolveHost(undefined)).toBe(DEFAULT_HOST);
    expect(resolveHost("http://host")).toBe("http://host");
    process.env.LLM_HOST = "http://env-host";
    expect(resolveHost(undefined)).toBe("http://env-host");

    expect(resolveUserPromptImage(" direct ", "fb")).toBe(" direct ");
    expect(resolveUserPromptImage({ image: " img " }, "fb")).toBe(" img ");
    expect(resolveUserPromptImage({ image: { prompt: " p " } }, "fb")).toBe(" p ");
    expect(resolveUserPromptImage({}, "fb")).toBe("fb");
    expect(resolveUserPromptImage(null, "fb")).toBe("fb");
  });

  it("detects direct invocation and parses extract args", () => {
    expect(isInvokedDirectly(import.meta.url)).toBe(false);
    expect(parseExtractCliArgs(["--", "x.png", "--no-clear-cache"])).toEqual({
      imagePath: "x.png",
      clearCache: false,
    });
    expect(parseExtractCliArgs(["--clear-cache", "y.png"])).toEqual({
      imagePath: "y.png",
      clearCache: true,
    });
  });
});

describe("resolveVisionModel", () => {
  const options = { modelFallback: "fallback", hints: ["qwen"] };

  it("prefers explicit and env models without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await resolveVisionModel("h", "  m1 ", options)).toBe("m1");
    process.env.LLM_MODEL = " env-model ";
    expect(await resolveVisionModel("h", undefined, options)).toBe("env-model");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prefers a loaded vision model matching a hint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          models: [
            { key: "cpu-model", capabilities: { vision: false }, loaded_instances: [{}] },
            { key: "qwen3-vl-8b", capabilities: { vision: true }, loaded_instances: [{}] },
            { key: "qwen3-vl-4b", capabilities: { vision: true }, loaded_instances: [] },
          ],
        }),
      ),
    );
    expect(await resolveVisionModel("h", undefined, options)).toBe("qwen3-vl-8b");
  });

  it("falls back to any vision model, then the configured fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          models: [{ key: "other-vision", capabilities: { vision: true }, loaded_instances: [] }],
        }),
      ),
    );
    expect(await resolveVisionModel("h", undefined, options)).toBe("other-vision");

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, { ok: false, status: 503 })));
    expect(await resolveVisionModel("h", undefined, options)).toBe("fallback");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await resolveVisionModel("h", undefined, options)).toBe("fallback");
  });

  it("throws when no vision model is available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ models: [{ key: "cpu", capabilities: { vision: false } }] }),
      ),
    );
    await expect(resolveVisionModel("h", undefined, options)).rejects.toThrow("No vision model");
  });
});

describe("createVisionTarget", () => {
  const descriptor = {
    targetKey: "enemy" as const,
    defaultModelFallback: "fallback",
    visionModelHints: ["qwen"],
    systemPromptFallback: "sys",
    fullPromptFallback: "full",
    nameFallback: { prompt: "name", roi: { x: 10, y: 10, width: 40, height: 20 } },
    powerFallback: { prompt: "power", roi: { x: 10, y: 50, width: 40, height: 20 } },
    normalizeFull: (data: Record<string, unknown>) => ({
      name: String(data.name ?? ""),
      power: Number(data.power ?? 0),
      ...(data.nameLatin ? { nameLatin: String(data.nameLatin) } : {}),
    }),
    normalizeName: (data: Record<string, unknown>) => ({
      name: String(data.name),
      language: data.language as string | undefined,
      nameLatin: data.nameLatin as string | undefined,
    }),
    normalizePower: (data: Record<string, unknown>) => ({ power: parsePowerValue(data.power) }),
  };

  it("extracts from a full screenshot", async () => {
    const file = await sampleImage();
    const fetchMock = vi.fn(async () =>
      jsonResponse(chatMessage('{"name":"Alpha","power":123}')),
    );
    vi.stubGlobal("fetch", fetchMock);
    const target = createVisionTarget(descriptor);

    const result = await target.extractFromScreenshot(file, {
      host: "http://host",
      model: "vision",
      clearCacheBeforeEachCall: false,
    });

    expect(result).toEqual({ name: "Alpha", power: 123 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ model: "vision", temperature: 0 });
    expect(body.input[1].data_url).toMatch(/^data:image\/png;base64,/);
  });

  it("extracts from name and power crops", async () => {
    const file = await sampleImage();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ output: '{"name":"Бабка","language":"ru"}' }))
      .mockResolvedValueOnce(jsonResponse(chatMessage('{"power":"1 234"}')));
    vi.stubGlobal("fetch", fetchMock);
    const target = createVisionTarget(descriptor);

    const result = await target.extractFromNamePowerCrops(file, {
      host: "http://host",
      model: "vision",
      clearCacheBeforeEachCall: false,
    });

    expect(result).toEqual({ name: "Бабка", power: 1234 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(target.resolveModel("h", "chosen")).resolves.toBe("chosen");
    expect(target.resolveUserPromptImage()).toBeTypeOf("string");
    expect(target.resolveCropConfig("name")).toMatchObject({ prompt: expect.any(String) });
  });

  it("surfaces HTTP and transport errors", async () => {
    const file = await sampleImage();
    const target = createVisionTarget(descriptor);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "boom" }, { ok: false, status: 500 })),
    );
    await expect(
      target.extractFromScreenshot(file, { model: "vision", clearCacheBeforeEachCall: false }),
    ).rejects.toThrow("LM Studio HTTP 500");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }),
    );
    await expect(
      target.extractFromScreenshot(file, { model: "vision", clearCacheBeforeEachCall: false }),
    ).rejects.toThrow("timed out");

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ output: "" })));
    await expect(
      target.extractFromScreenshot(file, { model: "vision", clearCacheBeforeEachCall: false }),
    ).rejects.toThrow("empty message");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    await expect(
      target.extractFromScreenshot(file, { model: "vision", clearCacheBeforeEachCall: false }),
    ).rejects.toThrow("Cannot reach LM Studio");
  });
});

describe("ROI cropping", () => {
  it("crops a scaled ROI to PNG and rejects invalid ROIs", async () => {
    const file = await sampleImage();
    const buffer = await cropRoiToPngBuffer(file, { x: 10, y: 10, width: 80, height: 40 });
    const meta = await sharp(buffer).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBeGreaterThan(0);
    await expect(
      cropRoiToPngBuffer(file, { x: 0, y: 0, width: 0, height: 0 }),
    ).rejects.toThrow("Invalid ROI");
  });
});

describe("runVisionExtract", () => {
  function fakeTarget() {
    const calls: unknown[] = [];
    return {
      calls,
      async resolveModel(_host: string, model?: string) {
        return model ?? "resolved-model";
      },
      async extractFromScreenshot(file: string, options: unknown) {
        calls.push({ file, options });
        return { name: "Alpha", nameLatin: "Alpha", power: 123 };
      },
    };
  }

  it("extracts, writes data.json and appends the folder log", async () => {
    const dir = await tmpDir();
    const file = path.join(dir, "shot.png");
    await fs.writeFile(file, "x");
    const target = fakeTarget();
    const logs: string[] = [];
    const warns: string[] = [];

    const outcome = await runVisionExtract({
      argv: [file],
      target: target as never,
      logPerFolder: true,
      host: "http://h",
      model: "m",
      env: {},
      config: {},
      reconcile: async () => {},
      log: (line) => logs.push(String(line)),
      warn: (...args) => warns.push(args.join(" ")),
    });

    expect(outcome.result).toMatchObject({ power: 123 });
    expect(outcome.dataPath).toBe(path.join(dir, "data.json"));
    const entries = JSON.parse(await fs.readFile(path.join(dir, "data.json"), "utf8"));
    expect(entries["shot.png"]).toMatchObject({
      name: "Alpha",
      canonical: "000_000_123-Alpha.webp",
    });
    expect(await fs.readFile(path.join(dir, "log.txt"), "utf8")).toContain(
      "shot.png processed",
    );
    expect(logs.join("\n")).toContain("Model: m");
    expect(warns).toEqual([]);
  });

  it("skips already-recorded images and reports usage", async () => {
    const dir = await tmpDir();
    const file = path.join(dir, "shot.png");
    await fs.writeFile(file, "x");
    await fs.writeFile(
      path.join(dir, "data.json"),
      JSON.stringify({ "shot.png": { name: "X", power: 1 } }),
    );
    const target = fakeTarget();

    const skipped = await runVisionExtract({
      argv: [file],
      target: target as never,
      env: {},
      config: {},
      reconcile: async () => {},
      log: () => {},
    });

    expect(skipped).toMatchObject({ skipped: true });
    expect(target.calls).toHaveLength(0);
    expect(
      await runVisionExtract({ argv: [], target: target as never, env: {}, config: {} }),
    ).toEqual({ usage: true });
  });

  it("still returns the result when writing data.json fails", async () => {
    const dir = await tmpDir();
    const file = path.join(dir, "shot.png");
    await fs.writeFile(file, "x");
    const warns: string[] = [];

    const outcome = await runVisionExtract({
      argv: [file],
      target: fakeTarget() as never,
      env: {},
      config: {},
      reconcile: async () => {},
      upsert: async () => {
        throw new Error("disk full");
      },
      warn: (...args) => warns.push(args.join(" ")),
      log: () => {},
    });

    expect(outcome.result).toBeTruthy();
    expect(warns.join("\n")).toContain("disk full");
  });
});

describe("data.json persistence", () => {
  it("upserts entries per source image", async () => {
    const dir = await tmpDir();
    const first = path.join(dir, "a.png");
    const second = path.join(dir, "b.png");
    await upsertDataJsonForImage(
      first,
      { name: "A", nameLatin: "A", power: 5, language: null },
      12.4,
      "000_000_005-A.webp",
    );
    await upsertDataJsonForImage(
      second,
      { name: "B", nameLatin: "B", power: 6 },
      undefined,
      null,
    );
    const entries = JSON.parse(await fs.readFile(path.join(dir, "data.json"), "utf8"));
    expect(Object.keys(entries).sort()).toEqual(["a.png", "b.png"]);
    expect(entries["a.png"]).toMatchObject({
      name: "A",
      power: 5,
      processingMs: 12,
      canonical: "000_000_005-A.webp",
    });
    expect(entries["b.png"].processingMs).toBeNull();
  });

  it("re-keys stale entries whose canonical files exist", async () => {
    const dir = await tmpDir();
    await fs.writeFile(path.join(dir, "000_000_005-Name.webp"), "");
    await fs.writeFile(path.join(dir, "000_000_007-Other-2.webp"), "");
    await fs.writeFile(path.join(dir, "kept.png"), "");
    await fs.writeFile(
      path.join(dir, "data.json"),
      JSON.stringify({
        "old.png": { name: "Name", nameLatin: "Name", power: 5 },
        "stale.jpg": { name: "Other", nameLatin: "Other", power: 7 },
        "kept.png": { name: "Kept", nameLatin: "Kept", power: 8 },
      }),
    );

    await reconcileDataJsonWithCanonicalFiles(dir);

    const entries = JSON.parse(await fs.readFile(path.join(dir, "data.json"), "utf8"));
    expect(Object.keys(entries).sort()).toEqual([
      "000_000_005-Name.webp",
      "000_000_007-Other-2.webp",
      "kept.png",
    ]);
    expect(entries["000_000_005-Name.webp"]).toMatchObject({ name: "Name", power: 5 });
  });

  it("ignores missing or malformed data.json", async () => {
    const dir = await tmpDir();
    await reconcileDataJsonWithCanonicalFiles(dir);
    await fs.writeFile(path.join(dir, "data.json"), "not json");
    await reconcileDataJsonWithCanonicalFiles(dir);
  });
});
