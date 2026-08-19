# Debugging

## Visual / Headed Mode

```bash
agent-browser --headed open https://example.com
agent-browser highlight @e1          # Highlight element
agent-browser record start demo.webm # Record session
```

Or via env var: `AGENT_BROWSER_HEADED=1`. Browser extensions work in both headed and headless mode.

## Color Scheme (Dark Mode)

```bash
# Persistent via flag
agent-browser --color-scheme dark open https://example.com

# Via environment variable
AGENT_BROWSER_COLOR_SCHEME=dark agent-browser open https://example.com

# Set mid-session (persists for subsequent commands)
agent-browser set media dark
```

## Local Files (PDFs, HTML)

```bash
agent-browser --allow-file-access open file:///path/to/document.pdf
agent-browser --allow-file-access open file:///path/to/page.html
agent-browser screenshot output.png
```

## Timeouts

Default Playwright timeout is 25s. Override with `AGENT_BROWSER_DEFAULT_TIMEOUT` (ms). For slow pages, prefer explicit waits over raising the timeout:

```bash
agent-browser wait --load networkidle              # network settle
agent-browser wait "#content"                       # element appears
agent-browser wait --url "**/dashboard"             # URL pattern
agent-browser wait --fn "document.readyState === 'complete'"
agent-browser wait 5000                             # fixed delay (last resort)
```
