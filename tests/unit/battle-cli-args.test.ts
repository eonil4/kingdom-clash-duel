import { describe, expect, it } from "vitest";
import { parseArgs } from "../../scripts/battle/run-battle.mjs";
import { UsageError } from "../../scripts/cli.mjs";

describe("run-battle parseArgs", () => {
  it("reads the three positional paths", () => {
    expect(parseArgs(["attacker.json", "defender.json", "out.json"])).toMatchObject({
      attacker: "attacker.json",
      defender: "defender.json",
      output: "out.json",
    });
  });

  it("parses --seed and --config-dir in any order", () => {
    expect(
      parseArgs(["a.json", "b.json", "c.json", "--seed", "7", "--config-dir", "cfg"]),
    ).toMatchObject({ seed: 7, configDir: "cfg" });
    expect(parseArgs(["--seed", "3", "a.json", "b.json", "c.json"]).seed).toBe(3);
    expect(parseArgs(["a.json", "--config-dir=cfg2", "b.json", "c.json"]).configDir).toBe(
      "cfg2",
    );
  });

  it("ignores unknown flags", () => {
    expect(parseArgs(["--verbose", "a", "b", "c"]).attacker).toBe("a");
  });

  it("throws a UsageError when positionals are missing", () => {
    expect(() => parseArgs(["only.json"])).toThrow(UsageError);
    expect(() => parseArgs(["only.json"])).toThrow("Expected <attacker.json>");
  });
});
