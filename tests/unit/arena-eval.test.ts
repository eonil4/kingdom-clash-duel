import { describe, expect, it } from "vitest";
import fs from "fs/promises";
import path from "path";
import { runArenaOcrEval } from "../../scripts/ocr/eval-arena-ocr.mjs";
import { WORKSPACE_ROOT } from "../../scripts/enemy-records.mjs";

describe("arena OCR fixture", () => {
  it("lists existing samples with positive power", async () => {
    const fixture = JSON.parse(
      await fs.readFile(
        path.join(WORKSPACE_ROOT, "tests/fixtures/arena-ocr/labels.json"),
        "utf8",
      ),
    );
    expect(fixture.images.length).toBeGreaterThanOrEqual(12);
    for (const image of fixture.images) {
      expect(image.name.trim()).not.toBe("");
      expect(image.power).toBeGreaterThan(0);
      await expect(fs.access(path.resolve(WORKSPACE_ROOT, image.path))).resolves.toBeUndefined();
    }
  });
});

describe("runArenaOcrEval", () => {
  const strategy = {
    async prepare() {},
    async dispose() {},
    async extract() {
      return { record: { name: "Gorkiy", nameLatin: "Gorkiy", power: 8104472 } };
    },
  };

  it("evaluates and reports, or reports empty sets", async () => {
    const labels = {
      images: [
        {
          path: "data/clan_clash/2026-11-06/Screenshot_2026.11.06_10.21.12.375.png",
          name: "Gorkiy",
          power: 8104472,
        },
      ],
    };
    const logs: string[] = [];
    const { summary } = await runArenaOcrEval([], {
      loadLabels: async () => labels,
      makeStrategy: () => strategy,
      log: (line) => logs.push(String(line)),
    });
    expect(summary?.samples).toBe(1);
    expect(summary?.nameOk).toBe(1);
    expect(logs.join("\n")).toContain("name exact: 1/1");

    const emptyLogs: string[] = [];
    const empty = await runArenaOcrEval([], {
      loadLabels: async () => ({ images: [] }),
      makeStrategy: () => strategy,
      log: (line) => emptyLogs.push(String(line)),
    });
    expect(empty.summary).toBeUndefined();
    expect(emptyLogs.at(-1)).toContain("no samples matched");
  });
});
