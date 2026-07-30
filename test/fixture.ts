import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export async function createFixtureRepository(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "contextflux-"));
  const files: Record<string, string> = {
    "src/session.ts": `
export interface Session {
  userId: string;
  expiresAt: number;
}

export function createSession(userId: string): Session {
  return { userId, expiresAt: Date.now() + 3_600_000 };
}
`,
    "src/auth.ts": `
import { createSession, type Session } from "./session.js";

export function login(email: string, password: string): Session {
  if (!email || !password) throw new Error("invalid credentials");
  return createSession(email);
}
`,
    "src/api.ts": `
import { login } from "./auth.js";

export function loginRoute(body: { email: string; password: string }) {
  return login(body.email, body.password);
}
`,
    "tests/auth.test.ts": `
import { describe, expect, it } from "vitest";
import { login } from "../src/auth.js";

describe("login", () => {
  it("rejects missing credentials", () => {
    expect(() => login("", "")).toThrow("invalid credentials");
  });
});
`,
    "config/auth.json": `{"sessionTtlSeconds": 3600}\n`,
    "README.md": "# Fixture application\n",
  };
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content.trimStart(), "utf8");
  }
  return root;
}

export async function removeFixtureRepository(root: string): Promise<void> {
  await fs.rm(root, { recursive: true, force: true });
}
