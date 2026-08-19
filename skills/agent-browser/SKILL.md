---
name: agent-browser
description: Browser automation CLI for AI agents. Use when the user needs to interact with websites, including navigating pages, filling forms, clicking buttons, taking screenshots, extracting data, testing web apps, or automating any browser task. Triggers include requests to "open a website", "fill out a form", "click a button", "take a screenshot", "scrape data from a page", "test this web app", "login to a site", "automate browser actions", or any task requiring programmatic web interaction.
allowed-tools: Bash(npx agent-browser:*), Bash(agent-browser:*)
---

# Browser Automation with agent-browser

## Core Workflow

1. **Navigate**: `agent-browser open <url>`
2. **Snapshot**: `agent-browser snapshot -i` (get refs like `@e1`, `@e2`)
3. **Interact**: Use refs to click, fill, select.
4. **Re-snapshot**: After navigation or DOM changes, get fresh refs.

```bash
agent-browser open https://example.com/form
agent-browser snapshot -i
# Output: @e1 [input type="email"], @e2 [input type="password"], @e3 [button] "Submit"
agent-browser fill @e1 "user@example.com"
agent-browser fill @e2 "password123"
agent-browser click @e3
agent-browser wait --load networkidle
agent-browser snapshot -i  # Verify result
```

Chain commands with `&&` when you don't need to read intermediate output (e.g. open + wait + screenshot). Run separately when you need to parse output first (e.g. snapshot to discover refs, then interact).

## Essential Commands

```bash
# Navigation
agent-browser open <url>              # aliases: goto, navigate
agent-browser close

# Snapshot (interactive elements)
agent-browser snapshot -i
agent-browser snapshot -i -C          # include divs with onclick / cursor:pointer
agent-browser snapshot -s "#sel"      # scope to selector
agent-browser snapshot -i --json

# Interact (use @refs from snapshot)
agent-browser click @e1
agent-browser fill @e1 "text"         # clear and type
agent-browser type @e1 "text"         # type without clearing
agent-browser select @e1 "option"
agent-browser check @e1
agent-browser press Enter
agent-browser scroll down 500

# Read
agent-browser get text @e1
agent-browser get url
agent-browser get title

# Wait
agent-browser wait @e1                # for element
agent-browser wait --load networkidle # for network idle
agent-browser wait --url "**/page"    # for URL pattern
agent-browser wait 2000               # ms (last resort)

# Capture
agent-browser screenshot
agent-browser screenshot --full
agent-browser screenshot --annotate   # numbered labels overlaid on elements
```

Full command list with all flags: see [references/commands.md](references/commands.md).

## Ref Lifecycle (Important)

Refs (`@e1`, `@e2`, ...) are invalidated when the page changes. Always re-snapshot after:
- Clicking links or buttons that navigate
- Form submissions
- Dynamic content loading (dropdowns, modals)

```bash
agent-browser click @e5              # Navigates
agent-browser snapshot -i            # MUST re-snapshot
agent-browser click @e1              # Use new refs
```

Edge cases and invalidation rules: see [references/snapshot-refs.md](references/snapshot-refs.md).

## Authentication

Prefer the auth vault — the LLM never sees the password:

```bash
echo "pass" | agent-browser auth save github --url https://github.com/login \
  --username user --password-stdin
agent-browser auth login github
```

Full login flows (OAuth, 2FA, state reuse): see [references/authentication.md](references/authentication.md).

## Sessions

For concurrent automations, always use named sessions to avoid conflicts:

```bash
agent-browser --session agent1 open https://site-a.com
agent-browser --session agent2 open https://site-b.com
agent-browser session list
agent-browser --session agent1 close   # always clean up when done
```

Parallel sessions, state persistence, and cleanup: see [references/session-management.md](references/session-management.md).

## Semantic Locators (Alternative to Refs)

When refs are unreliable, use semantic locators:

```bash
agent-browser find text "Sign In" click
agent-browser find label "Email" fill "user@test.com"
agent-browser find role button click --name "Submit"
agent-browser find testid "submit-btn" click
```

## Diffing (Verifying Changes)

```bash
agent-browser snapshot -i            # baseline
agent-browser click @e2              # action
agent-browser diff snapshot          # see what changed (vs last snapshot)

agent-browser diff screenshot --baseline before.png       # visual diff
agent-browser diff url <url1> <url2> --selector "#main"   # compare two pages
```

## Deep-Dive References

| File | When to use |
|------|-------------|
| [references/commands.md](references/commands.md) | Full command reference with all options |
| [references/snapshot-refs.md](references/snapshot-refs.md) | Ref lifecycle, annotated screenshots, semantic locators |
| [references/session-management.md](references/session-management.md) | Parallel sessions, state persistence, cleanup |
| [references/authentication.md](references/authentication.md) | Auth vault, OAuth, 2FA, state reuse |
| [references/eval.md](references/eval.md) | Running JavaScript in the page (shell-quoting traps) |
| [references/mobile.md](references/mobile.md) | iOS Simulator / Mobile Safari workflows |
| [references/security.md](references/security.md) | Content boundaries, domain allowlist, action policy |
| [references/debugging.md](references/debugging.md) | Headed mode, dark mode, recording, local files |
| [references/advanced.md](references/advanced.md) | Config files, native Rust daemon, downloads, PDF |
| [references/profiling.md](references/profiling.md) | Chrome DevTools profiling for performance |
| [references/proxy-support.md](references/proxy-support.md) | Proxy configuration, geo-testing |
| [references/video-recording.md](references/video-recording.md) | Recording workflows |

Ready-to-use templates: [templates/form-automation.sh](templates/form-automation.sh), [templates/authenticated-session.sh](templates/authenticated-session.sh), [templates/capture-workflow.sh](templates/capture-workflow.sh).
