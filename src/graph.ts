import path from "node:path";
import { pathLooksLikeTest } from "./intent.js";
import type { FileRelation, IndexedFile } from "./types.js";

const SOURCE_EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".rb",
  ".php",
];
const CODE_EXTENSIONS = new Set(SOURCE_EXTENSIONS.filter(Boolean));
const RUNTIME_JS_EXTENSION = /\.(?:cjs|mjs|js|jsx)$/;

function withoutExtension(filePath: string): string {
  return filePath.replace(/\.[^.\/]+$/, "");
}

function importCandidates(from: string, specifier: string): string[] {
  const directory = path.posix.dirname(from);
  let base: string;
  if (specifier.startsWith(".")) {
    base = path.posix.normalize(path.posix.join(directory, specifier));
  } else {
    base = specifier
      .replace(/^crate::/, "")
      .replace(/^(?:self|super)::/, "")
      .replaceAll("::", "/")
      .replaceAll(".", "/");
  }
  const output: string[] = [];
  const bases = new Set([base]);
  if (RUNTIME_JS_EXTENSION.test(base)) {
    bases.add(base.replace(RUNTIME_JS_EXTENSION, ""));
  }
  for (const candidateBase of bases) {
    for (const extension of SOURCE_EXTENSIONS) {
      output.push(`${candidateBase}${extension}`);
      output.push(`${candidateBase}/index${extension}`);
      output.push(`${candidateBase}/mod${extension}`);
    }
  }
  return output;
}

function resolveImport(
  from: string,
  specifier: string,
  exactPaths: Set<string>,
  suffixPaths: Map<string, string[]>,
): string | undefined {
  for (const candidate of importCandidates(from, specifier)) {
    if (exactPaths.has(candidate)) return candidate;
    const suffixMatches = suffixPaths.get(candidate);
    if (suffixMatches?.length === 1) return suffixMatches[0];
  }
  return undefined;
}

function testStem(filePath: string): string {
  return path.posix
    .basename(withoutExtension(filePath).toLowerCase())
    .replace(/^(?:test_|spec_)/, "")
    .replace(/(?:_test|_spec|\.test|\.spec)$/, "");
}

export function buildRelations(files: IndexedFile[]): FileRelation[] {
  const exactPaths = new Set(files.map((file) => file.path));
  const suffixPaths = new Map<string, string[]>();
  for (const file of files) {
    const parts = file.path.split("/");
    for (let index = 0; index < parts.length; index += 1) {
      const suffix = parts.slice(index).join("/");
      suffixPaths.set(suffix, [...(suffixPaths.get(suffix) ?? []), file.path]);
    }
  }

  const relations = new Map<string, FileRelation>();
  const add = (from: string, to: string, kind: FileRelation["kind"]): void => {
    if (from === to) return;
    relations.set(`${from}\0${to}\0${kind}`, { from, to, kind });
  };

  for (const file of files) {
    const imports = new Set(file.chunks.flatMap((chunk) => chunk.imports));
    for (const specifier of imports) {
      const target = resolveImport(file.path, specifier, exactPaths, suffixPaths);
      if (!target) continue;
      add(file.path, target, "imports");
      add(target, file.path, "imported-by");
    }
  }

  const sourceByStem = new Map<string, string[]>();
  for (const file of files.filter(
    (candidate) =>
      !pathLooksLikeTest(candidate.path) &&
      CODE_EXTENSIONS.has(path.posix.extname(candidate.path).toLowerCase()),
  )) {
    const stem = testStem(file.path);
    sourceByStem.set(stem, [...(sourceByStem.get(stem) ?? []), file.path]);
  }
  for (const testFile of files.filter((candidate) => pathLooksLikeTest(candidate.path))) {
    const candidates = sourceByStem.get(testStem(testFile.path)) ?? [];
    if (candidates.length !== 1) continue;
    const source = candidates[0];
    if (!source) continue;
    add(testFile.path, source, "tests");
    add(source, testFile.path, "tested-by");
  }

  return [...relations.values()].sort(
    (left, right) =>
      left.from.localeCompare(right.from) ||
      left.to.localeCompare(right.to) ||
      left.kind.localeCompare(right.kind),
  );
}
