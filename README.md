# pi-config

Personal configuration for [Pi](https://pi.dev).

## Included

- Catppuccin Frappe theme
- User-invoked skills (`disable-model-invocation: true`):
  - `/skill:grill-me`
  - `/skill:teach-me`
  - `/skill:handoff`
  - `/skill:catchup`
- Model-invoked skills:
  - `agent-browser`
  - `atomic-commit`
  - `unslop`
- UX extensions:
  - `starship-footer.ts` — Catppuccin footer with context, model, cwd, git, Codex/Claude limits, and cost
  - `modal-editor.ts` — practical Vim-like prompt editing
  - `btw.ts` — ephemeral `/btw <question>` side questions with full session context, no tools, and no history pollution

## Modal editor

The prompt starts in Insert mode. Press literal `Esc` to enter Normal mode. A label on the editor's bottom border shows `INSERT`, `NORMAL`, `VISUAL`, or `VISUAL LINE` and any incomplete count/operator/find command. Literal `Esc` exits Insert/Visual mode or cancels an incomplete command; only an idle Normal-mode `Esc` reaches Pi's interrupt handler.

### Bindings

- Motions: `h j k l`, `0 ^ $`, `gg G`, `w b e` (Vim keyword words), `W B E` (whitespace-delimited WORDs), `f F t T`, `; ,`, and bracket matching `%`.
- Counts and operators: counts compose on either side of `d c y` (`2dw`, `d2w`, `2d3w`). `dd`, `cc`, and `yy` are genuinely linewise and accept counts.
- Text objects: `iw aw iW aW`; inner/around single quotes, double quotes, backticks, and `() [] {} <>`. Bracket objects find the nearest enclosing nested pair. Vim aliases `b` for `()` and `B` for `{}` are supported in object position.
- Insert/change: `i a I A o O`, `x X D C s S r J ~`.
- Yank/paste: `p P`, including linewise placement and counts.
- History: `u` and `Ctrl+R` undo/redo one Normal command or one complete Insert/change session. Pi's configured editor-undo binding (normally `Ctrl+-`) uses that same history and stays in Insert mode when invoked there. `.` repeats parsed modal edits and the net Insert/change text edit (including cursor repositioning), never terminal input or application callbacks.
- Visual: `v` and `V`, followed by the normal motions or text objects, with visible highlighting; `d c y` act on the selection.
- Arrow keys also move in Normal mode. In particular, `j`/`k` and Normal-mode arrows use logical prompt lines directly and never browse Pi prompt history.

Normal-mode `Enter` still submits through Pi. Non-modal control/application shortcuts are passed to `CustomEditor`; Insert mode continues to use Pi's configurable submit/newline, completion, history, clipboard, bracketed-paste, and editing bindings. Slash commands and their completion therefore remain available when typed in Insert mode. Large bracketed pastes retain Pi's compact marker and expand to the complete payload on submission.

### Deliberate deviations and limits

This is a coherent prompt-editing core, not an embedded Vim. It intentionally omits Ex commands, `/` search, registers, macros, marks, and configurable Vim mappings. There is one unnamed yank value. Motions operate on logical prompt lines rather than screen-wrapped rows. `Ctrl+R` is reserved for redo while the prompt is in Normal/Visual mode. Unicode cursor/edit operations use grapheme boundaries, while Vim word classes are approximated with Unicode letters/numbers/underscore versus punctuation.

Submit, `setText`, and prompt-history recall start fresh editing transactions; undo does not cross those boundaries. Programmatic clipboard insertion has its own undo unit. Normal-mode delegated edit controls (Backspace/Delete/Ctrl-W/Ctrl-U/Ctrl-K) remain undoable, but are not recorded for dot. Dot skips insert transactions that destructively edit an existing compact paste marker, and skips relative edits that cannot fit safely at the new cursor. Counts are capped at 1000; repeated paste counts are additionally limited to approximately one million UTF-16 units (a single existing payload is never truncated).

Undo/redo snapshots retain and compare hidden paste payloads, even when visible marker text is unchanged or Pi deletes/renumbers live IDs. Pi kill-ring entries capture expanded payloads when killed, so `Ctrl+Y`/yank-pop do not depend on live marker IDs. Removed IDs are reconciled before further input; the unnamed yank owns expanded text independently of the live registry. Ordinary pastes and undo restoration remain compact; `p`/`P` and dot insert copied payloads as actual text.

The editor uses Pi's supported read APIs and a single guarded adapter for private document/cursor, paste/kill/undo state, and layout access because Pi 0.85 has no public cursor setter or range-edit API. Highlighting reuses Pi's actual marker/CJK-aware wrap map rather than maintaining a second wrapping algorithm. On extremely narrow terminals, wide graphemes may be visually clipped to avoid a Pi 0.85 wrapping recursion bug; the buffer is unchanged. This is the only version-sensitive seam; on an incompatible Pi build it fails with an explicit `modal-editor: incompatible Pi Editor internals` error rather than risking text or hidden paste payloads.

### Reload and test

After changing or installing the extension under `~/.pi/agent/extensions`, run `/reload` inside Pi. The entrypoint remains `extensions/modal-editor.ts`; helper files are below `extensions/modal-editor/` and have no discovery `index.ts`.

Run the executable regression suite from this repository root:

```bash
./test/run-modal-editor-tests.sh
```

The script uses Node's built-in test runner and the installed Pi package (no dependency install). Override `PI_ROOT=/path/to/@earendil-works/pi-coding-agent` if `pi` is not on `PATH`. It temporarily creates local module-resolution symlinks and removes them on exit. Pi 0.85's unbundled index references an omitted experimental server package, so a test-only loader supplies inert link-time exports for that unrelated API.

This repository intentionally excludes local auth tokens, sessions, trust state, and package caches.
