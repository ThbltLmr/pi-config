import type { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { CursorPosition } from "./core.ts";

interface EditorState {
	lines: string[];
	cursorLine: number;
	cursorCol: number;
}

interface KillOptions { prepend?: boolean; accumulate?: boolean }

interface VersionSensitiveEditor {
	killRing: { push(text: string, options: KillOptions): void };
	undoStack: { clear(): void };
	state: EditorState;
	pastes: Map<number, string>;
	pasteCounter: number;
	buildVisualLineMap(width: number): Array<{ logicalLine: number; startCol: number; length: number }>;
	renderedVisibleLineCount: number;
	preferredVisualCol?: number | null;
	snappedFromCursorCol?: number | null;
	scrollOffset?: number;
	lastAction?: unknown;
	historyIndex?: number;
	historyDraft?: unknown;
	cancelAutocomplete?: () => void;
	onChange?: (text: string) => void;
	tui?: { requestRender(): void };
}

/**
 * The public Editor API cannot set a cursor or edit without clearing Pi's
 * private large-paste registry. Keep the one version-sensitive access here so
 * normal-mode edits preserve paste markers and their full hidden payloads.
 */
export class PiEditorAdapter {
	private readonly editor: CustomEditor;
	private readonly internals: VersionSensitiveEditor;

	constructor(editor: CustomEditor) {
		this.editor = editor;
		const candidate = editor as unknown as Partial<VersionSensitiveEditor>;
		if (!candidate.state || !Array.isArray(candidate.state.lines) || typeof candidate.state.cursorLine !== "number" || typeof candidate.state.cursorCol !== "number" || !(candidate.pastes instanceof Map) || typeof candidate.pasteCounter !== "number" || typeof candidate.cancelAutocomplete !== "function" || typeof candidate.buildVisualLineMap !== "function" || typeof candidate.renderedVisibleLineCount !== "number" || typeof candidate.killRing?.push !== "function" || typeof candidate.undoStack?.clear !== "function") {
			throw new Error("modal-editor: incompatible Pi Editor internals (document/cursor, paste/kill/undo registry, or layout API)");
		}
		this.internals = candidate as VersionSensitiveEditor;
		const ring = this.internals.killRing;
		const push = ring.push.bind(ring);
		// Capture ownership at kill time, before reconciliation drops the live ID.
		// Expand only incoming text; existing kill entries must never be re-expanded
		// using a later registry that may have reused the same numeric IDs.
		ring.push = (text, options) => push(text.replace(/\[paste #(\d+)( (\+\d+ lines|\d+ chars))?\]/g,
			(marker, id) => this.internals.pastes.get(Number(id)) ?? marker), options);
	}

	clearNativeUndo(): void {
		this.internals.undoStack.clear();
	}

	read(): { text: string; cursor: CursorPosition; pastes: Map<number, string> } {
		this.reconcilePastes(this.editor.getText(), this.internals.pastes);
		return { text: this.editor.getText(), cursor: this.editor.getCursor(), pastes: new Map(this.internals.pastes) };
	}

	private reconcilePastes(text: string, pastes: Map<number, string>): void {
		const ids = new Set([...text.matchAll(/\[paste #(\d+)( (\+\d+ lines|\d+ chars))?\]/g)].map(m => Number(m[1])));
		this.internals.pastes = new Map([...pastes].filter(([id]) => ids.has(id)));
		// Reserve literal marker IDs too, so a later Pi paste does not give them payloads.
		this.internals.pasteCounter = 0;
		for (const id of ids) if (Number.isSafeInteger(id)) this.internals.pasteCounter = Math.max(this.internals.pasteCounter, id);
	}

	write(text: string, cursor: CursorPosition, pastes: Map<number, string>): void {
		this.reconcilePastes(text, pastes);
		const lines = text.split("\n");
		this.internals.cancelAutocomplete?.();
		this.internals.state.lines = lines.length > 0 ? lines : [""];
		this.internals.state.cursorLine = Math.max(0, Math.min(cursor.line, this.internals.state.lines.length - 1));
		const line = this.internals.state.lines[this.internals.state.cursorLine] ?? "";
		this.internals.state.cursorCol = Math.max(0, Math.min(cursor.col, line.length));
		this.internals.preferredVisualCol = null;
		this.internals.snappedFromCursorCol = null;
		this.internals.scrollOffset = 0;
		this.internals.lastAction = null;
		this.internals.historyIndex = -1;
		this.internals.historyDraft = null;
		this.internals.onChange?.(this.editor.getText());
		this.internals.tui?.requestRender();
	}

	/** Reuse Pi's marker-aware wrapping, including CJK breaks and padding geometry. */
	chunks(width: number): Array<{ text: string; start: number; end: number }> {
		const lines = this.editor.getLines();
		const starts = [0];
		for (const line of lines) starts.push(starts[starts.length - 1]! + line.length + 1);
		return this.internals.buildVisualLineMap(width).map(part => ({
			text: lines[part.logicalLine]!.slice(part.startCol, part.startCol + part.length),
			start: starts[part.logicalLine]! + part.startCol,
			end: starts[part.logicalLine]! + part.startCol + part.length,
		}));
	}

	get visibleRows(): number { return this.internals.renderedVisibleLineCount; }

	getScrollOffset(): number {
		return typeof this.internals.scrollOffset === "number" ? this.internals.scrollOffset : 0;
	}
}
