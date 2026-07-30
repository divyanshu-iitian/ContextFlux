# Contributing to ContextFlux

Thanks for helping improve repository retrieval for coding agents.

## Before opening an issue

- Search existing issues.
- Include the language, repository shape, concrete task, expected files, and actual ranked files.
- Remove secrets and proprietary source from examples.
- For ranking requests, prefer a minimal reproducible benchmark case over a screenshot.

## Development

Requirements: Node.js 20+ and npm.

```bash
npm ci
npm run check
npm test
npm run build
```

Design constraints:

- Keep indexing and retrieval local-only by default.
- Never execute indexed repository code.
- Preserve source paths and line ranges in context output.
- Preserve the measured packet budget and add a regression test for budget changes.
- Compare retrieval changes with the lexical baseline and report regressions, not only wins.
- Avoid adding a hosted service, telemetry, or embedding dependency to the default path.

## Pull requests

Keep each pull request focused. Explain the user-visible problem, approach, tests, and benchmark
impact. New retrieval heuristics should include cases where they help and cases where they must
not dominate. Run all validation commands before requesting review.

By contributing, you agree that your contribution is licensed under the MIT License.
