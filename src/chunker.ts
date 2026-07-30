import { frequencies, languageFor, terms } from "./text.js";
import type { Chunk } from "./types.js";

const SYMBOL_PATTERNS = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|struct|trait|def|fn)\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
  /^\s*(?:public|private|protected|static|async|\s)*\s*([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?::[^{]+)?\{/,
];
const IMPORT_PATTERNS = [
  /\bfrom\s+["']([^"']+)["']/,
  /(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/,
  /^\s*from\s+([A-Za-z0-9_.]+)\s+import\b/,
  /^\s*import\s+([A-Za-z0-9_.\/-]+)/,
  /^\s*use\s+([A-Za-z0-9_:]+)/,
  /^\s*import\s+["']([^"']+)["']/,
];

function symbolsIn(lines: string[]): string[] {
  const output = new Set<string>();
  for (const line of lines) {
    for (const pattern of SYMBOL_PATTERNS) {
      const match = line.match(pattern);
      if (match?.[1]) {
        output.add(match[1]);
        break;
      }
    }
  }
  return [...output];
}

function importsIn(lines: string[]): string[] {
  const output = new Set<string>();
  for (const line of lines) {
    for (const pattern of IMPORT_PATTERNS) {
      const match = line.match(pattern);
      if (match?.[1]) {
        output.add(match[1]);
        break;
      }
    }
  }
  return [...output];
}

export function chunkFile(path: string, content: string, startId = 0): Chunk[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const language = languageFor(path);
  const chunks: Chunk[] = [];
  const maxLines = 100;
  const overlap = 12;
  for (let start = 0; start < lines.length; start += maxLines - overlap) {
    const end = Math.min(lines.length, start + maxLines);
    const slice = lines.slice(start, end);
    const symbols = symbolsIn(slice);
    const imports = importsIn(slice);
    const allTerms = terms(`${path} ${symbols.join(" ")} ${imports.join(" ")} ${slice.join("\n")}`);
    chunks.push({
      id: startId + chunks.length,
      path,
      startLine: start + 1,
      endLine: end,
      language,
      symbols,
      imports,
      termCount: allTerms.length,
      termFrequencies: frequencies(allTerms),
      preview: slice.join("\n").slice(0, 700).trim(),
    });
    if (end === lines.length) break;
  }
  return chunks;
}
