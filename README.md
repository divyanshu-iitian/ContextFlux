<div align="center">
  <h1>ContextFlux</h1>
  <p><strong>Task-adaptive repository context for coding agents.</strong></p>
  <p>
    Give an agent the evidence it needs, not the whole repository.
  </p>

  [![CI](https://github.com/divyanshu-iitian/ContextFlux/actions/workflows/ci.yml/badge.svg)](https://github.com/divyanshu-iitian/ContextFlux/actions/workflows/ci.yml)
  [![MIT License](https://img.shields.io/badge/license-MIT-16a34a.svg)](LICENSE)
  [![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](package.json)
  [![MCP](https://img.shields.io/badge/MCP-compatible-7c3aed.svg)](https://modelcontextprotocol.io/)
</div>

ContextFlux is a local context engine and MCP server for coding agents. It classifies the
current workflow, fuses lexical, path/symbol, dependency/test-graph, and workflow-specific
rankings, then returns source-cited code ranges under a measured token ceiling.

It needs no API key, embedding model, daemon, or hosted index. It never executes repository
code and never sends source, queries, or telemetry over the network.

> **Status:** v0.1 is an experimental developer preview. The public API and index schema may
> change before v1. See [limitations](#limitations) before production use.

## Why ContextFlux?

A coding agent rarely needs every file. It needs different evidence for different jobs:

- a test when implementing a change;
- the source frame and dependencies when debugging a trace;
- downstream importers and tests before a risky edit;
- nearby code and configuration when addressing review feedback.

Recent repository-retrieval research supports this task-specific approach. The
[Agent Retrieval Bench](https://arxiv.org/abs/2607.24882) reports that no single retrieval
family wins across all coding-agent workflows, while repo maps are especially effective under
tight context budgets. [SWE-Explore](https://arxiv.org/abs/2606.07297) evaluates ranked code
regions under fixed line budgets, and [context compression experiments](https://arxiv.org/abs/2604.13725)
show that smaller, more precise contexts can sometimes improve both quality and latency.

ContextFlux turns those ideas into a small, offline tool:

```text
task / trace / review comment
              |
       workflow classifier
              |
   +----------+----------+-----------+-----------+
   | lexical | path     | code graph| task prior|
   +----------+----------+-----------+-----------+
              |
      reciprocal-rank fusion
              |
    cited ranges + exact budget
```

## Quick start

Node.js 20 or newer is required.

```bash
git clone https://github.com/divyanshu-iitian/ContextFlux.git
cd ContextFlux
npm ci
npm run build

node dist/cli.js index .
node dist/cli.js context "Fix the login timeout and update its tests" --budget 3000
```

Run directly from GitHub without a global install:

```bash
npx --yes --package=github:divyanshu-iitian/ContextFlux \
  contextflux context "Trace the invalid credentials error" --root . --budget 3000
```

Useful CLI commands:

```bash
contextflux search "createSession" --limit 8
contextflux context "Add regression tests for login" --intent code2test --budget 2500
contextflux context "Show the blast radius of changing src/auth.ts" --intent edit2ripple
contextflux map --budget 1200
contextflux stats
contextflux benchmark benchmarks/self.json
```

The incremental cache lives at `.contextflux/index.json`, which should remain gitignored.

## Connect an agent over MCP

Add this to an MCP client's configuration, replacing the root with an absolute path to the
repository the agent will work on:

```json
{
  "mcpServers": {
    "contextflux": {
      "command": "npx",
      "args": [
        "--yes",
        "--package=github:divyanshu-iitian/ContextFlux",
        "contextflux-mcp"
      ],
      "env": {
        "CONTEXTFLUX_ROOT": "/absolute/path/to/repository"
      }
    }
  }
}
```

On Windows, use `npx.cmd` if the client does not resolve `npx`. Restart the client after saving
the configuration.

The server exposes four read-only tools:

| Tool | Use it for |
| --- | --- |
| `get_task_context` | A bounded, source-cited evidence packet for a concrete coding task |
| `search_repository` | An exact symbol, path, error string, or focused concept |
| `repository_map` | One-time architecture orientation without file bodies |
| `index_status` | Index age, file/chunk/relation counts, baseline tokens, and cache size |

An agent skill and drop-in instruction files are included under
[`skills/context-efficient-coding`](skills/context-efficient-coding/SKILL.md) and
[`integrations`](integrations).

## Retrieval modes

Leave the mode on `auto` in normal use, or choose one explicitly:

| Mode | Ranking emphasis |
| --- | --- |
| `explore` | Central files, symbols, concepts, and repository structure |
| `code2test` | Matching test files and test relations |
| `comment2context` | Mentioned paths, nearby dependencies, and configuration |
| `trace2code` | Stack-trace paths, source files, and dependencies |
| `edit2ripple` | Importers, tests, and likely downstream change surface |

Every search result includes a path, line range, symbols, preview, score, and human-readable
evidence signals. Scores rank candidates; they are not calibrated probabilities.

## Library API

```ts
import { ContextFlux } from "contextflux";

const flux = new ContextFlux({ root: process.cwd() });

const packet = await flux.context(
  "Show the blast radius of changing src/auth.ts",
  { intent: "edit2ripple", budgetTokens: 3_000 },
);

console.log(packet.context);
console.log(packet.reductionPercent);
```

`budgetTokens` is enforced against the rendered packet with the GPT-4o tokenizer. For a model
with a different tokenizer, leave headroom.

## Evaluation

The benchmark runner accepts gold-file cases and reports:

- mean reciprocal rank;
- Recall@5 and Recall@10;
- budgeted context yield (gold files present in the final packet);
- average packet tokens;
- the same retrieval metrics for a plain lexical baseline;
- measured lift over that baseline.

```json
[
  {
    "id": "code-to-test",
    "task": "Add regression tests for token-budget enforcement in src/engine.ts",
    "intent": "code2test",
    "goldFiles": ["test/engine.test.ts"],
    "budgetTokens": 3000
  }
]
```

Run the checked-in smoke set:

```bash
npm run build
node dist/cli.js benchmark benchmarks/self.json --root . --json
```

The smoke set checks wiring and regressions; it is not evidence of state-of-the-art quality.
For externally valid comparisons, evaluate on
[Agent Retrieval Bench](https://github.com/eyuansu62/agent-retrieval-bench) or another
independent dataset and publish the full configuration.

## How it compares

These projects solve adjacent problems and can be complementary:

| Project | Primary job | ContextFlux difference |
| --- | --- | --- |
| [Repomix](https://github.com/yamadashy/repomix) | Pack a repository into an AI-friendly artifact | Selects task-specific ranges instead of packing the repository |
| [Serena](https://github.com/oraios/serena) | LSP-powered semantic navigation and editing | Zero-daemon, language-agnostic retrieval with a strict packet budget |
| [Aider](https://github.com/Aider-AI/aider) | Full coding assistant with repository maps | Agent-agnostic context layer exposed as a library, CLI, and MCP server |
| [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) | Persistent code knowledge graph | Lightweight ephemeral index with no external database |

ContextFlux does not claim to replace language servers, embeddings, or full coding agents.
Its narrow job is budgeted evidence retrieval.

## Research basis

The implementation is informed by, but is not an official implementation of, these papers:

- Yuan et al., **Agent Retrieval Bench** (27 July 2026): task-dependent retrieval families,
  natural no-gold cases, and budgeted context yield
  ([paper](https://arxiv.org/abs/2607.24882),
  [benchmark](https://github.com/eyuansu62/agent-retrieval-bench)).
- **SWE-Explore** (June 2026): code-region retrieval under fixed exploration budgets
  ([paper](https://arxiv.org/abs/2606.07297)).
- **CORE-Bench** (June 2026): repository-level code retrieval evaluation
  ([paper](https://arxiv.org/abs/2606.11864)).
- **RANGER** (2025): graph-enhanced repository retrieval
  ([paper](https://arxiv.org/abs/2509.25257)).
- **Context compression for coding agents** (April 2026): empirical quality/latency trade-offs
  ([paper](https://arxiv.org/abs/2604.13725)).

## Privacy and security

- Indexing, ranking, tokenization, and context assembly run locally.
- Symlinks and paths escaping the configured root are rejected.
- Binary, generated, dependency, lock, and oversized files are skipped by default.
- Repository text is returned as untrusted evidence, never executed as instructions.
- The cache contains source-derived terms and previews; protect it like source code.

Please report vulnerabilities according to [SECURITY.md](SECURITY.md).

## Limitations

- Import extraction is intentionally lightweight and currently recognizes common JavaScript,
  TypeScript, Python, Rust, Go, Java, Kotlin, Ruby, and PHP forms. It is not a compiler.
- Dynamic imports, aliases, generated sources, and runtime wiring may not form graph edges.
- Retrieval is lexical/structural; semantic paraphrases can be missed without shared terms.
- Confidence is deliberately not presented as calibrated. Closely ranked candidates produce a
  verification warning.
- The index is single-process and intended for local developer repositories, not a shared
  multi-tenant service.

## Contributing

Issues, benchmark cases, language resolvers, and reproducible retrieval improvements are welcome.
Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

MIT licensed. Built by [Divyanshu](https://github.com/divyanshu-iitian).
