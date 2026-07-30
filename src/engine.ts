import { promises as fs } from "node:fs";
import path from "node:path";
import { buildIndex } from "./indexer.js";
import { resolveIntent } from "./intent.js";
import { searchIndex, searchLexicalBaseline } from "./retrieval.js";
import { cachePath, loadIndex } from "./store.js";
import { codeFence, countTokens } from "./text.js";
import type {
  BenchmarkCase,
  BenchmarkCaseResult,
  BenchmarkReport,
  ContextOptions,
  ContextPacket,
  ContextSection,
  EngineOptions,
  IndexResult,
  RepoIndex,
  RepoStats,
  SearchHit,
  SearchOptions,
} from "./types.js";

function render(
  task: string,
  intent: string,
  sections: ContextSection[],
  budget: number,
  repositoryTokens: number,
): string {
  const header = [
    "# ContextFlux evidence packet",
    `Task: ${task}`,
    `Retrieval mode: ${intent}`,
    `Hard budget: ${budget} tokens`,
    `Repository baseline: ${repositoryTokens} tokens`,
    "",
  ].join("\n");
  return (
    header +
    sections
      .map(
        (section) =>
          `## ${section.path}:${section.startLine}-${section.endLine}\n` +
          `Evidence: ${section.signals.join(", ") || "rank fusion"}\n` +
          `Symbols: ${section.symbols.join(", ") || "none detected"}\n\n` +
          `\`\`\`${codeFence(section.language)}\n${section.content}\n\`\`\`\n`,
      )
      .join("\n")
  );
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizedPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

export class ContextFlux {
  private readonly options: EngineOptions;
  private indexing: Promise<IndexResult> | undefined;

  constructor(options: EngineOptions = {}) {
    this.options = options;
  }

  async index(): Promise<IndexResult> {
    if (this.indexing) return this.indexing;
    this.indexing = buildIndex(this.options).finally(() => {
      this.indexing = undefined;
    });
    return this.indexing;
  }

  private async current(refresh = true): Promise<RepoIndex> {
    const root = await fs.realpath(this.options.root ?? process.cwd());
    if (refresh) return (await this.index()).index;
    const existing = await loadIndex(root, this.options.cacheDirectory);
    return existing ?? (await this.index()).index;
  }

  private async readIndexedSlice(index: RepoIndex, hit: SearchHit): Promise<string | undefined> {
    const absolute = path.resolve(index.root, hit.path);
    const relative = path.relative(index.root, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
    try {
      const stat = await fs.lstat(absolute);
      if (!stat.isFile() || stat.isSymbolicLink()) return undefined;
      const real = await fs.realpath(absolute);
      const realRelative = path.relative(index.root, real);
      if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) return undefined;
      const content = await fs.readFile(real, "utf8");
      return content
        .replace(/\r\n/g, "\n")
        .split("\n")
        .slice(hit.startLine - 1, hit.endLine)
        .join("\n")
        .trim();
    } catch {
      return undefined;
    }
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    if (!query.trim()) throw new Error("query must not be empty");
    return searchIndex(await this.current(options.refresh ?? true), query, {
      limit: options.limit ?? 10,
      intent: options.intent ?? "auto",
      refresh: options.refresh ?? true,
    });
  }

  async context(task: string, options: ContextOptions = {}): Promise<ContextPacket> {
    if (!task.trim()) throw new Error("task must not be empty");
    const budgetTokens = options.budgetTokens ?? 4_000;
    if (!Number.isInteger(budgetTokens) || budgetTokens < 256 || budgetTokens > 100_000) {
      throw new Error("budgetTokens must be an integer between 256 and 100000");
    }
    const intent = resolveIntent(task, options.intent ?? "auto");
    const index = await this.current(options.refresh ?? true);
    const hits = await searchIndex(index, task, {
      limit: 100,
      intent,
      refresh: options.refresh ?? true,
    });
    const sections: ContextSection[] = [];
    const usedRanges = new Set<string>();
    const pathCounts = new Map<string, number>();

    const tryAdd = async (hit: SearchHit, allowCrop: boolean): Promise<boolean> => {
      const rangeKey = `${hit.path}:${hit.startLine}-${hit.endLine}`;
      if (usedRanges.has(rangeKey)) return false;
      const content = await this.readIndexedSlice(index, hit);
      if (!content) return false;
      const buildSection = (sectionContent: string, endLine: number): ContextSection => ({
        ...hit,
        endLine,
        content: sectionContent,
        tokens: countTokens(sectionContent),
      });
      const full = buildSection(content, hit.endLine);
      const fullContext = render(task, intent, [...sections, full], budgetTokens, index.totalTokens);
      if (countTokens(fullContext) <= budgetTokens) {
        sections.push(full);
        usedRanges.add(rangeKey);
        pathCounts.set(hit.path, (pathCounts.get(hit.path) ?? 0) + 1);
        return true;
      }
      if (!allowCrop) return false;

      const lines = content.split("\n");
      let low = 1;
      let high = lines.length;
      let best: ContextSection | undefined;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const candidate = buildSection(lines.slice(0, middle).join("\n"), hit.startLine + middle - 1);
        const candidateTokens = countTokens(
          render(task, intent, [...sections, candidate], budgetTokens, index.totalTokens),
        );
        if (candidateTokens <= budgetTokens) {
          best = candidate;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      if (!best) return false;
      sections.push(best);
      usedRanges.add(rangeKey);
      pathCounts.set(hit.path, (pathCounts.get(hit.path) ?? 0) + 1);
      return true;
    };

    for (const maxPerFile of [1, 2]) {
      for (const hit of hits) {
        if ((pathCounts.get(hit.path) ?? 0) >= maxPerFile) continue;
        await tryAdd(hit, sections.length === 0);
      }
    }

    const context = render(task, intent, sections, budgetTokens, index.totalTokens);
    const usedTokens = countTokens(context);
    const topScore = hits[0]?.score ?? 0;
    const scoreMargin = topScore - (hits[1]?.score ?? 0);
    const families = [
      ...new Set(
        sections.flatMap((section) =>
          section.signals
            .filter((signal) => signal.startsWith("family:"))
            .map((signal) => signal.slice("family:".length)),
        ),
      ),
    ];
    const warning =
      sections.length === 0
        ? "No local evidence fit the requested budget."
        : scoreMargin < 0.0005
          ? "Top candidates are closely ranked; verify the cited ranges before editing."
          : undefined;

    return {
      schemaVersion: "2.0",
      task,
      intent,
      root: index.root,
      generatedAt: new Date().toISOString(),
      budgetTokens,
      usedTokens,
      repositoryTokens: index.totalTokens,
      reductionPercent: index.totalTokens
        ? Number((100 * (1 - usedTokens / index.totalTokens)).toFixed(1))
        : 0,
      retrieval: {
        candidateChunks: hits.length,
        selectedFiles: new Set(sections.map((section) => section.path)).size,
        families,
        topScore,
        scoreMargin: Number(scoreMargin.toFixed(6)),
        ...(warning ? { warning } : {}),
      },
      sections,
      context,
    };
  }

  async map(budgetTokens = 1_500, refresh = true): Promise<string> {
    if (!Number.isInteger(budgetTokens) || budgetTokens < 128 || budgetTokens > 20_000) {
      throw new Error("budgetTokens must be an integer between 128 and 20000");
    }
    const index = await this.current(refresh);
    const degree = new Map<string, number>();
    for (const relation of index.relations) {
      degree.set(relation.from, (degree.get(relation.from) ?? 0) + 1);
    }
    const files = [...index.files].sort(
      (left, right) =>
        (degree.get(right.path) ?? 0) - (degree.get(left.path) ?? 0) ||
        left.path.localeCompare(right.path),
    );
    const lines = ["# ContextFlux repository map"];
    for (const file of files) {
      const symbols = [...new Set(file.chunks.flatMap((chunk) => chunk.symbols))];
      const relationCount = degree.get(file.path) ?? 0;
      const line =
        `${file.path}` +
        `${symbols.length ? ` — ${symbols.slice(0, 12).join(", ")}` : ""}` +
        `${relationCount ? ` [${relationCount} relations]` : ""}`;
      if (countTokens([...lines, line].join("\n")) > budgetTokens) break;
      lines.push(line);
    }
    return lines.join("\n");
  }

  async stats(refresh = false): Promise<RepoStats> {
    const index = await this.current(refresh);
    let indexBytes = 0;
    try {
      indexBytes = (await fs.stat(cachePath(index.root, this.options.cacheDirectory))).size;
    } catch {
      // Index may be held in memory during an atomic replacement.
    }
    return {
      root: index.root,
      indexedAt: index.generatedAt,
      files: index.files.length,
      chunks: index.files.reduce((sum, file) => sum + file.chunks.length, 0),
      repositoryTokens: index.totalTokens,
      indexBytes,
      relations: index.relations.length,
    };
  }

  async benchmark(cases: BenchmarkCase[], refresh = false): Promise<BenchmarkReport> {
    if (cases.length === 0) throw new Error("benchmark requires at least one case");
    const results: BenchmarkCaseResult[] = [];
    let first = true;
    for (const benchmarkCase of cases) {
      if (!benchmarkCase.id || !benchmarkCase.task || benchmarkCase.goldFiles.length === 0) {
        throw new Error("each benchmark case requires id, task, and at least one gold file");
      }
      const hits = await this.search(benchmarkCase.task, {
        limit: 20,
        intent: benchmarkCase.intent ?? "auto",
        refresh: refresh && first,
      });
      const baselineHits = await searchLexicalBaseline(
        await this.current(false),
        benchmarkCase.task,
        20,
      );
      first = false;
      const packet = await this.context(benchmarkCase.task, {
        budgetTokens: benchmarkCase.budgetTokens ?? 8_000,
        intent: benchmarkCase.intent ?? "auto",
        refresh: false,
      });
      const gold = new Set(benchmarkCase.goldFiles.map(normalizedPath));
      const rankedFiles = [...new Set(hits.map((hit) => hit.path))];
      const normalizedRanked = rankedFiles.map(normalizedPath);
      const baselineRanked = [...new Set(baselineHits.map((hit) => hit.path))].map(normalizedPath);
      const firstGoldIndex = normalizedRanked.findIndex((filePath) => gold.has(filePath));
      const baselineFirstGoldIndex = baselineRanked.findIndex((filePath) => gold.has(filePath));
      const recall = (ranking: string[], limit: number): number =>
        [...gold].filter((filePath) => ranking.slice(0, limit).includes(filePath)).length / gold.size;
      const packetFiles = new Set(packet.sections.map((section) => normalizedPath(section.path)));
      const budgetedContextYield =
        [...gold].filter((filePath) => packetFiles.has(filePath)).length / gold.size;
      results.push({
        id: benchmarkCase.id,
        intent: packet.intent,
        goldFiles: benchmarkCase.goldFiles,
        rankedFiles,
        reciprocalRank: firstGoldIndex < 0 ? 0 : 1 / (firstGoldIndex + 1),
        recallAt5: recall(normalizedRanked, 5),
        recallAt10: recall(normalizedRanked, 10),
        budgetedContextYield,
        contextTokens: packet.usedTokens,
        lexicalBaseline: {
          reciprocalRank: baselineFirstGoldIndex < 0 ? 0 : 1 / (baselineFirstGoldIndex + 1),
          recallAt5: recall(baselineRanked, 5),
          recallAt10: recall(baselineRanked, 10),
        },
      });
    }

    const meanReciprocalRank = Number(
      mean(results.map((result) => result.reciprocalRank)).toFixed(4),
    );
    const recallAt5 = Number(mean(results.map((result) => result.recallAt5)).toFixed(4));
    const recallAt10 = Number(mean(results.map((result) => result.recallAt10)).toFixed(4));
    const baselineMeanReciprocalRank = Number(
      mean(results.map((result) => result.lexicalBaseline.reciprocalRank)).toFixed(4),
    );
    const baselineRecallAt5 = Number(
      mean(results.map((result) => result.lexicalBaseline.recallAt5)).toFixed(4),
    );
    const baselineRecallAt10 = Number(
      mean(results.map((result) => result.lexicalBaseline.recallAt10)).toFixed(4),
    );
    return {
      schemaVersion: "1.1",
      cases: results.length,
      meanReciprocalRank,
      recallAt5,
      recallAt10,
      budgetedContextYield: Number(
        mean(results.map((result) => result.budgetedContextYield)).toFixed(4),
      ),
      averageContextTokens: Math.round(mean(results.map((result) => result.contextTokens))),
      lexicalBaseline: {
        meanReciprocalRank: baselineMeanReciprocalRank,
        recallAt5: baselineRecallAt5,
        recallAt10: baselineRecallAt10,
      },
      liftOverLexical: {
        meanReciprocalRank: Number(
          (meanReciprocalRank - baselineMeanReciprocalRank).toFixed(4),
        ),
        recallAt5: Number((recallAt5 - baselineRecallAt5).toFixed(4)),
        recallAt10: Number((recallAt10 - baselineRecallAt10).toFixed(4)),
      },
      results,
    };
  }
}
