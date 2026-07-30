# Token-efficient repository workflow

When ContextFlux is available:

1. Call `get_task_context` with the concrete task and a 2,000-4,000 token budget before broad repository reads.
2. Use `search_repository` for unresolved symbols or exact errors.
3. Read only the returned file ranges. Increase the budget only when the packet lacks required evidence.
4. Refresh after material edits before planning the next cross-file change.
5. Use ordinary grep/file reads for tiny known targets; ContextFlux is for discovery and cross-file context.

Never claim exact token savings without using the `repositoryTokens`, `usedTokens`, and `reductionPercent` fields returned by ContextFlux.
