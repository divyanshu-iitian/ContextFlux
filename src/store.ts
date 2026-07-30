import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { INDEX_VERSION, type RepoIndex } from "./types.js";

export function cachePath(root: string, cacheDirectory = ".contextflux"): string {
  return path.resolve(root, cacheDirectory, "index.json");
}

export async function loadIndex(root: string, cacheDirectory?: string): Promise<RepoIndex | undefined> {
  try {
    const value = JSON.parse(await fs.readFile(cachePath(root, cacheDirectory), "utf8")) as Partial<
      RepoIndex
    >;
    if (
      value.version !== INDEX_VERSION ||
      value.root !== root ||
      !Array.isArray(value.files) ||
      !Array.isArray(value.relations)
    ) {
      return undefined;
    }
    return value as RepoIndex;
  } catch {
    return undefined;
  }
}

export async function saveIndex(index: RepoIndex, cacheDirectory?: string): Promise<void> {
  const target = cachePath(index.root, cacheDirectory);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(index)}\n`, "utf8");
  await fs.rename(temporary, target);
}
