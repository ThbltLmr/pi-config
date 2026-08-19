# JavaScript Evaluation (`eval`)

Run JavaScript in the browser context. **Shell quoting can corrupt complex expressions** — use `--stdin` or `-b` (base64) to avoid issues.

## Quick rules

- Single-line, no nested quotes → regular `eval 'expression'` is fine.
- Nested quotes, arrow functions, template literals, multiline → use `eval --stdin <<'EVALEOF'`.
- Programmatic / generated scripts → use `eval -b` with base64.

## Examples

```bash
# Simple
agent-browser eval 'document.title'
agent-browser eval 'document.querySelectorAll("img").length'

# Complex JS via stdin (RECOMMENDED for anything non-trivial)
agent-browser eval --stdin <<'EVALEOF'
JSON.stringify(
  Array.from(document.querySelectorAll("img"))
    .filter(i => !i.alt)
    .map(i => ({ src: i.src.split("/").pop(), width: i.width }))
)
EVALEOF

# Base64 (avoids all shell escaping)
agent-browser eval -b "$(echo -n 'Array.from(document.querySelectorAll("a")).map(a => a.href)' | base64)"
```

## Why this matters

When the shell processes your command, inner double quotes, `!` (history expansion), backticks, and `$()` can all corrupt the JavaScript before it reaches agent-browser. The `--stdin` and `-b` flags bypass shell interpretation entirely.
