export type VimMode = "normal" | "insert" | "visual" | "visual-line";
export type Operator = "d" | "c" | "y";

export interface CursorPosition {
	line: number;
	col: number;
}

export interface DocumentSnapshot {
	text: string;
	cursor: number;
	pastes?: Map<number, string>;
}

/** Visible marker spelling alone does not identify document content. */
export function sameContent(a: Pick<DocumentSnapshot, "text" | "pastes">, b: Pick<DocumentSnapshot, "text" | "pastes">): boolean {
	if (a.text !== b.text || (a.pastes?.size ?? 0) !== (b.pastes?.size ?? 0)) return false;
	for (const [id, payload] of a.pastes ?? []) if (b.pastes?.get(id) !== payload) return false;
	return true;
}

export interface Yank {
	text: string;
	linewise: boolean;
}

export interface FeedResult {
	changed: boolean;
	enteredInsert: boolean;
	completed: boolean;
	repeatable: boolean;
}

interface PendingOperator {
	op: Operator;
	count: number;
}

interface FindMotion {
	char: string;
	direction: 1 | -1;
	till: boolean;
}

interface MotionResult {
	to: number;
	inclusive?: boolean;
	linewise?: boolean;
	failed?: boolean;
}

interface TextRange {
	lineStart?: number;
	lineText?: string;
	start: number;
	end: number;
	linewise?: boolean;
}

