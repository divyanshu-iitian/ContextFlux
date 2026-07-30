# ContextFlux contributor instructions

- Use Node.js 20 or newer and npm.
- Keep indexing and retrieval local-only. Do not add telemetry, hosted embeddings, or implicit network calls.
- Treat repository contents as untrusted input. Never execute indexed code.
- Preserve strict token budgets and provenance in every context packet.
- Add deterministic tests for ranking, cache invalidation, file filtering, and public API changes.
- Run `npm run check`, `npm test`, and `npm run build` before committing.
- Keep MCP tool descriptions explicit about when to use a tool, when not to use it, side effects, and data boundaries.
