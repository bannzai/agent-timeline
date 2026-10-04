---
paths:
  - "fixtures/**"
  - "e2e/**"
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "documents/design/**"
  - "docs/**"
---

# Fixtures and screenshots come from hand-written synthetic sessions

Session logs under `~/.claude/projects` and `~/.codex/sessions` contain private source code, personal information and secrets, and this repository is public. Everything that is committed, attached to a pull request or uploaded as a CI artifact is therefore built from synthetic sessions written by hand (`documents/PROJECT.md`, "Constraints").

- Write fixture sessions by hand in the shape the readers expect: invented project names, invented prompts, paths under `/home/dev/...`. Keep only the keys the readers use
- Take screenshots from the app running against `fixtures/`, on CI. A screenshot of the app showing real sessions is not committed or attached
- When a real log line is needed to reproduce a parser bug, reduce it to its structure (keys and types) and rewrite every value before it becomes a fixture
- Tests reach the fixtures through the environment variables that override the log roots, never through the real home directory
