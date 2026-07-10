---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up. User-invoked via /skill:handoff.
disable-model-invocation: true
---

# Handoff

Write a concise handoff document so a fresh agent can continue the work.

## Process

1. Identify the current goal, completed work, open decisions, and next likely steps from the conversation.
2. Save the handoff to the OS temporary directory, not the current workspace.
3. Tailor the handoff to any user-provided arguments. Treat arguments as the next session's intended focus.
4. Redact secrets, tokens, passwords, API keys, personal data, and private credentials.
5. Do not duplicate content already captured in artifacts such as specs, plans, ADRs, issues, commits, diffs, or generated files. Reference them by path or URL instead.

## Required structure

```markdown
# Handoff — <short title>

## Goal
<what the user is trying to accomplish>

## Current state
<what has been done, what changed, important context>

## Key files / artifacts
- `<path>` — <why it matters>

## Open decisions / risks
- <decision or risk>

## Suggested next steps
1. <next action>
2. <next action>

## Suggested skills
- `/skill:<name>` — <why>
```

Keep it compact and operational. End by telling the user the exact path where the handoff was written.
