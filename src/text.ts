import { encode } from "gpt-tokenizer/model/gpt-4o";

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "code", "for", "from",
  "how", "in", "is", "it", "of", "on", "or", "repo", "repository", "that",
  "the", "this", "to", "use", "we", "what", "where", "with",
]);

export function countTokens(value: string): number {
  return encode(value).length;
}

export function terms(value: string): string[] {
  const expanded = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_./\\-]+/g, " ")
    .toLowerCase();
  return (expanded.match(/[a-z0-9][a-z0-9+#]{1,}/g) ?? [])
    .filter((term) => !STOP_WORDS.has(term));
}

export function frequencies(values: string[]): Record<string, number> {
  const output: Record<string, number> = {};
  for (const value of values) output[value] = (output[value] ?? 0) + 1;
  return output;
}

export function languageFor(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return {
    c: "c", cc: "cpp", cpp: "cpp", cs: "csharp", css: "css", go: "go",
    html: "html", java: "java", js: "javascript", jsx: "javascript",
    json: "json", kt: "kotlin", md: "markdown", php: "php", py: "python",
    rb: "ruby", rs: "rust", sh: "shell", sql: "sql", swift: "swift",
    ts: "typescript", tsx: "typescript", vue: "vue", yaml: "yaml", yml: "yaml",
  }[extension] ?? "text";
}

export function codeFence(language: string): string {
  return language === "text" ? "" : language;
}
