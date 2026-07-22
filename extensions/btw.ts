import type { AssistantMessage, Message, TextContent, ToolResultMessage } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import {
	buildSessionContext,
	convertToLlm,
	copyToClipboard,
	getMarkdownTheme,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	Markdown,
	matchesKey,
	truncateToWidth,
	type TUI,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

const SIDE_QUESTION_PREFIX = `This is an ephemeral side question. Answer it directly and concisely using only the conversation context you already have. Do not continue the main task, and do not try to use tools (none are available for this response). If the answer is not in the existing context, say so.\n\nSide question: `;

type ExchangeStatus = "loading" | "done" | "error";

type Exchange = {
	question: string;
	answer: string;
	status: ExchangeStatus;
};

function textFromAssistant(message: AssistantMessage): string {
	return message.content
		.filter((part): part is TextContent => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function textFromToolResult(message: ToolResultMessage): string {
	return message.content
		.filter((part): part is TextContent => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

/**
 * A snapshot taken while a tool batch is running may end with unresolved tool
 * calls. Providers reject a new user message after such a batch. Replace that
 * active batch with plain text while retaining completed output as context.
 */
function makeToolContextReplaySafe(messages: Message[]): Message[] {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== "assistant") continue;

		const toolCallIds = new Set(
			message.content.filter((part) => part.type === "toolCall").map((part) => part.id),
		);
		if (toolCallIds.size === 0) continue;

		const trailingResults = messages
			.slice(i + 1)
			.filter(
				(candidate): candidate is ToolResultMessage =>
					candidate.role === "toolResult" && toolCallIds.has(candidate.toolCallId),
			);
		const resolvedIds = new Set(trailingResults.map((result) => result.toolCallId));
		if ([...toolCallIds].every((id) => resolvedIds.has(id))) return messages;

		const safe: Message[] = messages.slice(0, i);
		const assistantText = message.content.filter((part): part is TextContent => part.type === "text");
		if (assistantText.length > 0) safe.push({ ...message, content: assistantText });

		const completedOutput = trailingResults
			.map((result) => {
				const text = textFromToolResult(result).trim();
				return text ? `${result.toolName}:\n${text}` : "";
			})
			.filter(Boolean)
			.join("\n\n");
		if (completedOutput) {
			safe.push({
				role: "user",
				content: [{ type: "text", text: `Completed tool output from the active turn:\n\n${completedOutput}` }],
				timestamp: Date.now(),
			});
		}

		for (const trailing of messages.slice(i + 1)) {
			if (trailing.role !== "toolResult" || !toolCallIds.has(trailing.toolCallId)) safe.push(trailing);
		}
		return safe;
	}

	return messages;
}

function snapshotMessages(ctx: ExtensionCommandContext, liveAssistant: AssistantMessage | undefined, question: string): Message[] {
	const sessionContext = buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId());
	const messages = makeToolContextReplaySafe(convertToLlm(sessionContext.messages));
	const liveText = liveAssistant ? textFromAssistant(liveAssistant).trim() : "";

	if (liveAssistant && liveText) {
		messages.push({
			...liveAssistant,
			content: [{ type: "text", text: liveText }],
		});
	}

	messages.push({
		role: "user",
		content: [{ type: "text", text: SIDE_QUESTION_PREFIX + question }],
		timestamp: Date.now(),
	});
	return messages;
}

function pad(content: string, width: number): string {
	const clipped = truncateToWidth(content, width, "");
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

class BtwOverlay {
	private selected: Exchange;
	private scrollOffset = 0;
	private autoFollow = true;
	private copied = false;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly history: Exchange[],
		private readonly current: Exchange,
		private readonly abortController: AbortController,
		private readonly done: () => void,
	) {
		this.selected = current;
	}

	private items(): Exchange[] {
		return this.history.includes(this.current) ? this.history : [...this.history, this.current];
	}

	updated(): void {
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) {
			if (this.current.status === "loading") this.abortController.abort();
			this.done();
			return;
		}

		if (this.current.status !== "loading" && (matchesKey(data, "enter") || matchesKey(data, "space"))) {
			this.done();
			return;
		}

		const items = this.items();
		const index = Math.max(0, items.indexOf(this.selected));
		if (matchesKey(data, "left") && index > 0) {
			this.selected = items[index - 1]!;
			this.scrollOffset = 0;
			this.autoFollow = false;
			this.copied = false;
		} else if (matchesKey(data, "right") && index < items.length - 1) {
			this.selected = items[index + 1]!;
			this.scrollOffset = 0;
			this.autoFollow = this.selected === this.current && this.current.status === "loading";
			this.copied = false;
		} else if (matchesKey(data, "up")) {
			this.scrollOffset = Math.max(0, this.scrollOffset - 1);
			this.autoFollow = false;
		} else if (matchesKey(data, "down")) {
			this.scrollOffset++;
			this.autoFollow = false;
		} else if (data === "c" && this.selected.status === "done") {
			void copyToClipboard(this.selected.answer)
				.then(() => {
					this.copied = true;
					this.updated();
				})
				.catch(() => {
					this.copied = false;
					this.updated();
				});
		} else if (data === "x") {
			const keepCurrent = this.history.includes(this.current);
			this.history.splice(0, this.history.length, ...(keepCurrent ? [this.current] : []));
			this.selected = this.current;
			this.scrollOffset = 0;
		}
		this.updated();
	}

	render(width: number): string[] {
		const innerWidth = Math.max(1, width - 2);
		const row = (content = "") =>
			this.theme.fg("border", "│") + pad(content, innerWidth) + this.theme.fg("border", "│");
		const items = this.items();
		const selectedIndex = Math.max(0, items.indexOf(this.selected));
		const title = ` BTW${items.length > 1 ? ` ${selectedIndex + 1}/${items.length}` : ""} `;
		const titleTail = Math.max(0, innerWidth - visibleWidth(title));
		const lines = [
			this.theme.fg("borderAccent", `╭${title}${"─".repeat(titleTail)}╮`),
		];

		const wrappedQuestion = wrapTextWithAnsi(
			this.theme.fg("accent", this.selected.question),
			Math.max(1, innerWidth - 2),
		);
		const questionLines = wrappedQuestion.length > 4
			? [...wrappedQuestion.slice(0, 3), truncateToWidth(`${wrappedQuestion[3]}…`, Math.max(1, innerWidth - 2), "")]
			: wrappedQuestion;
		for (const questionLine of questionLines) lines.push(row(` ${questionLine}`));
		lines.push(row());

		const displayText =
			this.selected.status === "loading" && !this.selected.answer
				? this.theme.fg("dim", "Thinking…")
				: this.selected.status === "error"
					? this.theme.fg("error", this.selected.answer)
					: this.selected.answer || this.theme.fg("dim", "No text response");
		const bodyLines =
			this.selected.status === "done"
				? new Markdown(displayText, 1, 0, getMarkdownTheme()).render(innerWidth)
				: wrapTextWithAnsi(` ${displayText}`, Math.max(1, innerWidth));
		const bodyHeight = Math.max(3, Math.floor(this.tui.terminal.rows * 0.68) - lines.length - 3);
		const maxOffset = Math.max(0, bodyLines.length - bodyHeight);
		if (this.autoFollow && this.selected === this.current) this.scrollOffset = maxOffset;
		this.scrollOffset = Math.min(this.scrollOffset, maxOffset);
		for (const bodyLine of bodyLines.slice(this.scrollOffset, this.scrollOffset + bodyHeight)) lines.push(row(bodyLine));

		if (bodyLines.length > bodyHeight) {
			lines.push(row(this.theme.fg("dim", ` ↑↓ scroll · ${this.scrollOffset + 1}-${Math.min(bodyLines.length, this.scrollOffset + bodyHeight)}/${bodyLines.length}`)));
		}
		const historyHint = items.length > 1 ? " · ←→ history" : "";
		const statusHint = this.current.status === "loading"
			? "Esc cancel"
			: `${this.copied ? "Copied! · " : ""}Enter/Space/Esc close · c copy · x clear${historyHint}`;
		lines.push(row(` ${this.theme.fg("dim", statusHint)}`));
		lines.push(this.theme.fg("borderAccent", `╰${"─".repeat(innerWidth)}╯`));
		return lines;
	}

	invalidate(): void {}
}

async function askSideQuestion(
	ctx: ExtensionCommandContext,
	messages: Message[],
	systemPrompt: string,
	exchange: Exchange,
	controller: AbortController,
	onUpdate: () => void,
): Promise<void> {
	const model = ctx.model;
	if (!model) throw new Error("No model selected");
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) throw new Error(auth.ok ? `No API key for ${model.provider}` : auth.error);

	const stream = streamSimple(
		model,
		{ systemPrompt, messages },
		{
			apiKey: auth.apiKey,
			headers: auth.headers,
			env: auth.env,
			signal: controller.signal,
			reasoning: "minimal",
			maxTokens: 2_048,
			cacheRetention: "short",
			sessionId: ctx.sessionManager.getSessionId(),
		},
	);

	for await (const event of stream) {
		const partial = "partial" in event ? event.partial : event.type === "done" ? event.message : event.error;
		exchange.answer = textFromAssistant(partial);
		onUpdate();
	}
	const response = await stream.result();
	if (response.stopReason === "aborted") throw new Error("Cancelled");
	if (response.stopReason === "error") throw new Error(response.errorMessage || "Side question failed");
	exchange.answer = textFromAssistant(response).trim();
	exchange.status = "done";
	onUpdate();
}

