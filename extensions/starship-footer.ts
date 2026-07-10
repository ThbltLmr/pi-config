/**
 * Starship-style Catppuccin footer, inspired by ~/.claude/statusline-command.sh.
 *
 * Segments: context %, model, cwd, git branch/status, active-provider quota, session cost.
 * Supports OpenAI Codex 5h/7d windows and Anthropic OAuth usage when available.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const CACHE_DIR = join(process.env.XDG_CACHE_HOME ?? join(process.env.HOME ?? "", ".cache"), "pi-statusline");
const ANTHROPIC_CACHE_FILE = join(CACHE_DIR, "anthropic-usage.json");
const CODEX_CACHE_FILE = join(CACHE_DIR, "openai-codex-usage.json");
const CACHE_MAX_AGE_MS = 60_000;

type AuthCredential = { access?: string; accountId?: string };

type AnthropicUsageBucket = {
	utilization?: number | null;
	resets_at?: string | null;
	limit_dollars?: number | null;
	used_dollars?: number | null;
	remaining_dollars?: number | null;
};

type AnthropicUsage = Record<string, AnthropicUsageBucket | null | undefined>;

type CodexUsage = {
	rate_limit?: {
		primary_window?: CodexRateWindow | null;
		secondary_window?: CodexRateWindow | null;
	} | null;
	credits?: { unlimited?: boolean } | null;
};

type CodexRateWindow = {
	used_percent?: number | string | null;
	reset_after_seconds?: number | string | null;
	reset_at?: number | string | null;
};

type GitState = {
	branch?: string;
	flags?: string;
};

function fg(r: number, g: number, b: number): string {
	return `\x1b[38;2;${r};${g};${b}m`;
}

function bg(r: number, g: number, b: number): string {
	return `\x1b[48;2;${r};${g};${b}m`;
}

const reset = "\x1b[0m";
const crustFg = fg(35, 38, 52);
const redBg = bg(231, 130, 132);
const peachBg = bg(239, 159, 118);
const yellowBg = bg(229, 200, 144);
const greenBg = bg(166, 209, 137);
const sapphireBg = bg(133, 193, 220);
const lavenderBg = bg(186, 187, 241);
const mauveBg = bg(202, 158, 230);

function segment(background: string, text: string): string {
	return `${background}${crustFg} ${text} ${reset}`;
}

function shortPath(cwd: string): string {
	const home = process.env.HOME ?? "";
	let p = home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
	const parts = p.split("/").filter(Boolean);
	if (p.startsWith("~")) {
		const withoutTilde = p.slice(2).split("/").filter(Boolean);
		if (withoutTilde.length > 2) p = `…/${withoutTilde.slice(-3).join("/")}`;
	} else if (parts.length > 3) {
		p = `…/${parts.slice(-3).join("/")}`;
	}
	return p || cwd;
}

function getContextPercent(ctx: ExtensionContext): number | undefined {
	const usage = ctx.getContextUsage();
	if (usage?.percent != null) return Math.round(usage.percent);
	return undefined;
}

function getSessionCost(ctx: ExtensionContext): number {
	let cost = 0;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			cost += (entry.message as AssistantMessage).usage?.cost?.total ?? 0;
		}
	}
	return cost;
}

function readJsonFile<T>(path: string): T | undefined {
	try {
		if (!existsSync(path)) return undefined;
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return undefined;
	}
}

function writeJsonFile(path: string, data: unknown): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	writeFileSync(path, JSON.stringify(data), { mode: 0o600 });
}

function cacheIsFresh(path: string): boolean {
	try {
		return Date.now() - statSync(path).mtimeMs < CACHE_MAX_AGE_MS;
	} catch {
		return false;
	}
}

function readAuthCredential(provider: string): AuthCredential | undefined {
	try {
		const auth = JSON.parse(readFileSync(join(getAgentDir(), "auth.json"), "utf8")) as Record<string, AuthCredential>;
		return auth[provider];
	} catch {
		return undefined;
	}
}

async function refreshAnthropicUsage(): Promise<AnthropicUsage | undefined> {
	if (cacheIsFresh(ANTHROPIC_CACHE_FILE)) return readJsonFile<AnthropicUsage>(ANTHROPIC_CACHE_FILE);
	const token = readAuthCredential("anthropic")?.access;
	if (!token) return readJsonFile<AnthropicUsage>(ANTHROPIC_CACHE_FILE);

	try {
		const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
				"anthropic-beta": "oauth-2025-04-20",
			},
		});
		if (!response.ok) return readJsonFile<AnthropicUsage>(ANTHROPIC_CACHE_FILE);
		const usage = (await response.json()) as AnthropicUsage;
		writeJsonFile(ANTHROPIC_CACHE_FILE, usage);
		return usage;
	} catch {
		return readJsonFile<AnthropicUsage>(ANTHROPIC_CACHE_FILE);
	}
}

async function refreshCodexUsage(): Promise<CodexUsage | undefined> {
	if (cacheIsFresh(CODEX_CACHE_FILE)) return readJsonFile<CodexUsage>(CODEX_CACHE_FILE);
	const credential = readAuthCredential("openai-codex");
	if (!credential?.access) return readJsonFile<CodexUsage>(CODEX_CACHE_FILE);

	try {
		const headers: Record<string, string> = {
			Accept: "application/json",
			Authorization: `Bearer ${credential.access}`,
		};
		if (credential.accountId) headers["ChatGPT-Account-Id"] = credential.accountId;

		const response = await fetch("https://chatgpt.com/backend-api/wham/usage", { headers });
		if (!response.ok) return readJsonFile<CodexUsage>(CODEX_CACHE_FILE);
		const usage = (await response.json()) as CodexUsage;
		writeJsonFile(CODEX_CACHE_FILE, usage);
		return usage;
	} catch {
		return readJsonFile<CodexUsage>(CODEX_CACHE_FILE);
	}
}

function formatDuration(seconds: number): string {
	const totalMinutes = Math.max(0, Math.floor(seconds / 60));
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return `${hours}h${minutes}m`;
}

function formatEpochSeconds(epochSeconds: number): string {
	return new Date(epochSeconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function toNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

function formatAnthropicReset(resetAt: string | null | undefined): string {
	if (!resetAt) return "";
	const resetMs = Date.parse(resetAt);
	if (!Number.isFinite(resetMs)) return "";
	const diffMs = resetMs - Date.now();
	if (diffMs <= 0) return "";
	const resetTime = new Date(resetMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	return ` ${formatDuration(diffMs / 1000)}→${resetTime}`;
}

function formatAnthropicBucket(label: string, bucket: AnthropicUsageBucket | null | undefined): string | undefined {
	if (!bucket || bucket.utilization == null) return undefined;
	return `${label}:${bucket.utilization.toFixed(0)}%${formatAnthropicReset(bucket.resets_at)}`;
}

function formatAnthropicUsage(usage: AnthropicUsage | undefined): string[] {
	if (!usage) return [];

	const fiveHour = formatAnthropicBucket("Claude 5h", usage.five_hour);
	const sevenDay = formatAnthropicBucket("7d", usage.seven_day);
	if (fiveHour || sevenDay) return [fiveHour, sevenDay].filter(Boolean) as string[];

	// Newer Anthropic plans sometimes expose named dollar buckets instead of five_hour/seven_day.
	for (const [name, bucket] of Object.entries(usage)) {
		if (!bucket?.utilization || bucket.remaining_dollars == null) continue;
		const shortName = name.replace(/_/g, "-").slice(0, 12);
		return [`Claude ${shortName}:${bucket.utilization.toFixed(0)}% $${bucket.remaining_dollars.toFixed(0)} left`];
	}
	return [];
}

function formatCodexWindow(label: string, window: CodexRateWindow | null | undefined): string | undefined {
	const percent = toNumber(window?.used_percent);
	if (percent === undefined) return undefined;
	const resetAfter = toNumber(window?.reset_after_seconds);
	const resetAt = toNumber(window?.reset_at);
	const resetSuffix = resetAfter !== undefined && resetAt !== undefined ? ` ${formatDuration(resetAfter)}→${formatEpochSeconds(resetAt)}` : "";
	return `Codex ${label}:${Math.round(percent)}%${resetSuffix}`;
}

function formatCodexUsage(usage: CodexUsage | undefined): string[] {
	if (!usage) return [];
	const fiveHour = formatCodexWindow("5h", usage.rate_limit?.primary_window);
	const sevenDay = formatCodexWindow("7d", usage.rate_limit?.secondary_window);
	return [fiveHour, sevenDay].filter(Boolean) as string[];
}

function activeQuotaSegments(ctx: ExtensionContext, anthropic: AnthropicUsage | undefined, codex: CodexUsage | undefined): string[] {
	const provider = ctx.model?.provider;
	if (provider === "openai-codex") return formatCodexUsage(codex);
	if (provider === "anthropic") return formatAnthropicUsage(anthropic);

	// Fallback for other providers: show whichever quotas are available, Codex first because it is your default.
	const codexSegments = formatCodexUsage(codex);
	if (codexSegments.length > 0) return codexSegments;
	return formatAnthropicUsage(anthropic);
}

async function refreshGitState(pi: ExtensionAPI, cwd: string): Promise<GitState> {
	const result = await pi.exec(
		"bash",
		[
			"-lc",
			[
				"git rev-parse --is-inside-work-tree --no-optional-locks >/dev/null 2>&1 || exit 0",
				"branch=$(git --no-optional-locks symbolic-ref --short HEAD 2>/dev/null || git --no-optional-locks rev-parse --short HEAD 2>/dev/null || true)",
				"porcelain=$(git --no-optional-locks status --porcelain 2>/dev/null || true)",
				"flags=",
				"if printf '%s\\n' \"$porcelain\" | grep -qE '^( M|M |MM|A | D|D |R |C )'; then flags=\"${flags}!\"; fi",
				"if printf '%s\\n' \"$porcelain\" | grep -qE '^\\?\\?'; then flags=\"${flags}?\"; fi",
				"ahead=$(git --no-optional-locks rev-list --count @{u}..HEAD 2>/dev/null || echo 0)",
				"behind=$(git --no-optional-locks rev-list --count HEAD..@{u} 2>/dev/null || echo 0)",
				"if [ \"$ahead\" -gt 0 ] 2>/dev/null; then flags=\"${flags}⇡${ahead}\"; fi",
				"if [ \"$behind\" -gt 0 ] 2>/dev/null; then flags=\"${flags}⇣${behind}\"; fi",
				"printf '%s\\t%s' \"$branch\" \"$flags\"",
			].join("\n"),
		],
		{ cwd, timeout: 5_000 },
	);
	if (result.code !== 0 || !result.stdout.trim()) return {};
	const [branch, flags] = result.stdout.split("\t");
	return { branch: branch?.trim() || undefined, flags: flags?.trim() || undefined };
}

export default function starshipFooter(pi: ExtensionAPI): void {
	let anthropicUsage: AnthropicUsage | undefined = readJsonFile<AnthropicUsage>(ANTHROPIC_CACHE_FILE);
	let codexUsage: CodexUsage | undefined = readJsonFile<CodexUsage>(CODEX_CACHE_FILE);
	let gitState: GitState = {};
	let refreshTimer: ReturnType<typeof setInterval> | undefined;
	let requestRender: (() => void) | undefined;

	async function refresh(ctx: ExtensionContext): Promise<void> {
		const [nextAnthropicUsage, nextCodexUsage, nextGitState] = await Promise.all([
			refreshAnthropicUsage(),
			refreshCodexUsage(),
			refreshGitState(pi, ctx.cwd),
		]);
		anthropicUsage = nextAnthropicUsage;
		codexUsage = nextCodexUsage;
		gitState = nextGitState;
		requestRender?.();
	}

	function install(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui") return;

		ctx.ui.setFooter((tui) => {
			requestRender = () => tui.requestRender();

			return {
				invalidate() {},
				render(width: number): string[] {
					const parts: string[] = [];
					const contextPercent = getContextPercent(ctx);
					if (contextPercent !== undefined) parts.push(segment(redBg, `ctx:${contextPercent}%`));

					const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no model";
					parts.push(segment(peachBg, model));
					parts.push(segment(yellowBg, shortPath(ctx.cwd)));

					if (gitState.branch) {
						parts.push(segment(greenBg, `${gitState.branch}${gitState.flags ? ` ${gitState.flags}` : ""}`));
					}

					for (const [index, quotaSegment] of activeQuotaSegments(ctx, anthropicUsage, codexUsage).entries()) {
						parts.push(segment(index === 0 ? sapphireBg : lavenderBg, quotaSegment));
					}

					const cost = getSessionCost(ctx);
					if (cost > 0) parts.push(segment(mauveBg, `$${cost.toFixed(3)}`));

					return [truncateToWidth(parts.join(""), width, "")];
				},
			};
		});
	}

	pi.on("session_start", async (_event, ctx) => {
		// Let package-provided UI hooks settle, then claim the footer.
		setTimeout(() => install(ctx), 0);
		void refresh(ctx);
		refreshTimer = setInterval(() => void refresh(ctx), CACHE_MAX_AGE_MS);
	});

	pi.on("model_select", async (_event, ctx) => {
		requestRender?.();
		void refresh(ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		void refresh(ctx);
	});

	pi.on("session_shutdown", async () => {
		if (refreshTimer) clearInterval(refreshTimer);
		refreshTimer = undefined;
		requestRender = undefined;
	});
}
