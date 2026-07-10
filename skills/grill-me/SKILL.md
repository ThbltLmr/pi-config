---
name: grill-me
description: A relentless one-question-at-a-time interview to stress-test a plan or design. User-invoked via /skill:grill-me.
disable-model-invocation: true
---

# Grill Me

Interview the user relentlessly about a plan, design, or decision until you both reach shared understanding.

## Rules

- Ask exactly one question at a time. Multiple questions at once are bewildering.
- For each question, include your recommended answer or default position.
- Walk down the decision tree deliberately: resolve dependencies before downstream choices.
- If a fact can be discovered from the codebase, inspect the code instead of asking the user.
- Decisions belong to the user. Put each decision to them and wait for their answer.
- Challenge vague language, hidden assumptions, and skipped edge cases.
- Do not implement the plan during the grilling session.
- Stop only when the user confirms the plan/design is sufficiently sharp.

## Shape of each turn

```markdown
## Question <n>
<one precise question>

**Why this matters:** <short explanation>

**My recommended answer:** <your default, with tradeoffs>
```

After the user answers, either accept and move to the next unresolved branch, or challenge the answer if it creates a contradiction or unresolved risk.
