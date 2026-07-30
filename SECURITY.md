# Security policy

## Supported versions

ContextFlux is a developer preview. Security fixes are applied to the latest release.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability. Use GitHub's private vulnerability
reporting for this repository. Include affected versions, impact, reproduction steps, and any
suggested mitigation.

## Data boundary

ContextFlux reads source files inside a configured local root and writes a derived cache to
`.contextflux/index.json`. It does not execute indexed code or make network requests. The cache
contains paths, terms, symbols, and source previews; treat it with the same confidentiality as
the repository.

The project rejects symlinks and resolved paths outside the configured root. MCP clients should
still configure the narrowest possible repository root and run the process with ordinary user
permissions.
