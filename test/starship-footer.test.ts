import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// Exercise the real formatter without loading Pi's UI or reading credentials.
const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		const exports = {
			"@earendil-works/pi-coding-agent": "getAgentDir",
			"@earendil-works/pi-tui": "truncateToWidth",
		};
		const name = exports[specifier as keyof typeof exports];
		if (!name) return nextResolve(specifier, context);
		return {
			url: `data:text/javascript,${encodeURIComponent(`export function ${name}() { throw new Error("Unexpected Pi runtime call in formatter test"); }`)}`,
			shortCircuit: true,
		};
	},
});
const { formatCodexUsage } = await import("../extensions/starship-footer.ts");
hooks.deregister();

const window = (seconds: number | string | null | undefined, percent = 39) => ({
	used_percent: percent,
	limit_window_seconds: seconds,
});

test("weekly-only primary window is 7d, not 5h", () => {
	assert.deepEqual(formatCodexUsage({ rate_limit: {
		primary_window: window(604800), secondary_window: null,
	} }), ["Codex 7d:39%"]);
});

test("normal five-hour and weekly windows keep their labels", () => {
	assert.deepEqual(formatCodexUsage({ rate_limit: {
		primary_window: window(18000, 0), secondary_window: window(604800),
	} }), ["Codex 5h:0%", "Codex 7d:39%"]);
});

test("duration wins over window position and accepts numeric strings", () => {
	assert.deepEqual(formatCodexUsage({ rate_limit: {
		primary_window: window("604800"), secondary_window: window("18000", 12),
	} }), ["Codex 7d:39%", "Codex 5h:12%"]);
});

test("other reported durations are not mislabeled", () => {
	for (const [seconds, label] of [[1800, "30m"], [86400, "1d"], [7200, "2h"], [45, "45s"]] as const) {
		assert.deepEqual(formatCodexUsage({ rate_limit: { primary_window: window(seconds) } }), [`Codex ${label}:39%`]);
	}
});

test("missing or invalid duration uses neutral labels, not guesses from reset countdown", () => {
	for (const seconds of [undefined, null, "", "bad", 0, -1, NaN, Infinity]) {
		const result = formatCodexUsage({ rate_limit: {
			primary_window: { ...window(seconds), reset_after_seconds: 1800, reset_at: 1789046031 },
			secondary_window: window(seconds),
		} });
		assert.match(result[0], /^Codex primary:39% 0h30m→/);
		assert.equal(result[1], "Codex secondary:39%");
	}
});

test("weekly label does not change usage or reset information", () => {
	const resetAt = 1789046031;
	const time = new Date(resetAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	assert.deepEqual(formatCodexUsage({ rate_limit: { primary_window: {
		...window(604800), reset_after_seconds: 445836, reset_at: resetAt,
	} } }), [`Codex 7d:39% 123h50m→${time}`]);
});

test("absent limits and windows with no percentage are omitted", () => {
	for (const usage of [undefined, {}, { rate_limit: null }, { rate_limit: { primary_window: { limit_window_seconds: 604800 } } }]) {
		assert.deepEqual(formatCodexUsage(usage), []);
	}
});
