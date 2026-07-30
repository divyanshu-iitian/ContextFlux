import { changedPaths } from "./files.js";
import {
  mentionedPaths,
  pathLooksLikeConfig,
  pathLooksLikeTest,
  queryTerms,
  resolveIntent,
} from "./intent.js";
import type {
  Chunk,
  FileRelation,
  RepoIndex,
  ResolvedIntent,
  SearchHit,
  SearchOptions,
} from "./types.js";

const RRF_K = 60;

interface RankedChunk {
  chunk: Chunk;
  score: number;
  signals: string[];
}

function allChunks(index: RepoIndex): Chunk[] {
  return index.files.flatMap((file) => file.chunks);
}

function lexicalRanking(chunks: Chunk[], query: string, dirty: Set<string>): RankedChunk[] {
  const uniqueTerms = queryTerms(query);
  if (uniqueTerms.length === 0) return [];
  const averageLength =
    chunks.reduce((sum, chunk) => sum + chunk.termCount, 0) / Math.max(chunks.length, 1);
  const documentFrequency = new Map<string, number>();
  for (const term of uniqueTerms) {
    documentFrequency.set(
      term,
      chunks.filter((chunk) => chunk.termFrequencies[term]).length,
    );
  }

  return chunks
    .map((chunk) => {
      let score = 0;
      const matches: string[] = [];
      for (const term of uniqueTerms) {
        const frequency = chunk.termFrequencies[term] ?? 0;
        if (!frequency) continue;
        const frequencyInDocuments = documentFrequency.get(term) ?? 0;
        const inverseDocumentFrequency = Math.log(
          1 + (chunks.length - frequencyInDocuments + 0.5) / (frequencyInDocuments + 0.5),
        );
        const normalized =
          (frequency * 2.2) /
          (frequency + 1.2 * (0.25 + (0.75 * chunk.termCount) / Math.max(averageLength, 1)));
        score += inverseDocumentFrequency * normalized;
        matches.push(term);
      }
      if (dirty.has(chunk.path)) score *= 1.12;
      return {
        chunk,
        score,
        signals: matches.length ? [`lexical:${matches.slice(0, 6).join(",")}`] : [],
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.chunk.id - right.chunk.id);
}

function pathRanking(chunks: Chunk[], query: string): RankedChunk[] {
  const uniqueTerms = queryTerms(query);
  const mentioned = mentionedPaths(query);
  return chunks
    .map((chunk) => {
      const lowerPath = chunk.path.toLowerCase();
      let score = 0;
      const signals: string[] = [];
      for (const filePath of mentioned) {
        if (lowerPath === filePath.toLowerCase() || lowerPath.endsWith(`/${filePath.toLowerCase()}`)) {
          score += 12;
          signals.push(`mentioned:${filePath}`);
        }
      }
      for (const term of uniqueTerms) {
        if (lowerPath.includes(term)) {
          score += 2;
          signals.push(`path:${term}`);
        }
        if (chunk.symbols.some((symbol) => symbol.toLowerCase() === term)) {
          score += 5;
          signals.push(`symbol:${term}`);
        }
      }
      return { chunk, score, signals };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.chunk.id - right.chunk.id);
}

function relationWeight(intent: ResolvedIntent, relation: FileRelation): number {
  if (intent === "code2test") {
    if (relation.kind === "tested-by") return 8;
    if (pathLooksLikeTest(relation.to)) return 5;
    return 1.2;
  }
  if (intent === "trace2code") {
    if (relation.kind === "tests" || relation.kind === "imports") return 6;
    if (!pathLooksLikeTest(relation.to)) return 2.5;
    return 0.8;
  }
  if (intent === "edit2ripple") {
    if (relation.kind === "imported-by" || relation.kind === "tested-by") return 7;
    return 2;
  }
  if (intent === "comment2context") {
    return relation.kind === "imports" || relation.kind === "imported-by" ? 4 : 3;
  }
  return 2;
}

function graphRanking(
  index: RepoIndex,
  chunks: Chunk[],
  query: string,
  intent: ResolvedIntent,
  lexical: RankedChunk[],
  dirty: Set<string>,
): RankedChunk[] {
  const paths = new Set(index.files.map((file) => file.path));
  const anchors = new Map<string, number>();
  for (const mentioned of mentionedPaths(query)) {
    for (const filePath of paths) {
      if (
        filePath.toLowerCase() === mentioned.toLowerCase() ||
        filePath.toLowerCase().endsWith(`/${mentioned.toLowerCase()}`)
      ) {
        anchors.set(filePath, 10);
      }
    }
  }
  for (const candidate of lexical.slice(0, 5)) {
    anchors.set(candidate.chunk.path, Math.max(anchors.get(candidate.chunk.path) ?? 0, 4));
  }
  for (const dirtyPath of dirty) {
    if (paths.has(dirtyPath)) anchors.set(dirtyPath, Math.max(anchors.get(dirtyPath) ?? 0, 6));
  }
  if (anchors.size === 0) return [];

  const fileScores = new Map<string, { score: number; signals: Set<string> }>();
  const add = (filePath: string, score: number, signal: string): void => {
    const current = fileScores.get(filePath) ?? { score: 0, signals: new Set<string>() };
    current.score += score;
    current.signals.add(signal);
    fileScores.set(filePath, current);
  };
  for (const [anchor, score] of anchors) add(anchor, score * 0.25, `anchor:${anchor}`);

  const bySource = new Map<string, FileRelation[]>();
  for (const relation of index.relations) {
    bySource.set(relation.from, [...(bySource.get(relation.from) ?? []), relation]);
  }
  let frontier = new Map(anchors);
  const maxDepth = intent === "code2test" || intent === "edit2ripple" ? 3 : 2;
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const next = new Map<string, number>();
    const decay = Math.pow(0.55, depth - 1);
    for (const [source, sourceScore] of frontier) {
      for (const relation of bySource.get(source) ?? []) {
        const propagated =
          relationWeight(intent, relation) * Math.log2(sourceScore + 1) * decay;
        if (propagated <= 0) continue;
        add(
          relation.to,
          propagated,
          `${depth === 1 ? relation.kind : `${depth}-hop:${relation.kind}`}:${source}`,
        );
        next.set(relation.to, Math.max(next.get(relation.to) ?? 0, propagated));
      }
    }
    frontier = next;
    if (frontier.size === 0) break;
  }

  return chunks
    .map((chunk) => {
      const file = fileScores.get(chunk.path);
      return {
        chunk,
        score: file?.score ?? 0,
        signals: file ? [...file.signals] : [],
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.chunk.id - right.chunk.id);
}

function intentRanking(
  index: RepoIndex,
  chunks: Chunk[],
  intent: ResolvedIntent,
  dirty: Set<string>,
): RankedChunk[] {
  const degree = new Map<string, number>();
  for (const relation of index.relations) {
    degree.set(relation.from, (degree.get(relation.from) ?? 0) + 1);
  }
  return chunks
    .map((chunk) => {
      let score = Math.log2((degree.get(chunk.path) ?? 0) + 1) * 0.25;
      const signals: string[] = [];
      if (intent === "code2test" && pathLooksLikeTest(chunk.path)) {
        score += 6;
        signals.push("intent:test-file");
      } else if (intent === "trace2code" && !pathLooksLikeTest(chunk.path)) {
        score += 1.5;
        signals.push("intent:source-file");
      } else if (intent === "edit2ripple" && dirty.has(chunk.path)) {
        score += 5;
        signals.push("intent:changed-file");
      } else if (intent === "comment2context" && pathLooksLikeConfig(chunk.path)) {
        score += 1;
        signals.push("intent:configuration");
      }
      return { chunk, score, signals };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.chunk.id - right.chunk.id);
}

function familyWeight(family: string, intent: ResolvedIntent): number {
  if (family === "graph" && (intent === "trace2code" || intent === "edit2ripple")) return 1.35;
  if (family === "intent" && intent === "code2test") return 1.25;
  if (family === "path") return 1.1;
  return 1;
}

function fuse(
  families: Array<{ name: string; candidates: RankedChunk[] }>,
  intent: ResolvedIntent,
): RankedChunk[] {
  const fused = new Map<number, { chunk: Chunk; score: number; signals: Set<string> }>();
  for (const family of families) {
    const weight = familyWeight(family.name, intent);
    family.candidates.slice(0, 250).forEach((candidate, rank) => {
      const current = fused.get(candidate.chunk.id) ?? {
        chunk: candidate.chunk,
        score: 0,
        signals: new Set<string>(),
      };
      current.score += weight / (RRF_K + rank + 1);
      current.signals.add(`family:${family.name}`);
      for (const signal of candidate.signals) current.signals.add(signal);
      fused.set(candidate.chunk.id, current);
    });
  }
  return [...fused.values()]
    .map((candidate) => ({
      chunk: candidate.chunk,
      score: candidate.score,
      signals: [...candidate.signals],
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.signals.length - left.signals.length ||
        left.chunk.path.localeCompare(right.chunk.path) ||
        left.chunk.startLine - right.chunk.startLine,
    );
}

export async function searchIndex(
  index: RepoIndex,
  query: string,
  options: SearchOptions = {},
): Promise<SearchHit[]> {
  const intent = resolveIntent(query, options.intent);
  const limit = Math.max(1, Math.min(options.limit ?? 10, 100));
  const chunks = allChunks(index);
  const dirty = await changedPaths(index.root);
  const lexical = lexicalRanking(chunks, query, dirty);
  const families = [
    { name: "lexical", candidates: lexical },
    { name: "path", candidates: pathRanking(chunks, query) },
    {
      name: "graph",
      candidates: graphRanking(index, chunks, query, intent, lexical, dirty),
    },
    { name: "intent", candidates: intentRanking(index, chunks, intent, dirty) },
  ];

  const selected: RankedChunk[] = [];
  const perFile = new Map<string, number>();
  for (const candidate of fuse(families, intent)) {
    if ((perFile.get(candidate.chunk.path) ?? 0) >= 2) continue;
    selected.push(candidate);
    perFile.set(candidate.chunk.path, (perFile.get(candidate.chunk.path) ?? 0) + 1);
    if (selected.length === limit) break;
  }

  return selected
    .map(({ chunk, score, signals }) => ({
      path: chunk.path,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      language: chunk.language,
      symbols: chunk.symbols,
      score: Number(score.toFixed(6)),
      intent,
      signals,
      preview: chunk.preview,
    }));
}

export async function searchLexicalBaseline(
  index: RepoIndex,
  query: string,
  limit = 20,
): Promise<SearchHit[]> {
  const intent = resolveIntent(query, "auto");
  const dirty = await changedPaths(index.root);
  return lexicalRanking(allChunks(index), query, dirty)
    .slice(0, Math.max(1, Math.min(limit, 100)))
    .map(({ chunk, score, signals }) => ({
      path: chunk.path,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      language: chunk.language,
      symbols: chunk.symbols,
      score: Number(score.toFixed(6)),
      intent,
      signals: ["family:lexical", ...signals],
      preview: chunk.preview,
    }));
}
