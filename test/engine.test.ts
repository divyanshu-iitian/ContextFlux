import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContextFlux } from "../src/engine.js";
import { createFixtureRepository, removeFixtureRepository } from "./fixture.js";

describe("ContextFlux", () => {
  let root: string;
  let flux: ContextFlux;

  beforeEach(async () => {
    root = await createFixtureRepository();
    flux = new ContextFlux({ root });
  });

  afterEach(async () => {
    await removeFixtureRepository(root);
  });

  it("indexes incrementally and builds import/test relations", async () => {
    const first = await flux.index();
    expect(first.added).toBe(6);
    expect(first.index.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "src/auth.ts",
          to: "tests/auth.test.ts",
          kind: "tested-by",
        }),
        expect.objectContaining({
          from: "src/auth.ts",
          to: "src/api.ts",
          kind: "imported-by",
        }),
      ]),
    );

    const cached = await flux.index();
    expect(cached.unchanged).toBe(6);
    await fs.appendFile(path.join(root, "src/auth.ts"), "\nexport const AUTH_VERSION = 2;\n");
    const changed = await flux.index();
    expect(changed.changed).toBe(1);
    expect(changed.unchanged).toBe(5);
  });

  it("routes code-to-test retrieval toward the regression test", async () => {
    const hits = await flux.search("Add regression tests for login in src/auth.ts", {
      intent: "auto",
      limit: 5,
    });
    expect(hits[0]?.intent).toBe("code2test");
    expect(hits[0]?.path).toBe("tests/auth.test.ts");
    expect(hits[0]?.signals).toContain("intent:test-file");
  });

  it("uses graph evidence for traces and edit ripple", async () => {
    const traceHits = await flux.search(
      "Error: invalid credentials\n    at login (src/auth.ts:5:30)",
      { limit: 5 },
    );
    expect(traceHits[0]?.intent).toBe("trace2code");
    expect(traceHits.slice(0, 3).map((hit) => hit.path)).toContain("src/auth.ts");

    const rippleHits = await flux.search("Show the blast radius of changing src/auth.ts", {
      limit: 6,
    });
    const ripplePaths = rippleHits.map((hit) => hit.path);
    expect(rippleHits[0]?.intent).toBe("edit2ripple");
    expect(ripplePaths).toContain("src/api.ts");
    expect(ripplePaths).toContain("tests/auth.test.ts");
  });

  it("never exceeds the requested context budget", async () => {
    const packet = await flux.context("Fix invalid credential handling in src/auth.ts", {
      budgetTokens: 256,
    });
    expect(packet.usedTokens).toBeLessThanOrEqual(256);
    expect(packet.sections.length).toBeGreaterThan(0);
    expect(packet.context).toContain("src/auth.ts");
    expect(packet.retrieval.families.length).toBeGreaterThan(1);
  });

  it("reports benchmark retrieval and budget metrics", async () => {
    const report = await flux.benchmark([
      {
        id: "code2test-login",
        task: "Add regression tests for login in src/auth.ts",
        intent: "code2test",
        goldFiles: ["tests/auth.test.ts"],
        budgetTokens: 2_000,
      },
      {
        id: "edit2ripple-auth",
        task: "Show affected files when changing src/auth.ts",
        intent: "edit2ripple",
        goldFiles: ["src/api.ts", "tests/auth.test.ts"],
        budgetTokens: 2_000,
      },
    ]);
    expect(report.cases).toBe(2);
    expect(report.meanReciprocalRank).toBeGreaterThanOrEqual(0.75);
    expect(report.recallAt5).toBe(1);
    expect(report.budgetedContextYield).toBe(1);
    expect(report.lexicalBaseline.meanReciprocalRank).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(report.liftOverLexical.meanReciprocalRank)).toBe(true);
  });
});
