# pi-config

Personal configuration for [Pi](https://pi.dev).

## Included

- Catppuccin Frappe theme
- User-invoked skills:
  - `/skill:handoff`
  - `/skill:grill-me`
  - `/skill:grill-with-docs`
  - `/skill:teach-me`
- Prompt templates:
  - `/atomic-commit`
  - `/catchup`
- UX extensions:
  - `starship-footer.ts` — Catppuccin footer with context, model, cwd, git, Codex/Claude limits, and cost
  - `modal-editor.ts` — small Vim-like modal editor
  - `btw.ts` — ephemeral `/btw <question>` side questions with full session context, no tools, and no history pollution

This repository intentionally excludes local auth tokens, sessions, trust state, and package caches.