const MAX_COUNT = 1000;
const PASTE_MARKER = /\[paste #(\d+)( (\+\d+ lines|\d+ chars))?\]/g;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const wordChar = /^[\p{L}\p{N}_]$/u;

interface Segment {
	start: number;
	end: number;
	text: string;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function segments(text: string): Segment[] {
	const markers = [...text.matchAll(PASTE_MARKER)].map((match) => ({
		start: match.index ?? 0,
		end: (match.index ?? 0) + match[0].length,
		text: match[0],
	}));
	const result: Segment[] = [];
	let markerIndex = 0;
	for (const item of segmenter.segment(text)) {
		while (markers[markerIndex] && markers[markerIndex]!.end <= item.index) markerIndex++;
		const marker = markers[markerIndex];
		if (marker && item.index >= marker.start && item.index < marker.end) {
			if (item.index === marker.start) result.push(marker);
			continue;
		}
		result.push({ start: item.index, end: item.index + item.segment.length, text: item.segment });
	}
	return result;
}

function segmentAt(text: string, offset: number): Segment | undefined {
	return segments(text).find((part) => part.start <= offset && offset < part.end);
}

function nextBoundary(text: string, offset: number): number {
	for (const part of segments(text)) if (part.start >= offset) return part.start === offset ? part.end : part.start;
	return text.length;
}

function previousBoundary(text: string, offset: number): number {
	let previous = 0;
	for (const part of segments(text)) {
		if (part.end >= offset) return part.start;
		previous = part.start;
	}
	return previous;
}

function isSpace(part: Segment): boolean {
	return /^\s+$/u.test(part.text);
}

function kind(part: Segment, big: boolean): "space" | "word" | "punct" {
	if (isSpace(part)) return "space";
	if (big || wordChar.test(part.text)) return "word";
	return "punct";
}

function lineStarts(text: string): number[] {
	const starts = [0];
	for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
	return starts;
}

export function offsetToPosition(text: string, offset: number): CursorPosition {
	const safe = clamp(offset, 0, text.length);
	const before = text.slice(0, safe);
	const line = before.split("\n").length - 1;
	const lastNewline = before.lastIndexOf("\n");
	return { line, col: safe - lastNewline - 1 };
}

export function positionToOffset(text: string, position: CursorPosition): number {
	const starts = lineStarts(text);
	const line = clamp(position.line, 0, starts.length - 1);
	const start = starts[line]!;
	const end = text.indexOf("\n", start);
	return start + clamp(position.col, 0, (end < 0 ? text.length : end) - start);
}

function lineBounds(text: string, offset: number): { line: number; start: number; end: number } {
	const position = offsetToPosition(text, offset);
	const starts = lineStarts(text);
	const start = starts[position.line]!;
	const newline = text.indexOf("\n", start);
	return { line: position.line, start, end: newline < 0 ? text.length : newline };
}

function firstNonblank(text: string, offset: number): number {
	const bounds = lineBounds(text, offset);
	const match = text.slice(bounds.start, bounds.end).match(/\S/u);
	return bounds.start + (match?.index ?? 0);
}

function lastCharacter(text: string, lineEnd: number): number {
	const start = lineBounds(text, lineEnd).start;
	return lineEnd > start ? previousBoundary(text, lineEnd) : start;
}

export function snapCursor(text: string, cursor: number): number {
	const safe = clamp(cursor, 0, text.length);
	return segmentAt(text, safe)?.start ?? safe;
}

function normalizeNormalCursor(text: string, cursor: number): number {
	cursor = snapCursor(text, cursor);
	if (!text) return 0;
	const bounds = lineBounds(text, clamp(cursor, 0, text.length));
	if (bounds.start === bounds.end) return bounds.start;
	return clamp(cursor >= bounds.end ? previousBoundary(text, bounds.end) : cursor, bounds.start, bounds.end);
}

function lineRange(text: string, firstLine: number, count: number): TextRange {
	const starts = lineStarts(text);
	const startLine = clamp(firstLine, 0, starts.length - 1);
	const endLine = clamp(startLine + Math.max(1, count) - 1, startLine, starts.length - 1);
	let start = starts[startLine]!;
	let end: number;
	if (endLine + 1 < starts.length) {
		end = starts[endLine + 1]!;
	} else if (startLine > 0) {
		start -= 1;
		end = text.length;
	} else {
		end = text.length;
	}
	return { start, end, linewise: true, lineStart: starts[startLine]!, lineText: text.split("\n").slice(startLine, endLine + 1).join("\n") };
}

function wordForward(text: string, cursor: number, count: number, big: boolean): number {
	const parts = segments(text);
	let index = parts.findIndex((part) => part.start <= cursor && cursor < part.end);
	if (index < 0) index = parts.findIndex((part) => part.start >= cursor);
	if (index < 0) return text.length;
	for (let n = 0; n < count; n++) {
		const currentKind = kind(parts[index]!, big);
		if (currentKind !== "space") while (index < parts.length && kind(parts[index]!, big) === currentKind) index++;
		while (index < parts.length && kind(parts[index]!, big) === "space") index++;
		if (index >= parts.length) return text.length;
	}
	return parts[index]!.start;
}

function wordBackward(text: string, cursor: number, count: number, big: boolean): number {
	const parts = segments(text);
	let index = parts.findIndex((part) => part.start >= cursor);
	if (index < 0) index = parts.length;
	if (index < parts.length && parts[index]!.start === cursor) index--;
	else if (index > 0) index--;
	for (let n = 0; n < count; n++) {
		while (index >= 0 && kind(parts[index]!, big) === "space") index--;
		if (index < 0) return 0;
		const currentKind = kind(parts[index]!, big);
		while (index > 0 && kind(parts[index - 1]!, big) === currentKind) index--;
		if (n + 1 < count) index--;
	}
	return parts[Math.max(0, index)]?.start ?? 0;
}

function wordEnd(text: string, cursor: number, count: number, big: boolean, includeCurrent = false): number {
	const parts = segments(text);
	let index = parts.findIndex((part) => part.end > cursor);
	if (index < 0) return normalizeNormalCursor(text, text.length);
	for (let n = 0; n < count; n++) {
		if (n > 0 || (!includeCurrent && !isSpace(parts[index]!) && (index + 1 === parts.length || kind(parts[index + 1]!, big) !== kind(parts[index]!, big)))) index++;
		while (index < parts.length && isSpace(parts[index]!)) index++;
		if (index >= parts.length) return normalizeNormalCursor(text, text.length);
		while (index + 1 < parts.length && kind(parts[index + 1]!, big) === kind(parts[index]!, big)) index++;
	}
	return parts[index]!.start;
}

function bracketPair(text: string, cursor: number): TextRange | undefined {
	const opens = "([{<";
	const closes = ")]}>";
	const bounds = lineBounds(text, cursor);
	const parts = segments(text);
	let index = parts.findIndex((part) => part.start >= cursor && part.start < bounds.end && (opens.includes(part.text) || closes.includes(part.text)));
	if (index < 0) return undefined;
	const at = parts[index]!;
	const openIndex = opens.indexOf(at.text);
	if (openIndex >= 0) {
		const close = closes[openIndex]!;
		let depth = 1;
		for (index += 1; index < parts.length; index++) {
			const part = parts[index]!;
			if (part.text === at.text) depth++;
			if (part.text === close && --depth === 0) return { start: at.start, end: part.end };
		}
		return undefined;
	}
	const open = opens[closes.indexOf(at.text)]!;
	let depth = 1;
	for (index -= 1; index >= 0; index--) {
		const part = parts[index]!;
		if (part.text === at.text) depth++;
		if (part.text === open && --depth === 0) return { start: part.start, end: at.end };
	}
	return undefined;
}

function enclosingBrackets(text: string, cursor: number, open: string, close: string): TextRange | undefined {
	const parts = segments(text);
	let depth = 0;
	let enclosingStart = parts.length - 1;
	while (enclosingStart >= 0 && parts[enclosingStart]!.start > cursor) enclosingStart--;
	for (let left = enclosingStart; left >= 0; left--) {
		const leftPart = parts[left]!;
		if (leftPart.text === close && leftPart.start !== cursor) depth++;
		if (leftPart.text !== open) continue;
		if (depth > 0) { depth--; continue; }
		let nested = 1;
		for (let right = left + 1; right < parts.length; right++) {
			const rightPart = parts[right]!;
			if (rightPart.text === open) nested++;
			if (rightPart.text === close && --nested === 0 && rightPart.start >= cursor) return { start: leftPart.start, end: rightPart.end };
		}
	}
	return undefined;
}

function quoteObject(text: string, cursor: number, quote: string): TextRange | undefined {
	const bounds = lineBounds(text, cursor);
	const positions = segments(text)
		.filter((part) => part.start >= bounds.start && part.end <= bounds.end && part.text === quote && text[part.start - 1] !== "\\")
		.map((part) => part.start);
	for (let i = 0; i + 1 < positions.length; i += 2) {
		if (positions[i]! <= cursor && cursor <= positions[i + 1]!) return { start: positions[i]!, end: positions[i + 1]! + 1 };
	}
	return undefined;
}

function wordObject(text: string, cursor: number, big: boolean, around: boolean): TextRange | undefined {
	const parts = segments(text);
	let index = parts.findIndex((part) => part.start <= cursor && cursor < part.end);
	if (index < 0 || kind(parts[index]!, big) === "space") {
		index = parts.findIndex((part) => part.start >= cursor && kind(part, big) !== "space");
	}
	if (index < 0) return undefined;
	const targetKind = kind(parts[index]!, big);
	let first = index;
	let last = index;
	while (first > 0 && kind(parts[first - 1]!, big) === targetKind) first--;
	while (last + 1 < parts.length && kind(parts[last + 1]!, big) === targetKind) last++;
	if (around) {
		let right = last + 1;
		while (right < parts.length && kind(parts[right]!, big) === "space") right++;
		if (right > last + 1) last = right - 1;
		else while (first > 0 && kind(parts[first - 1]!, big) === "space") first--;
	}
	return { start: parts[first]!.start, end: parts[last]!.end };
}

export class VimCore {
	text: string;
	cursor: number;
	mode: VimMode;
	pastes = new Map<number, string>();
	private yankValue: Yank = { text: "", linewise: false };
	get yank(): Yank { return this.yankValue; }
	set yank(value: Yank) {
		// The unnamed yank owns its payload, independent of Pi renumbering or clearing live IDs.
		this.yankValue = { ...value, text: value.text.replace(PASTE_MARKER, (marker, id) => this.pastes.get(Number(id)) ?? marker) };
	}
	private count = "";
	private operator?: PendingOperator;
	private pendingKey?: "g" | "find" | "replace" | "object";
	private pendingFind?: Omit<FindMotion, "char">;
	private objectAround = false;
	private lastFind?: FindMotion;
	private visualAnchor?: number;
	private desiredColumn?: number;
	private undoStack: DocumentSnapshot[] = [];
	private redoStack: DocumentSnapshot[] = [];
	private insertStart?: DocumentSnapshot;

	constructor(text = "", cursor = 0, mode: VimMode = "insert") {
		this.text = text;
		this.cursor = mode === "insert" ? snapCursor(text, cursor) : normalizeNormalCursor(text, cursor);
		this.mode = mode;
		if (mode === "insert") this.insertStart = this.snapshot();
	}

	get pendingDisplay(): string {
		const operator = this.operator ? `${this.operator.count > 1 ? this.operator.count : ""}${this.operator.op}` : "";
		const pending = this.pendingKey === "g"
			? "g"
			: this.pendingKey === "find"
				? (this.pendingFind?.till ? (this.pendingFind.direction === -1 ? "T" : "t") : (this.pendingFind?.direction === -1 ? "F" : "f"))
				: this.pendingKey === "replace"
					? "r"
					: this.pendingKey === "object" ? (this.objectAround ? "a" : "i") : "";
		return `${operator}${this.count}${pending}`;
	}

	get selection(): TextRange | undefined {
		if ((this.mode !== "visual" && this.mode !== "visual-line") || this.visualAnchor === undefined) return undefined;
		if (this.mode === "visual-line") {
			const first = Math.min(offsetToPosition(this.text, this.visualAnchor).line, offsetToPosition(this.text, this.cursor).line);
			const last = Math.max(offsetToPosition(this.text, this.visualAnchor).line, offsetToPosition(this.text, this.cursor).line);
			return lineRange(this.text, first, last - first + 1);
		}
		const start = Math.min(this.visualAnchor, this.cursor);
		const endAt = Math.max(this.visualAnchor, this.cursor);
		return { start, end: nextBoundary(this.text, endAt) };
	}

	snapshot(): DocumentSnapshot {
		return { text: this.text, cursor: this.cursor, pastes: new Map(this.pastes) };
	}

	sync(text: string, cursor: number, pastes = this.pastes): void {
		this.pastes = new Map(pastes);
		this.text = text;
		this.cursor = this.mode === "insert" ? snapCursor(text, cursor) : normalizeNormalCursor(text, cursor);
	}

	resetFromExternal(text: string, cursor: number, pastes = this.pastes): void {
		this.sync(text, cursor, pastes);
		this.visualAnchor = undefined;
		this.undoStack = [];
		this.redoStack = [];
		this.cancelPending();
		if (this.mode === "insert") this.insertStart = this.snapshot();
	}

	finishInsert(): boolean {
		if (this.mode !== "insert") return false;
		const before = this.insertStart;
		this.mode = "normal";
		this.cursor = normalizeNormalCursor(this.text, this.cursor > lineBounds(this.text, this.cursor).start ? previousBoundary(this.text, this.cursor) : this.cursor);
		this.insertStart = undefined;
		if (before && !sameContent(before, this)) {
			this.undoStack.push(before);
			this.redoStack = [];
			return true;
		}
		return false;
	}

	cancelPending(): void {
		this.count = "";
		this.operator = undefined;
		this.pendingKey = undefined;
		this.pendingFind = undefined;
		this.objectAround = false;
	}

	escape(): void {
		if (this.mode === "visual" || this.mode === "visual-line") {
			this.mode = "normal";
			this.visualAnchor = undefined;
		}
		this.cancelPending();
	}

	undo(cursorMode: "normal" | "insert" = "normal"): boolean {
		const previous = this.undoStack.pop();
		if (!previous) return false;
		this.redoStack.push(this.snapshot());
		this.pastes = new Map(previous.pastes);
		this.text = previous.text;
		// Insert resumes between characters, including the boundary after EOL.
		this.cursor = cursorMode === "insert" ? snapCursor(this.text, previous.cursor) : normalizeNormalCursor(this.text, previous.cursor);
		this.mode = "normal";
		this.visualAnchor = undefined;
		this.cancelPending();
		return true;
	}

	redo(): boolean {
		const next = this.redoStack.pop();
		if (!next) return false;
		this.undoStack.push(this.snapshot());
		this.pastes = new Map(next.pastes);
		this.text = next.text;
		this.cursor = normalizeNormalCursor(this.text, next.cursor);
		this.mode = "normal";
		this.visualAnchor = undefined;
		this.cancelPending();
		return true;
	}

	private countValue(): number {
		return Math.min(MAX_COUNT, Math.max(1, Number.parseInt(this.count || "1", 10)));
	}

	saveChange(before: DocumentSnapshot): void {
		if (sameContent(before, this)) return;
		this.undoStack.push(before);
		this.redoStack = [];
	}

	private beginInsert(before = this.snapshot()): void {
		this.mode = "insert";
		this.insertStart = before;
		this.cancelPending();
	}

	private replace(range: TextRange, replacement: string, cursor = range.start): void {
		this.text = this.text.slice(0, range.start) + replacement + this.text.slice(range.end);
		this.cursor = snapCursor(this.text, cursor);
	}

	private applyOperator(op: Operator, range: TextRange, before: DocumentSnapshot, emptyObject = false): FeedResult {
		if (!range.linewise && range.start === range.end && !(emptyObject && op === "c")) { this.cancelPending(); return { changed: false, enteredInsert: false, completed: true, repeatable: false }; }
		const yankText = range.linewise ? range.lineText ?? "" : this.text.slice(range.start, range.end);
		this.yank = { text: yankText, linewise: Boolean(range.linewise) };
		if (op === "y") {
			this.cursor = normalizeNormalCursor(this.text, range.lineStart ?? range.start);
			this.cancelPending();
			return { changed: false, enteredInsert: false, completed: true, repeatable: false };
		}
		if (op === "c" && range.linewise) {
			const start = range.lineStart ?? range.start;
			const end = start + (range.lineText?.length ?? 0);
			// Change line contents, not the newline borrowed by final-line deletion.
			this.replace({ start, end }, "", start);
			this.beginInsert(before);
			return { changed: true, enteredInsert: true, completed: true, repeatable: true };
		}
		this.replace(range, "", range.start);
		if (op === "c") {
			this.beginInsert(before);
			return { changed: true, enteredInsert: true, completed: true, repeatable: true };
		}
		this.cursor = normalizeNormalCursor(this.text, this.cursor);
		this.saveChange(before);
		this.cancelPending();
		return { changed: true, enteredInsert: false, completed: true, repeatable: true };
	}

	private motion(key: string, count: number): MotionResult | undefined {
		const bounds = lineBounds(this.text, this.cursor);
		switch (key) {
			case "h": {
				let to = this.cursor;
				for (let i = 0; i < count && to > bounds.start; i++) to = previousBoundary(this.text, to);
				return { to };
			}
			case "l": {
				let to = this.cursor;
				for (let i = 0; i < count && to < bounds.end; i++) to = nextBoundary(this.text, to);
				return { to };
			}
			case "j":
			case "k": {
				const starts = lineStarts(this.text);
				const current = offsetToPosition(this.text, this.cursor);
				const targetLine = clamp(current.line + (key === "j" ? count : -count), 0, starts.length - 1);
				const desired = this.desiredColumn ?? current.col;
				const start = starts[targetLine]!;
				const end = this.text.indexOf("\n", start);
				return { to: start + clamp(desired, 0, (end < 0 ? this.text.length : end) - start), linewise: Boolean(this.operator) };
			}
			case "0": return { to: bounds.start };
			case "^": return { to: firstNonblank(this.text, this.cursor) };
			case "$": return { to: lastCharacter(this.text, bounds.end), inclusive: true };
			case "w": return { to: wordForward(this.text, this.cursor, count, false) };
			case "W": return { to: wordForward(this.text, this.cursor, count, true) };
			case "b": return { to: wordBackward(this.text, this.cursor, count, false) };
			case "B": return { to: wordBackward(this.text, this.cursor, count, true) };
			case "e": return { to: wordEnd(this.text, this.cursor, count, false), inclusive: true };
			case "E": return { to: wordEnd(this.text, this.cursor, count, true), inclusive: true };
			case "%": {
				const pair = bracketPair(this.text, this.cursor);
				if (!pair) return { to: this.cursor, failed: true };
				return { to: pair.start >= this.cursor ? pair.end - 1 : pair.start, inclusive: true };
			}
		}
		return undefined;
	}

	private find(char: string, spec: Omit<FindMotion, "char">, count: number, remember = true): MotionResult {
		const bounds = lineBounds(this.text, this.cursor);
		const matches = segments(this.text).filter((part) => part.start >= bounds.start && part.end <= bounds.end && part.text === char);
		let candidates = spec.direction === 1
			? matches.filter((part) => part.start > this.cursor)
			: matches.filter((part) => part.start < this.cursor).reverse();
		if (!remember && spec.till) {
			candidates = candidates.filter(part => (spec.direction === 1 ? previousBoundary(this.text, part.start) : nextBoundary(this.text, part.start)) !== this.cursor);
		}
		const found = candidates[count - 1]?.start;
		if (found === undefined) return { to: this.cursor, failed: true };
		if (remember) this.lastFind = { char, ...spec };
		const destination = spec.till ? (spec.direction === 1 ? previousBoundary(this.text, found) : nextBoundary(this.text, found)) : found;
		return { to: destination, inclusive: true };
	}

	private rangeForMotion(motion: MotionResult): TextRange {
		if (motion.failed) return { start: this.cursor, end: this.cursor };
		if (motion.linewise) {
			const first = Math.min(offsetToPosition(this.text, this.cursor).line, offsetToPosition(this.text, motion.to).line);
			const last = Math.max(offsetToPosition(this.text, this.cursor).line, offsetToPosition(this.text, motion.to).line);
			return lineRange(this.text, first, last - first + 1);
		}
		if (motion.to >= this.cursor) return { start: this.cursor, end: motion.inclusive ? nextBoundary(this.text, motion.to) : motion.to };
		return { start: motion.to, end: motion.inclusive ? nextBoundary(this.text, this.cursor) : this.cursor };
	}

	private textObject(key: string, around: boolean): TextRange | undefined {
		if (key === "w" || key === "W") return wordObject(this.text, this.cursor, key === "W", around);
		if (`"'\``.includes(key)) {
			const range = quoteObject(this.text, this.cursor, key);
			return range && !around ? { start: range.start + 1, end: range.end - 1 } : range;
		}
		const pair: Record<string, [string, string]> = {
			"(": ["(", ")"], ")": ["(", ")"], "b": ["(", ")"],
			"[": ["[", "]"], "]": ["[", "]"],
			"{": ["{", "}"], "}": ["{", "}"], "B": ["{", "}"],
			"<": ["<", ">"], ">": ["<", ">"],
		};
		const chars = pair[key];
		if (!chars) return undefined;
		const range = enclosingBrackets(this.text, this.cursor, chars[0], chars[1]);
		return range && !around ? { start: range.start + 1, end: range.end - 1 } : range;
	}

	private enterVisual(linewise: boolean): FeedResult {
		if ((linewise && this.mode === "visual-line") || (!linewise && this.mode === "visual")) {
			this.mode = "normal";
			this.visualAnchor = undefined;
		} else {
			this.mode = linewise ? "visual-line" : "visual";
			this.visualAnchor ??= this.cursor;
		}
		this.cancelPending();
		return { changed: false, enteredInsert: false, completed: true, repeatable: false };
	}

	private paste(after: boolean, count: number): boolean {
		if (!this.yank.text && !this.yank.linewise) return false;
		count = Math.min(count, Math.max(1, Math.floor(1_000_000 / Math.max(1, this.yank.text.length))));
		if (this.yank.linewise) {
			const bounds = lineBounds(this.text, this.cursor);
			const insertAt = after ? (bounds.end < this.text.length ? bounds.end + 1 : this.text.length) : bounds.start;
			const block = Array.from({ length: count }, () => this.yank.text).join("\n");
			const leadingNewline = after && bounds.end === this.text.length && this.text.length > 0;
			let inserted = block;
			if (this.text.length === 0) inserted = block || "\n";
			else if (after && bounds.end === this.text.length) inserted = `\n${block}`;
			else inserted = `${block}\n`;
			this.replace({ start: insertAt, end: insertAt }, inserted, insertAt + (leadingNewline ? 1 : 0));
			return true;
		}
		let insertAt = this.cursor;
		if (after && this.cursor < lineBounds(this.text, this.cursor).end) insertAt = nextBoundary(this.text, this.cursor);
		const block = this.yank.text.repeat(count);
		this.replace({ start: insertAt, end: insertAt }, block, insertAt + previousBoundary(block, block.length));
		return true;
	}

	feed(key: string): FeedResult {
		const waiting = (): FeedResult => ({ changed: false, enteredInsert: false, completed: false, repeatable: false });
		const done = (changed = false, repeatable = false): FeedResult => ({ changed, enteredInsert: false, completed: true, repeatable });
		if (this.mode === "insert") return waiting();

		if (this.pendingKey === "find" && this.pendingFind) {
			const before = this.snapshot();
			const motion = this.find(key, this.pendingFind, Math.min(MAX_COUNT, this.countValue() * (this.operator?.count ?? 1)));
			this.pendingKey = undefined;
			this.pendingFind = undefined;
			if (this.operator) return this.applyOperator(this.operator.op, this.rangeForMotion(motion), before);
			this.cursor = normalizeNormalCursor(this.text, motion.to);
			this.count = "";
			return done();
		}
		if (this.pendingKey === "replace") {
			const before = this.snapshot();
			this.pendingKey = undefined;
			const bounds = lineBounds(this.text, this.cursor);
			let end = this.cursor;
			for (let i = 0; i < this.countValue() && end < bounds.end; i++) end = nextBoundary(this.text, end);
			if (end > this.cursor && key !== "\n") {
				const amount = segments(this.text.slice(this.cursor, end)).length;
				this.replace({ start: this.cursor, end }, key.repeat(amount), this.cursor);
				this.saveChange(before);
				this.count = "";
				return done(true, true);
			}
			this.count = "";
			return done();
		}
		if (this.pendingKey === "object") {
			const before = this.snapshot();
			const range = this.textObject(key, this.objectAround);
			this.pendingKey = undefined;
			if (!range) { this.cancelPending(); return done(); }
			if (this.operator) return this.applyOperator(this.operator.op, range, before, true);
			if (this.mode === "visual" || this.mode === "visual-line") {
				this.mode = "visual";
				this.visualAnchor = range.start;
				this.cursor = normalizeNormalCursor(this.text, previousBoundary(this.text, range.end));
			}
			this.cancelPending();
			return done();
		}
		if (this.pendingKey === "g") {
			this.pendingKey = undefined;
			if (key === "g") {
				const starts = lineStarts(this.text);
				const targetLine = this.count ? clamp(this.countValue() - 1, 0, starts.length - 1) : 0;
				const motion = { to: firstNonblank(this.text, starts[targetLine]!), linewise: Boolean(this.operator) };
				const before = this.snapshot();
				if (this.operator) return this.applyOperator(this.operator.op, this.rangeForMotion(motion), before);
				this.cursor = motion.to;
			}
			this.cancelPending();
			return done();
		}

		if (/^[0-9]$/.test(key) && (key !== "0" || this.count.length > 0)) {
			this.count = String(Math.min(MAX_COUNT, Number(this.count + key)));
			return waiting();
		}

		if ((this.mode === "visual" || this.mode === "visual-line") && (key === "d" || key === "c" || key === "y")) {
			const range = this.selection;
			const before = this.snapshot();
			this.mode = "normal";
			this.visualAnchor = undefined;
			if (!range) return done();
			return this.applyOperator(key, range, before);
		}
		if (this.operator && (key === "v" || key === "V")) { this.cancelPending(); return done(); }
		if (key === "v") return this.enterVisual(false);
		if (key === "V") return this.enterVisual(true);

		if (this.operator && key === this.operator.op) {
			const before = this.snapshot();
			const position = offsetToPosition(this.text, this.cursor);
			const range = lineRange(this.text, position.line, Math.min(MAX_COUNT, this.operator.count * this.countValue()));
			return this.applyOperator(this.operator.op, range, before);
		}
		if (!this.operator && (key === "d" || key === "c" || key === "y")) {
			this.operator = { op: key, count: this.countValue() };
			this.count = "";
			return waiting();
		}
		if (this.operator && (key === "i" || key === "a")) {
			this.pendingKey = "object";
			this.objectAround = key === "a";
			return waiting();
		}
		if ((this.mode === "visual" || this.mode === "visual-line") && (key === "i" || key === "a")) {
			this.pendingKey = "object";
			this.objectAround = key === "a";
			return waiting();
		}

		const count = this.countValue();
		if ("fFtT".includes(key)) {
			this.pendingKey = "find";
			this.pendingFind = { direction: key === "f" || key === "t" ? 1 : -1, till: key === "t" || key === "T" };
			return waiting();
		}
		if ((key === ";" || key === ",") && this.lastFind) {
			const spec = key === ";" ? this.lastFind : { ...this.lastFind, direction: (this.lastFind.direction * -1) as 1 | -1 };
			const before = this.snapshot();
			const motion = this.find(spec.char, spec, Math.min(MAX_COUNT, count * (this.operator?.count ?? 1)), false);
			if (this.operator) return this.applyOperator(this.operator.op, this.rangeForMotion(motion), before);
			this.cursor = normalizeNormalCursor(this.text, motion.to);
			this.count = "";
			return done();
		}
		if (key === "g") { this.pendingKey = "g"; return waiting(); }
		if (key === "G") {
			const starts = lineStarts(this.text);
			const targetLine = this.count ? clamp(count - 1, 0, starts.length - 1) : starts.length - 1;
			const motion = { to: firstNonblank(this.text, starts[targetLine]!), linewise: Boolean(this.operator) };
			const before = this.snapshot();
			if (this.operator) return this.applyOperator(this.operator.op, this.rangeForMotion(motion), before);
			this.cursor = motion.to;
			this.count = "";
			return done();
		}

		const totalMotionCount = Math.min(MAX_COUNT, count * (this.operator?.count ?? 1));
		const changeWordSpecial = this.operator?.op === "c" && (key === "w" || key === "W") && !/^\s$/u.test(segmentAt(this.text, this.cursor)?.text ?? " ");
		const motion = changeWordSpecial
			? { to: wordEnd(this.text, this.cursor, totalMotionCount, key === "W", true), inclusive: true }
			: this.motion(key, totalMotionCount);
		if (motion) {
			const before = this.snapshot();
			if (this.operator) return this.applyOperator(this.operator.op, this.rangeForMotion(motion), before);
			if (key === "j" || key === "k") this.desiredColumn ??= offsetToPosition(this.text, this.cursor).col;
			else this.desiredColumn = undefined;
			this.cursor = normalizeNormalCursor(this.text, motion.to);
			this.count = "";
			return done();
		}

		if (this.operator) { this.cancelPending(); return done(); }
		const before = this.snapshot();
		switch (key) {
			case "i": this.beginInsert(before); return { changed: false, enteredInsert: true, completed: true, repeatable: true };
			case "a": {
				const bounds = lineBounds(this.text, this.cursor);
				if (this.cursor < bounds.end) this.cursor = nextBoundary(this.text, this.cursor);
				this.beginInsert(before); return { changed: false, enteredInsert: true, completed: true, repeatable: true };
			}
			case "I": this.cursor = firstNonblank(this.text, this.cursor); this.beginInsert(before); return { changed: false, enteredInsert: true, completed: true, repeatable: true };
			case "A": this.cursor = lineBounds(this.text, this.cursor).end; this.beginInsert(before); return { changed: false, enteredInsert: true, completed: true, repeatable: true };
			case "o":
			case "O": {
				if (this.text.length === 0) {
					this.beginInsert(before);
					return { changed: false, enteredInsert: true, completed: true, repeatable: true };
				}
				const bounds = lineBounds(this.text, this.cursor);
				const at = key === "o" ? bounds.end : bounds.start;
				this.replace({ start: at, end: at }, "\n", key === "o" ? at + 1 : at);
				this.beginInsert(before); return { changed: true, enteredInsert: true, completed: true, repeatable: true };
			}
			case "x": {
				const bounds = lineBounds(this.text, this.cursor);
				let end = this.cursor;
				for (let i = 0; i < count && end < bounds.end; i++) end = nextBoundary(this.text, end);
				if (end > this.cursor) { this.yank = { text: this.text.slice(this.cursor, end), linewise: false }; this.replace({ start: this.cursor, end }, ""); }
				break;
			}
			case "X": {
				const bounds = lineBounds(this.text, this.cursor);
				let start = this.cursor;
				for (let i = 0; i < count && start > bounds.start; i++) start = previousBoundary(this.text, start);
				if (start < this.cursor) { this.yank = { text: this.text.slice(start, this.cursor), linewise: false }; this.replace({ start, end: this.cursor }, "", start); }
				break;
			}
			case "D":
			case "C": {
				const end = lineBounds(this.text, this.cursor).end;
				this.yank = { text: this.text.slice(this.cursor, end), linewise: false };
				this.replace({ start: this.cursor, end }, "");
				if (key === "C") { this.beginInsert(before); return { changed: before.text !== this.text, enteredInsert: true, completed: true, repeatable: true }; }
				break;
			}
			case "s": {
				const bounds = lineBounds(this.text, this.cursor);
				let end = this.cursor;
				for (let i = 0; i < count && end < bounds.end; i++) end = nextBoundary(this.text, end);
				this.yank = { text: this.text.slice(this.cursor, end), linewise: false };
				this.replace({ start: this.cursor, end }, "");
				this.beginInsert(before); return { changed: before.text !== this.text, enteredInsert: true, completed: true, repeatable: true };
			}
			case "S": {
				const range = lineRange(this.text, offsetToPosition(this.text, this.cursor).line, count);
				return this.applyOperator("c", range, before);
			}
			case "r": this.pendingKey = "replace"; return waiting();
			case "J": {
				for (let n = 0; n < count; n++) {
					const bounds = lineBounds(this.text, this.cursor);
					if (bounds.end >= this.text.length) break;
					let after = bounds.end + 1;
					while (after < this.text.length && /[ \t]/.test(this.text[after]!)) after++;
					const spacer = bounds.end > bounds.start && after < this.text.length ? " " : "";
					this.replace({ start: bounds.end, end: after }, spacer, bounds.end);
				}
				break;
			}
			case "~": {
				const bounds = lineBounds(this.text, this.cursor);
				let at = this.cursor;
				let replacement = "";
				for (let i = 0; i < count && at < bounds.end; i++) {
					const part = segmentAt(this.text, at); if (!part) break;
					const isMarker = /^\[paste #\d+( (\+\d+ lines|\d+ chars))?\]$/.test(part.text);
					replacement += isMarker ? part.text : (part.text === part.text.toUpperCase() ? part.text.toLowerCase() : part.text.toUpperCase());
					at = part.end;
				}
				this.replace({ start: this.cursor, end: at }, replacement, at);
				this.cursor = normalizeNormalCursor(this.text, this.cursor);
				break;
			}
			case "p":
			case "P": this.paste(key === "p", count); break;
			default: this.cancelPending(); return done();
		}
		this.cursor = normalizeNormalCursor(this.text, this.cursor);
		const changed = before.text !== this.text;
		this.saveChange(before);
		this.cancelPending();
		return done(changed, changed);
	}
}
