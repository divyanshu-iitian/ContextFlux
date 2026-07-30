import path from "node:path";
import { terms } from "./text.js";
import type { ResolvedIntent, RetrievalIntent } from "./types.js";

const PATH_PATTERN =
  /(?:^|[\s("'`])((?:[A-Za-z0-9_.@-]+[\\/])+[A-Za-z0-9_.@-]+\.[A-Za-z0-9]+)(?=$|[\s)"'`,:])/g;

export function resolveIntent(task: string, requested: RetrievalIntent = "auto"): ResolvedIntent {
  if (requested !== "auto") return requested;
  const value = task.toLowerCase();

  if (
    /\b(traceback|stack trace|stacktrace|panic|segmentation fault|caused by)\b/.test(value) ||
    /\bat .+:\d+(?::\d+)?\b/.test(value) ||
    /\bfile ["'].+["'], line \d+\b/.test(value)
  ) {
    return "trace2code";
  }
  if (/\b(review comment|reviewer|pull request|code review|pr feedback)\b/.test(value)) {
    return "comment2context";
  }
  if (
    /\b(blast radius|edit ripple|what breaks|dependents?|callers?|rename|refactor|affected files?)\b/.test(
      value,
    )
  ) {
    return "edit2ripple";
  }
  if (/\b(tests?|specs?|regression|coverage|assertions?|fixtures?)\b/.test(value)) {
    return "code2test";
  }
  return "explore";
}

export function mentionedPaths(task: string): string[] {
  const paths = new Set<string>();
  for (const match of task.matchAll(PATH_PATTERN)) {
    if (match[1]) paths.add(match[1].replaceAll("\\", "/").replace(/^[./]+/, ""));
  }
  return [...paths];
}

export function queryTerms(task: string): string[] {
  return [...new Set(terms(task))];
}

export function pathLooksLikeTest(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  const basename = path.posix.basename(normalized);
  return (
    /(^|\/)(tests?|__tests__|specs?)(\/|$)/.test(normalized) ||
    /(?:^test_|_test\.|\.test\.|\.spec\.)/.test(basename)
  );
}

export function pathLooksLikeConfig(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  return /(^|\/)(?:config|configs|configuration)(\/|$)/.test(normalized) ||
    /(?:^|[._-])config(?:[._-]|$)/.test(path.posix.basename(normalized));
}
