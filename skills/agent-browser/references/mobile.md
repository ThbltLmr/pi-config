# iOS Simulator (Mobile Safari)

Run agent-browser against Mobile Safari on the iOS Simulator (or a real iOS device).

**Requirements**: macOS with Xcode, Appium (`npm install -g appium && appium driver install xcuitest`).

## Basic usage

```bash
# List available simulators
agent-browser device list

# Launch Safari on a specific device
agent-browser -p ios --device "iPhone 16 Pro" open https://example.com

# Same workflow as desktop — snapshot, interact, re-snapshot
agent-browser -p ios snapshot -i
agent-browser -p ios tap @e1          # alias for click
agent-browser -p ios fill @e2 "text"
agent-browser -p ios swipe up         # mobile-specific gesture

# Screenshot
agent-browser -p ios screenshot mobile.png

# Close (shuts down simulator)
agent-browser -p ios close
```

## Real devices

Works with physical iOS devices if pre-configured. Use `--device "<UDID>"` where UDID comes from `xcrun xctrace list devices`.
