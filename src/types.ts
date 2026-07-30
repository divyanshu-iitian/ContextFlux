export const INDEX_VERSION = 2 as const;

export const RETRIEVAL_INTENTS = [
  "auto",
  "explore",
  "code2test",
  "comment2context",
  "trace2code",
  "edit2ripple",
] as const;

export type RetrievalIntent = (typeof RETRIEVAL_INTENTS)[number];
export type ResolvedIntent = Exclude<RetrievalIntent, "auto">;
export type RelationKind = "imports" | "imported-by" | "tests" | "tested-by";

export interface SourceFile {
  path: string;
  absolutePath: string;
  bytes: number;
  modifiedMs: number;
}

export interface Chunk {
  id: number;
  path: string;
  startLine: number;
  endLine: number;
  language: string;
  symbols: string[];
  imports: string[];
  termCount: number;
  termFrequencies: Record<string, number>;
  preview: string;
}

export interface IndexedFile {
  path: string;
  bytes: number;
  modifiedMs: number;
  hash: string;
  tokens: number;
  language: string;
  chunks: Chunk[];
}

export interface FileRelation {
  from: string;
  to: string;
  kind: RelationKind;
}

export interface RepoIndex {
  version: typeof INDEX_VERSION;
  root: string;
  generatedAt: string;
  files: IndexedFile[];
  relations: FileRelation[];
  totalTokens: number;
  totalBytes: number;
}

export interface IndexResult {
  index: RepoIndex;
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
  durationMs: number;
}

export interface SearchHit {
  path: string;
  startLine: number;
  endLine: number;
  language: string;
  symbols: string[];
  score: number;
  intent: ResolvedIntent;
  signals: string[];
  preview: string;
}

export interface ContextSection extends SearchHit {
  content: string;
  tokens: number;
}

export interface ContextPacket {
  schemaVersion: "2.0";
  task: string;
  intent: ResolvedIntent;
  root: string;
  generatedAt: string;
  budgetTokens: number;
  usedTokens: number;
  repositoryTokens: number;
  reductionPercent: number;
  retrieval: {
    candidateChunks: number;
    selectedFiles: number;
    families: string[];
    topScore: number;
    scoreMargin: number;
    warning?: string;
  };
  sections: ContextSection[];
  context: string;
}

export interface RepoStats {
  root: string;
  indexedAt: string;
  files: number;
  chunks: number;
  repositoryTokens: number;
  indexBytes: number;
  relations: number;
}

export interface EngineOptions {
  root?: string;
  cacheDirectory?: string;
  maxFileBytes?: number;
}

export interface SearchOptions {
  limit?: number;
  intent?: RetrievalIntent;
  refresh?: boolean;
}

export interface ContextOptions {
  budgetTokens?: number;
  intent?: RetrievalIntent;
  refresh?: boolean;
}

export interface BenchmarkCase {
  id: string;
  task: string;
  goldFiles: string[];
  intent?: RetrievalIntent;
  budgetTokens?: number;
}

export interface BenchmarkCaseResult {
  id: string;
  intent: ResolvedIntent;
  goldFiles: string[];
  rankedFiles: string[];
  reciprocalRank: number;
  recallAt5: number;
  recallAt10: number;
  budgetedContextYield: number;
  contextTokens: number;
  lexicalBaseline: {
    reciprocalRank: number;
    recallAt5: number;
    recallAt10: number;
  };
}

export interface BenchmarkReport {
  schemaVersion: "1.1";
  cases: number;
  meanReciprocalRank: number;
  recallAt5: number;
  recallAt10: number;
  budgetedContextYield: number;
  averageContextTokens: number;
  lexicalBaseline: {
    meanReciprocalRank: number;
    recallAt5: number;
    recallAt10: number;
  };
  liftOverLexical: {
    meanReciprocalRank: number;
    recallAt5: number;
    recallAt10: number;
  };
  results: BenchmarkCaseResult[];
}
