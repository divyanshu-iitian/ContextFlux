#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { ContextFlux } from "./engine.js";
import { RETRIEVAL_INTENTS, type BenchmarkCase, type RetrievalIntent } from "./types.js";

const HELP = `ContextFlux — task-adaptive repository context for coding agents

Usage:
  contextflux index [directory] [--json]
  contextflux context <task> [--root .] [--budget 4000] [--intent auto] [--json]
  contextflux search <query> [--root .] [--limit 10] [--intent auto] [--json]
  contextflux map [--root .] [--budget 1500]
  contextflux stats [--root .] [--json]
  contextflux benchmark <cases.json> [--root .] [--json]
  contextflux mcp [--root .]

Retrieval modes:
  auto, explore, code2test, comment2context, trace2code, edit2ripple

ContextFlux stores a local, gitignored index in .contextflux/index.json.
It does not execute indexed code or send source, queries, or telemetry over the network.
`;

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function numberAfter(args: string[], flag: string, fallback: number): number {
  const raw = valueAfter(args, flag);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) throw new Error(`${flag} requires an integer`);
  return parsed;
}

function intentAfter(args: string[]): RetrievalIntent {
  const value = valueAfter(args, "--intent") ?? "auto";
  if (!RETRIEVAL_INTENTS.includes(value as RetrievalIntent)) {
    throw new Error(`--intent must be one of: ${RETRIEVAL_INTENTS.join(", ")}`);
  }
  return value as RetrievalIntent;
}

async function resolveRoot(args: string[], positional?: string): Promise<string> {
  return fs.realpath(path.resolve(valueAfter(args, "--root") ?? positional ?? process.cwd()));
}

function output(value: unknown, json: boolean): void {
  if (json || typeof value !== "string") {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else {
    process.stdout.write(`${value}\n`);
  }
}

async function loadBenchmarkCases(filePath: string): Promise<BenchmarkCase[]> {
  const parsed = JSON.parse(await fs.readFile(path.resolve(filePath), "utf8")) as
    | BenchmarkCase[]
    | { cases?: BenchmarkCase[] };
  const cases = Array.isArray(parsed) ? parsed : parsed.cases;
  if (!Array.isArray(cases)) throw new Error("benchmark file must be an array or { cases: [...] }");
  return cases;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write("0.1.0\n");
    return;
  }
  if (command === "mcp") {
    process.env.CONTEXTFLUX_ROOT = await resolveRoot(args);
    await import("./mcp.js");
    return;
  }

  const positionalRoot =
    command === "index" && args[1] && !args[1].startsWith("--") ? args[1] : undefined;
  const flux = new ContextFlux({ root: await resolveRoot(args, positionalRoot) });
  const json = args.includes("--json");
  const refresh = !args.includes("--no-refresh");

  if (command === "index") {
    const result = await flux.index();
    output(
      json
        ? result
        : `Indexed ${result.index.files.length} files, ${result.index.relations.length} relations, ` +
            `and ${result.index.totalTokens} tokens in ${result.durationMs}ms ` +
            `(${result.added} added, ${result.changed} changed, ${result.unchanged} cached).`,
      json,
    );
    return;
  }
  if (command === "context") {
    const task = args[1];
    if (!task || task.startsWith("--")) throw new Error("context requires a quoted task");
    const packet = await flux.context(task, {
      budgetTokens: numberAfter(args, "--budget", 4_000),
      intent: intentAfter(args),
      refresh,
    });
    output(json ? packet : packet.context, json);
    return;
  }
  if (command === "search") {
    const query = args[1];
    if (!query || query.startsWith("--")) throw new Error("search requires a quoted query");
    const hits = await flux.search(query, {
      limit: numberAfter(args, "--limit", 10),
      intent: intentAfter(args),
      refresh,
    });
    output(
      json
        ? hits
        : hits
            .map(
              (hit) =>
                `${hit.score.toFixed(5)}  ${hit.path}:${hit.startLine}-${hit.endLine}` +
                `  (${hit.intent}; ${hit.signals.slice(0, 4).join(", ")})`,
            )
            .join("\n"),
      json,
    );
    return;
  }
  if (command === "map") {
    output(await flux.map(numberAfter(args, "--budget", 1_500), refresh), false);
    return;
  }
  if (command === "stats") {
    const stats = await flux.stats(refresh);
    output(
      json
        ? stats
        : [
            `Root: ${stats.root}`,
            `Files: ${stats.files}`,
            `Chunks: ${stats.chunks}`,
            `Relations: ${stats.relations}`,
            `Repository tokens: ${stats.repositoryTokens}`,
            `Index size: ${stats.indexBytes} bytes`,
            `Indexed at: ${stats.indexedAt}`,
          ].join("\n"),
      json,
    );
    return;
  }
  if (command === "benchmark") {
    const datasetPath = args[1];
    if (!datasetPath || datasetPath.startsWith("--")) {
      throw new Error("benchmark requires a JSON dataset path");
    }
    output(await flux.benchmark(await loadBenchmarkCases(datasetPath), refresh), true);
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

main().catch((error: unknown) => {
  process.stderr.write(`ContextFlux: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});
