import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { SourceFile } from "./types.js";

const execFileAsync = promisify(execFile);
const ALWAYS_IGNORE = new Set([
  ".git", ".hg", ".svn", ".contextflux", "node_modules", "vendor", "dist", "build",
  "coverage", ".next", ".nuxt", "target", "__pycache__", ".venv", "venv",
]);
const IGNORED_FILE = /(?:^|\/)(?:package-lock|pnpm-lock|yarn\.lock|Cargo\.lock|composer\.lock)$|\.min\.(?:js|css)$|(?:^|\/).*\.(?:png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|mp4|mp3)$/i;

async function gitFiles(root: string): Promise<string[] | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: root, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
    );
    return stdout.toString("utf8").split("\0").filter(Boolean);
  } catch {
    return undefined;
  }
}

async function walk(root: string, directory = root): Promise<string[]> {
  const output: string[] = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && ALWAYS_IGNORE.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(root, absolute));
    else if (entry.isFile()) output.push(path.relative(root, absolute).replaceAll("\\", "/"));
  }
  return output;
}

function isProbablyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_000));
  return sample.includes(0);
}

export async function discoverFiles(root: string, maxFileBytes: number): Promise<SourceFile[]> {
  const candidates = await gitFiles(root) ?? await walk(root);
  const output: SourceFile[] = [];
  for (const relative of candidates.sort()) {
    const normalized = relative.replaceAll("\\", "/");
    if (IGNORED_FILE.test(normalized)) continue;
    if (normalized.split("/").some((part) => ALWAYS_IGNORE.has(part))) continue;
    const absolutePath = path.resolve(root, normalized);
    const relativeToRoot = path.relative(root, absolutePath);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) continue;
    let stat;
    try {
      stat = await fs.lstat(absolutePath);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size === 0 || stat.size > maxFileBytes) {
      continue;
    }
    const handle = await fs.open(absolutePath, "r");
    const sample = Buffer.alloc(Math.min(stat.size, 8_000));
    try {
      await handle.read(sample, 0, sample.length, 0);
    } finally {
      await handle.close();
    }
    if (isProbablyBinary(sample)) continue;
    output.push({ path: normalized, absolutePath, bytes: stat.size, modifiedMs: stat.mtimeMs });
  }
  return output;
}

export async function changedPaths(root: string): Promise<Set<string>> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "-z"], {
      cwd: root,
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024,
    });
    const paths = stdout
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .map((entry: string) => entry.slice(3).split(" -> ").pop()!.replaceAll("\\", "/"));
    return new Set(paths);
  } catch {
    return new Set();
  }
}
