/** A practical, dependency-free Vim-style prompt editor for Pi. */
import { CustomEditor, type ExtensionAPI, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import {
	CURSOR_MARKER,
	decodeKittyPrintable,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	type EditorTheme,
	type TUI,
} from "@earendil-works/pi-tui";
import { PiEditorAdapter } from "./modal-editor/adapter.ts";
import { offsetToPosition, positionToOffset, snapCursor, sameContent, type DocumentSnapshot, VimCore } from "./modal-editor/core.ts";

const ESC = "\x1b";
const markerPattern = /\[paste #(\d+)( (\+\d+ lines|\d+ chars))?\]/g;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function printableInput(data: string): string | undefined {
	const kitty = decodeKittyPrintable(data);
	if (kitty !== undefined) return kitty;
	if (data.length > 0 && !data.includes(ESC) && data.charCodeAt(0) >= 32 && data !== "\x7f") return data;
	return undefined;
}

interface AtomicSegment { segment: string; index: number; input: string }

function atomicSegments(line: string): AtomicSegment[] {
	const markers = [...line.matchAll(markerPattern)].map((match) => ({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, text: match[0] }));
	const result: AtomicSegment[] = [];
	let markerIndex = 0;
	for (const item of graphemeSegmenter.segment(line)) {
		while (markers[markerIndex] && markers[markerIndex]!.end <= item.index) markerIndex++;
		const marker = markers[markerIndex];
		if (marker && item.index >= marker.start && item.index < marker.end) {
			if (item.index === marker.start) result.push({ segment: marker.text, index: marker.start, input: line });
			continue;
		}
		result.push(item);
	}
	return result;
}

interface InsertDelta { offset: number; remove: number; text: string; cursor: number }

function insertionDelta(before: DocumentSnapshot, text: string, cursor: number, pastes: Map<number, string>): InsertDelta | undefined {
	if (before.text === text) return sameContent(before, { text, pastes }) ? { offset: 0, remove: 0, text: "", cursor: 0 } : undefined;
	const oldParts = atomicSegments(before.text);
	const newParts = atomicSegments(text);
	let first = 0;
	while (first < oldParts.length && first < newParts.length && oldParts[first]!.segment === newParts[first]!.segment) first++;
	let oldLast = oldParts.length, newLast = newParts.length;
	while (oldLast > first && newLast > first && oldParts[oldLast - 1]!.segment === newParts[newLast - 1]!.segment) { oldLast--; newLast--; }
	const start = oldParts[first]?.index ?? before.text.length;
	const end = oldParts[oldLast]?.index ?? before.text.length;
	const newEnd = newParts[newLast]?.index ?? text.length;
	const raw = text.slice(start, newEnd);
	// Registry renumbering or destructive edits of an existing marker are not
	// repeatable. Undo still owns the full pre-insert registry snapshot.
	if (before.text.slice(start, end).includes("[paste #")) return undefined;
	const expand = (value: string) => value.replace(markerPattern, (marker, id) => pastes.get(Number(id)) ?? marker);
	return { offset: start - before.cursor, remove: end - start, text: expand(raw), cursor: cursor >= start ? expand(text.slice(start, cursor)).length : cursor - start };
}

export class VimEditor extends CustomEditor {
	private readonly adapter: PiEditorAdapter;
	private readonly core: VimCore;
	private readonly modalBindings: KeybindingsManager;
	private commandRecording: string[] = [];
	private lastChange?: { commands: string[]; insert?: InsertDelta };
	private insertBaseline?: DocumentSnapshot;
	private delegated = false;
	private boundaryVersion = 0;
	private pastePacket?: string;

	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
		super(tui, theme, keybindings);
		this.modalBindings = keybindings;
		this.adapter = new PiEditorAdapter(this);
		this.core = new VimCore();
		this.startInsertRecording(["i"]);
	}

	override setText(text: string): void {
		super.setText(text);
		if (this.core) this.resetBoundary();
	}

	override insertTextAtCursor(text: string): void {
		if (!text) return;
		if (!this.core || this.delegated) { super.insertTextAtCursor(text); return; }
		// Async clipboard/application insertion gets its own undo transaction.
		this.syncExternal();
		if (this.core.mode === "insert") this.core.finishInsert();
		const before = this.core.snapshot();
		super.insertTextAtCursor(text);
		this.core.mode = "insert";
		this.readIntoCore();
		this.core.saveChange(before);
		this.core.mode = "normal";
		this.core.feed("i");
		this.startInsertRecording(["i"]);
	}

	private resetBoundary(): void {
		this.boundaryVersion++;
		this.adapter.clearNativeUndo();
		const current = this.adapter.read();
		this.core.mode = this.core.mode === "insert" ? "insert" : "normal";
		this.core.resetFromExternal(current.text, positionToOffset(current.text, current.cursor), current.pastes);
		this.lastChange = undefined;
		if (this.core.mode === "insert") this.startInsertRecording(["i"]);
		else { this.commandRecording = []; this.insertBaseline = undefined; this.applyCore(); }
	}

	private readIntoCore(): void {
		const current = this.adapter.read();
		this.core.sync(current.text, positionToOffset(current.text, current.cursor), current.pastes);
	}

	private syncExternal(): void {
		const current = this.adapter.read();
		const offset = positionToOffset(current.text, current.cursor);
		if (current.text !== this.core.text && this.core.mode !== "insert") {
			this.resetBoundary();
		} else {
			// Pi completion can resolve asynchronously without setText. Keep it in
			// the current insert transaction; dot records only the resulting text.
			this.core.sync(current.text, offset, current.pastes);
		}
	}

	private applyCore(): void {
		this.adapter.write(this.core.text, offsetToPosition(this.core.text, this.core.cursor), this.core.pastes);
		this.readIntoCore();
	}

	private startInsertRecording(commands: string[]): void {
		this.commandRecording = [...commands];
		this.insertBaseline = this.core.snapshot();
	}

	private finishInsert(): void {
		const delta = this.insertBaseline && insertionDelta(this.insertBaseline, this.core.text, this.core.cursor, this.core.pastes);
		const changed = this.core.finishInsert();
		if (changed) this.lastChange = delta ? { commands: [...this.commandRecording], insert: delta } : undefined;
		this.insertBaseline = undefined;
		this.commandRecording = [];
		this.applyCore();
	}

	private replayLastChange(): void {
		const repeat = this.lastChange;
		if (!repeat) return;
		// Replay only parsed modal commands and a semantic edit, never terminal input
		// or CustomEditor callbacks (submit, completion, clipboard, app shortcuts).
		const before = this.core.snapshot();
		for (const key of repeat.commands) this.core.feed(key);
		if (this.core.mode === "insert") {
			const delta = repeat.insert;
			if (delta) {
				const at = this.core.cursor + delta.offset;
				const end = at + delta.remove;
				if (at >= 0 && end <= this.core.text.length && snapCursor(this.core.text, at) === at && snapCursor(this.core.text, end) === end) {
					const text = this.core.text.slice(0, at) + delta.text + this.core.text.slice(end);
					this.core.sync(text, snapCursor(text, at + delta.cursor));
				} else {
					// A relative edit that cannot fit at this location is a complete no-op.
					this.core.sync(before.text, before.cursor, before.pastes);
					this.core.finishInsert();
					this.core.sync(before.text, before.cursor, before.pastes);
					this.applyCore(); return;
				}
			}
			this.core.finishInsert();
		}
		this.applyCore();
	}

	private delegate(data: string): void {
		const before = this.core.snapshot();
		const version = this.boundaryVersion;
		const insert = this.core.mode === "insert";
		let submitted = false;
		const onSubmit = this.onSubmit;
		this.onSubmit = (text) => { submitted = true; onSubmit?.(text); };
		this.delegated = true;
		try { super.handleInput(data); }
		finally { this.onSubmit = onSubmit; this.delegated = false; }
		if (submitted || version !== this.boundaryVersion) { this.resetBoundary(); return; }
		this.readIntoCore();
		const historyKey = this.modalBindings.matches(data, "tui.editor.historyPrevious") || this.modalBindings.matches(data, "tui.editor.historyNext") || matchesKey(data, "up") || matchesKey(data, "down");
		if (historyKey && before.text !== this.core.text) { this.resetBoundary(); return; }
		if (!insert) {
			this.core.saveChange(before);
			this.core.escape();
			this.commandRecording = [];
			// Delegated mutations are undoable, but are not modal dot commands.
			if (before.text !== this.core.text) this.lastChange = undefined;
			this.applyCore();
		}
	}

	handleInput(data: string): void {
		this.syncExternal();
		if (this.pastePacket !== undefined || data.includes("\x1b[200~")) {
			this.pastePacket = (this.pastePacket ?? "") + data;
			const end = this.pastePacket.indexOf("\x1b[201~");
			if (end < 0) return;
			const packet = this.pastePacket.slice(0, end + 6);
			const rest = this.pastePacket.slice(end + 6);
			this.pastePacket = undefined;
			if (this.core.mode !== "insert") {
				this.core.escape(); this.core.feed("i"); this.applyCore();
				this.startInsertRecording(["i"]);
			}
			// Buffer fragments before modal/app routing: pasted Esc/control bytes
			// are content for Pi's paste sanitizer, not callbacks or mode switches.
			this.delegate(packet);
			if (rest) this.handleInput(rest);
			return;
		}
		if (matchesKey(data, "escape")) {
			if (this.core.mode === "insert") { this.finishInsert(); return; }
			if (this.core.mode !== "normal" || this.core.pendingDisplay) {
				this.core.escape(); this.commandRecording = []; this.tui.requestRender(); return;
			}
			this.delegate(data); return;
		}
		if (this.modalBindings.matches(data, "tui.editor.undo")) {
			const insert = this.core.mode === "insert";
			const cursor = this.core.cursor;
			if (insert) this.core.finishInsert();
			const undone = this.core.undo(insert ? "insert" : "normal");
			if (insert) {
				if (!undone) this.core.cursor = cursor;
				this.core.mode = "normal";
				this.core.feed("i");
				this.startInsertRecording(["i"]);
			} else this.commandRecording = [];
			this.applyCore(); return;
		}
		if (this.core.mode === "insert") { this.delegate(data); return; }
		if (matchesKey(data, "ctrl+r")) {
			if (this.core.redo()) this.applyCore();
			this.commandRecording = []; return;
		}
		let key = printableInput(data);
		if (key === undefined) {
			if (matchesKey(data, "left")) key = "h";
			else if (matchesKey(data, "down")) key = "j";
			else if (matchesKey(data, "up")) key = "k";
			else if (matchesKey(data, "right")) key = "l";
			else { this.core.cancelPending(); this.delegate(data); return; }
		}
		if (key === "u" && !this.core.pendingDisplay) {
			if (this.core.undo()) this.applyCore(); this.commandRecording = []; return;
		}
		if (key === "." && !this.core.pendingDisplay) { this.replayLastChange(); return; }
		this.commandRecording.push(key);
		const result = this.core.feed(key);
		this.applyCore();
		if (result.enteredInsert) { this.startInsertRecording(this.commandRecording); return; }
		if (result.completed) {
			if (result.changed && result.repeatable) this.lastChange = { commands: [...this.commandRecording] };
			if (result.changed || (this.core.mode !== "visual" && this.core.mode !== "visual-line")) this.commandRecording = [];
		}
	}

	private renderSelection(lines: string[], width: number): void {
		const selection = this.core.selection;
		if (!selection || lines.length < 3) return;
		const padding = Math.min(this.getPaddingX(), Math.max(0, Math.floor((width - 1) / 2)));
		const contentWidth = Math.max(1, width - 2 * padding);
		const chunks = this.adapter.chunks(Math.max(1, contentWidth - (padding ? 0 : 1)));
		const scroll = this.adapter.getScrollOffset();
		const bodyCount = Math.min(chunks.length - scroll, this.adapter.visibleRows);
		for (let row = 0; row < bodyCount; row++) {
			const chunk = chunks[scroll + row];
			if (!chunk) continue;
			let rendered = " ".repeat(padding);
			for (const part of atomicSegments(chunk.text)) {
				const absolute = chunk.start + part.index;
				const selected = absolute < selection.end && absolute + part.segment.length > (selection.lineStart ?? selection.start);
				const cursor = absolute === this.core.cursor;
				if (cursor && this.focused) rendered += CURSOR_MARKER;
				if (selected || cursor) rendered += `\x1b[7m${part.segment}\x1b[0m`;
				else rendered += part.segment;
			}
			const nextChunk = chunks[scroll + row + 1];
			const continuesOnNextRow = nextChunk?.start === chunk.end;
			if (this.core.cursor === chunk.end && !continuesOnNextRow) {
				if (this.focused) rendered += CURSOR_MARKER;
				rendered += "\x1b[7m \x1b[0m";
			} else if (chunk.text === "" && selection.linewise && chunk.start >= (selection.lineStart ?? selection.start) && chunk.start <= selection.end) {
				rendered += "\x1b[7m \x1b[0m";
			}
			const used = visibleWidth(rendered);
			lines[row + 1] = truncateToWidth(rendered, width, "") + " ".repeat(Math.max(0, width - used));
		}
	}

	render(width: number): string[] {
		this.syncExternal();
		if (width <= 0) return [];
		const padding = Math.min(this.getPaddingX(), Math.max(0, Math.floor((width - 1) / 2)));
		let widest = 1;
		for (const part of graphemeSegmenter.segment(this.core.text)) widest = Math.max(widest, visibleWidth(part.segment));
		// Pi 0.85 recursively wraps a wide grapheme forever at layout width 1.
		// Render with a safe layout width, then clip display only (never the buffer).
		const layoutWidth = Math.max(1, width - 2 * padding - (padding ? 0 : 1));
		// Pi recomputes padding at the chosen width. Allow the full configured
		// padding when enlarging, rather than recycling the original clamped value.
		const configuredPadding = this.getPaddingX();
		const renderWidth = layoutWidth >= widest ? width : Math.max(width, 2 * configuredPadding + widest + (configuredPadding ? 0 : 1));
		const lines = super.render(renderWidth);
		if (lines.length === 0) return lines;
		this.renderSelection(lines, renderWidth);

		const borderIndex = this.adapter.visibleRows + 1;
		const mode = this.core.mode === "visual-line" ? " VISUAL LINE " : ` ${this.core.mode.toUpperCase()} `;
		const pending = this.core.pendingDisplay ? `${this.core.pendingDisplay} ` : "";
		const label = truncateToWidth(`${mode}${pending}`, width, "");
		const labelWidth = visibleWidth(label);
		lines[borderIndex] = truncateToWidth(lines[borderIndex] ?? "", Math.max(0, width - labelWidth), "") + label;
		return lines.map((line) => truncateToWidth(line, width, ""));
	}
}

export default function modalEditor(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setEditorComponent((tui, theme, keybindings) => new VimEditor(tui, theme, keybindings));
	});
}
