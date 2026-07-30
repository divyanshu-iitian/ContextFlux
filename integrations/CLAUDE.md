# ContextFlux context discipline

Use the ContextFlux MCP tools to avoid loading irrelevant repository content:

- Start unfamiliar or cross-file work with `get_task_context`.
- Search a symbol or error with `search_repository`.
- Request `repository_map` only for architecture-level orientation.
- Keep the initial context budget at 4,000 tokens or less.
- Read full files only when an edit requires context outside the returned ranges.
- Re-index incrementally after code changes.
