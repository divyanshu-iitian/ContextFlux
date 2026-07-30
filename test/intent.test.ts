import { describe, expect, it } from "vitest";
import { mentionedPaths, resolveIntent } from "../src/intent.js";

describe("resolveIntent", () => {
  it("routes workflow signals to specialized retrieval modes", () => {
    expect(resolveIntent('Traceback: File "src/auth.py", line 42')).toBe("trace2code");
    expect(resolveIntent("Address this code review comment in src/auth.ts")).toBe(
      "comment2context",
    );
    expect(resolveIntent("Show the blast radius of renaming login")).toBe("edit2ripple");
    expect(resolveIntent("Add regression tests for login")).toBe("code2test");
    expect(resolveIntent("Explain the authentication architecture")).toBe("explore");
  });

  it("honors an explicit mode and extracts repository paths", () => {
    expect(resolveIntent("anything", "edit2ripple")).toBe("edit2ripple");
    expect(mentionedPaths("Review src/auth.ts and tests/auth.test.ts:12")).toEqual([
      "src/auth.ts",
      "tests/auth.test.ts",
    ]);
  });
});
