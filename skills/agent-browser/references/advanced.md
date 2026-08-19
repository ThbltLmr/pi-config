# Advanced

## Configuration File

Create `agent-browser.json` in the project root for persistent settings:

```json
{
  "headed": true,
  "proxy": "http://localhost:8080",
  "profile": "./browser-data"
}
```

**Priority** (lowest to highest): `~/.agent-browser/config.json` < `./agent-browser.json` < env vars < CLI flags.

- Use `--config <path>` or `AGENT_BROWSER_CONFIG` env var for a custom path (errors if missing/invalid).
- CLI options map to camelCase keys (e.g. `--executable-path` → `"executablePath"`).
- Boolean flags accept `true`/`false` (e.g. `--headed false` overrides config).
- Extensions from user + project configs are merged, not replaced.

## Connect to Existing Chrome

```bash
# Auto-discover running Chrome with remote debugging enabled
agent-browser --auto-connect open https://example.com
agent-browser --auto-connect snapshot

# Or with explicit CDP port
agent-browser --cdp 9222 snapshot
```

## Downloads

```bash
agent-browser download @e1 ./file.pdf                  # click element to trigger
agent-browser wait --download ./output.zip             # wait for download to complete
agent-browser --download-path ./downloads open <url>   # set default directory
```

## PDF Output

```bash
agent-browser pdf output.pdf
```

## Experimental: Native Mode

agent-browser has an experimental native Rust daemon that talks to Chrome via CDP directly, bypassing Node.js and Playwright. Opt-in, not production-ready yet.

```bash
agent-browser --native open example.com

# Or via env var
export AGENT_BROWSER_NATIVE=1
agent-browser open example.com
```

Supports Chromium and Safari (via WebDriver). Firefox / WebKit not yet supported. All core commands work identically. Use `agent-browser close` before switching between native and default mode in the same session.
