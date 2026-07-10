# ADR Format

ADRs live in `docs/adr/` and use sequential numbering: `0001-slug.md`, `0002-slug.md`, etc.

Create `docs/adr/` lazily — only when the first ADR is needed.

## Template

```md
# {Short title of the decision}

{1-3 sentences: what's the context, what did we decide, and why.}
```

That's it. The value is recording that a decision was made and why, not filling out boilerplate.

## Optional sections

Only include these when they add genuine value:

- **Status** frontmatter: `proposed`, `accepted`, `deprecated`, or `superseded by ADR-NNNN`
- **Considered Options** — only when rejected alternatives are worth remembering
- **Consequences** — only when non-obvious downstream effects need to be called out

## Numbering

Scan `docs/adr/` for the highest existing number and increment by one.

## When to offer an ADR

All three must be true:

1. **Hard to reverse** — changing later has meaningful cost.
2. **Surprising without context** — a future reader would wonder why.
3. **Real trade-off** — there were genuine alternatives.

If a decision is easy to reverse, unsurprising, or had no real alternative, skip the ADR.

## Good ADR candidates

- Architectural shape
- Integration patterns between contexts
- Technology choices with lock-in
- Boundary and ownership decisions
- Deliberate deviations from the obvious path
- Constraints invisible in code
- Non-obvious rejected alternatives