export default function btw(pi: ExtensionAPI): void {
	let history: Exchange[] = [];
	let liveAssistant: AssistantMessage | undefined;

	pi.on("session_start", () => {
		history = [];
		liveAssistant = undefined;
	});
	pi.on("message_start", (event) => {
		if (event.message.role === "assistant") liveAssistant = event.message;
	});
	pi.on("message_update", (event) => {
		if (event.message.role === "assistant") liveAssistant = event.message;
	});
	pi.on("message_end", (event) => {
		if (event.message.role === "assistant") liveAssistant = undefined;
	});

	pi.registerCommand("btw", {
		description: "Ask an ephemeral side question without interrupting the main task",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/btw requires interactive mode", "error");
				return;
			}
			const question = args.trim();
			if (!question) {
				ctx.ui.notify("Usage: /btw <question>", "warning");
				return;
			}
			if (!ctx.model) {
				ctx.ui.notify("No model selected", "error");
				return;
			}

			const messages = snapshotMessages(ctx, liveAssistant, question);
			const systemPrompt = ctx.getSystemPrompt();
			const exchange: Exchange = { question, answer: "", status: "loading" };
			const controller = new AbortController();
			let overlay: BtwOverlay | undefined;
			let closed = false;
			let completed = false;
			let requestPromise: Promise<void> | undefined;

			await ctx.ui.custom<void>(
				(tui, theme, _keybindings, done) => {
					overlay = new BtwOverlay(tui, theme, history, exchange, controller, () => {
						closed = true;
						done(undefined);
					});
					requestPromise = askSideQuestion(ctx, messages, systemPrompt, exchange, controller, () => {
						if (!closed) overlay?.updated();
					})
						.then(() => {
							completed = true;
							history.push(exchange);
							if (!closed) overlay?.updated();
						})
						.catch((error: unknown) => {
							if (controller.signal.aborted || closed) return;
							exchange.status = "error";
							exchange.answer = error instanceof Error ? error.message : String(error);
							overlay?.updated();
						});
					return overlay;
				},
				{
					overlay: true,
					overlayOptions: {
						anchor: "center",
						width: "75%",
						minWidth: 52,
						maxHeight: "80%",
						margin: 1,
					},
				},
			);

			if (!completed && exchange.status === "loading") controller.abort();
			await requestPromise;
		},
	});
}
