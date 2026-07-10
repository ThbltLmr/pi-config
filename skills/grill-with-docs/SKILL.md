---
name: grill-with-docs
description: Matt Pocock-style grilling: stress-test a plan or design while maintaining project glossary and lightweight ADRs. User-invoked via /skill:grill-with-docs.
disable-model-invocation: true
---

# Grill With Docs

Run a relentless one-question-at-a-time grilling session, and capture durable domain knowledge as it crystallizes.

This skill combines two disciplines:

1. **Grilling** — sharpen a plan/design through precise questions.
2. **Domain modeling** — maintain project language in `CONTEXT.md` and record rare architectural decisions as ADRs.

## Grilling rules

- Ask exactly one question at a time. Multiple questions at once are bewildering.
- For each question, include your recommended answer or default position.
- Walk down the decision tree deliberately: resolve dependencies before downstream choices.
- If a fact can be discovered from the codebase, inspect the code instead of asking the user.
- Decisions belong to the user. Put each decision to them and wait for their answer.
- Do not implement the plan during the grilling session.
- Stop only when the user confirms the plan/design is sufficiently sharp.

## Domain modeling rules

Actively build and sharpen the project's domain model during the session.

### File structure

Most repos have a single root context:

```text
/
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

If `CONTEXT-MAP.md` exists at the root, the repo has multiple contexts. Read it to locate the relevant `CONTEXT.md` and ADR directory.

Create files lazily:

- Create `CONTEXT.md` only when the first domain term is resolved.
- Create `docs/adr/` only when the first ADR is needed.

### Challenge language

- If the user uses a term that conflicts with `CONTEXT.md`, call it out immediately.
- If the user uses vague or overloaded language, propose a precise canonical term.
- Use concrete edge-case scenarios to force boundaries between concepts.
- Cross-check claims against code when the code can confirm or contradict them.

### Update `CONTEXT.md` inline

When a term is resolved, update `CONTEXT.md` immediately. Do not batch glossary updates.

Use [`references/CONTEXT-FORMAT.md`](references/CONTEXT-FORMAT.md).

`CONTEXT.md` is a glossary only. Do not put implementation details, specs, scratch notes, or decisions there.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse** — changing later has meaningful cost.
2. **Surprising without context** — a future reader would wonder why.
3. **Real trade-off** — there were genuine alternatives.

Use [`references/ADR-FORMAT.md`](references/ADR-FORMAT.md).

## Shape of each turn

```markdown
## Question <n>
<one precise question>

**Why this matters:** <short explanation>

**My recommended answer:** <your default, with tradeoffs>

**Docs impact:** <none | term to add/update | ADR candidate>
```

If docs need updating after the user answers, update them before asking the next question.
