import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { chunkFile } from "./chunker.js";
import { discoverFiles } from "./files.js";
import { buildRelations } from "./graph.js";
import { loadIndex, saveIndex } from "./store.js";
import { countTokens, languageFor } from "./text.js";
import { INDEX_VERSION, type EngineOptions, type IndexedFile, type IndexResult, type RepoIndex } from "./types.js";

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export async function buildIndex(options: EngineOptions = {}): Promise<IndexResult> {
  const startedAt = Date.now();
  const root = await fs.realpath(options.root ?? process.cwd());
  const previous = await loadIndex(root, options.cacheDirectory);
  const oldByPath = new Map(previous?.files.map((file) => [file.path, file]));
  const sources = await discoverFiles(root, options.maxFileBytes ?? 1_000_000);
  const files: IndexedFile[] = [];
  let added = 0;
  let changed = 0;
  let unchanged = 0;

  for (const source of sources) {
    const old = oldByPath.get(source.path);
    if (old && old.bytes === source.bytes && Math.trunc(old.modifiedMs) === Math.trunc(source.modifiedMs)) {
      files.push(old);
      unchanged += 1;
      continue;
    }
    const content = await fs.readFile(source.absolutePath, "utf8");
    const digest = hash(content);
    if (old?.hash === digest) {
      files.push({ ...old, modifiedMs: source.modifiedMs });
      unchanged += 1;
      continue;
    }
    const indexed: IndexedFile = {
      path: source.path,
      bytes: source.bytes,
      modifiedMs: source.modifiedMs,
      hash: digest,
      tokens: countTokens(content),
      language: languageFor(source.path),
      chunks: chunkFile(source.path, content),
    };
    files.push(indexed);
    if (old) changed += 1;
    else added += 1;
  }

  let nextId = 0;
  for (const file of files) {
    for (const chunk of file.chunks) chunk.id = nextId++;
  }
  const current = new Set(files.map((file) => file.path));
  const removed = [...oldByPath.keys()].filter((path) => !current.has(path)).length;
  const index: RepoIndex = {
    version: INDEX_VERSION,
    root,
    generatedAt: new Date().toISOString(),
    files,
    relations: buildRelations(files),
    totalTokens: files.reduce((sum, file) => sum + file.tokens, 0),
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  };
  await saveIndex(index, options.cacheDirectory);
  return { index, added, changed, removed, unchanged, durationMs: Date.now() - startedAt };
}
