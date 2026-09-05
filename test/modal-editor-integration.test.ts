import assert from "node:assert/strict";
import test from "node:test";
import { CURSOR_MARKER, getKeybindings, visibleWidth } from "@earendil-works/pi-tui";
import { VimEditor } from "../extensions/modal-editor.ts";

function editor(): VimEditor {
	const tui = {
		terminal: { rows: 24, columns: 80 },
		requestRender() {},
	} as never;
	const theme = {
		borderColor: (text: string) => text,
		selectList: {
			selectedPrefix: (text: string) => text,
			selectedText: (text: string) => text,
			description: (text: string) => text,
			scrollInfo: (text: string) => text,
			noMatch: (text: string) => text,
		},
	} as never;
	const keybindings = {
		matches(data: string, action: string) {
			if (action === "app.interrupt") return data === "\x1b";
			if (action === "app.exit") return data === "\x04";
			return action.startsWith("tui.") && getKeybindings().matches(data, action as never);
		},
		getKeys() { return []; },
	} as never;
	return new VimEditor(tui, theme, keybindings);
}

function enterNormal(instance: VimEditor, text: string): void {
	instance.setText(text);
	instance.handleInput("\x1b");
}

test("input routing recognizes Kitty printable keys and arrows without history browsing", () => {
	const instance = editor();
	enterNormal(instance, "ab\ncd");
	instance.handleInput("g");
	instance.handleInput("g");
	instance.handleInput("0");
	instance.handleInput("\x1b[108u"); // Kitty CSI-u printable l
	assert.deepEqual(instance.getCursor(), { line: 0, col: 1 });
	instance.addToHistory("history must not appear");
	instance.handleInput("\x1b[B");
	assert.equal(instance.getText(), "ab\ncd");
	assert.deepEqual(instance.getCursor(), { line: 1, col: 1 });
});

test("normal Enter and control/application shortcuts still route through CustomEditor", () => {
	const instance = editor();
	enterNormal(instance, "submit me");
	let submitted = "";
	instance.onSubmit = (text) => { submitted = text; };
	instance.handleInput("\r");
	assert.equal(submitted, "submit me");
	instance.handleInput("u");
	assert.equal(instance.getText(), "", "undo history does not cross submitted prompts");
});

test("large bracketed paste payload survives marker edits, undo, and submission expansion", () => {
	const instance = editor();
	const payload = Array.from({ length: 20 }, (_, index) => `line-${index}`).join("\n");
	instance.handleInput(`\x1b[200~${payload}\x1b[201~`);
	assert.match(instance.getText(), /^\[paste #1 \+20 lines\]$/);
	assert.equal(instance.getExpandedText(), payload);
	instance.handleInput("\x1b");
	instance.handleInput("x");
	assert.equal(instance.getText(), "");
	instance.handleInput("u");
	assert.match(instance.getText(), /^\[paste #1 \+20 lines\]$/);
	assert.equal(instance.getExpandedText(), payload);
	let submitted = "";
	instance.onSubmit = (text) => { submitted = text; };
	instance.handleInput("\r");
	assert.equal(submitted, payload);
});

test("dot repeats direct edits and insert/change input as grouped changes", () => {
	const direct = editor();
	enterNormal(direct, "abcd");
	direct.handleInput("0");
	direct.handleInput("x");
	direct.handleInput(".");
	assert.equal(direct.getText(), "cd");
	direct.handleInput("u");
	assert.equal(direct.getText(), "bcd");

	const inserted = editor();
	enterNormal(inserted, "one two");
	inserted.handleInput("0");
	for (const key of ["c", "w", "X", "\x1b", "w", "."]) inserted.handleInput(key);
	assert.equal(inserted.getText(), "X X");
	inserted.handleInput("u");
	assert.equal(inserted.getText(), "X two");

	const visual = editor();
	enterNormal(visual, "abcdef");
	for (const key of ["0", "v", "l", "d", "."]) visual.handleInput(key);
	assert.equal(visual.getText(), "ef");
});

test("visual selection and pending command state render visibly within narrow widths", () => {
	const pending = editor();
	enterNormal(pending, "alpha beta");
	pending.handleInput("2");
	pending.handleInput("d");
	assert.ok(pending.render(40).some((line) => line.includes("NORMAL 2d")));

	const instance = editor();
	enterNormal(instance, "alpha beta gamma");
	for (const key of "vwww") instance.handleInput(key);
	for (const width of [1, 2, 5, 12, 40]) {
		const rendered = instance.render(width);
		assert.ok(rendered.some((line) => line.includes("\x1b[7m")), `selection visible at width ${width}`);
		for (const line of rendered) assert.ok(visibleWidth(line) <= width, `${visibleWidth(line)} > ${width}`);
	}
});

test("insert-mode slash input remains ordinary Pi editor input", async () => {
	const instance = editor();
	instance.handleInput("/");
	instance.handleInput("reload");
	assert.equal(instance.getText(), "/reload");
});

test("dot never submits or replays application callbacks across transactions", () => {
	const instance = editor();
	const submitted: string[] = [];
	instance.onSubmit = text => submitted.push(text);
	for (const key of ["first", "\r", "second", "\x1b", "."]) instance.handleInput(key);
	assert.deepEqual(submitted, ["first"]);
	assert.equal(instance.getText(), "seconsecondd");

	let callbacks = 0;
	instance.handleInput("i");
	instance.onExtensionShortcut = data => {
		if (data !== "\x10") return false;
		callbacks++; instance.setText("replacement"); return true;
	};
	for (const key of ["\x10", "!", "\x1b", "."]) instance.handleInput(key);
	assert.equal(callbacks, 1);
	assert.equal(instance.getText(), "replacement!!");
});

test("delegated normal edit controls are undoable and redoable", () => {
	for (const control of ["\x7f", "\x1b[3~", "\x17", "\x15", "\x0b", "\x04"]) {
		const instance = editor(); enterNormal(instance, "abc def");
		instance.handleInput(control); const edited = instance.getText();
		assert.notEqual(edited, "abc def", JSON.stringify(control));
		instance.handleInput("u"); assert.equal(instance.getText(), "abc def", JSON.stringify(control));
		instance.handleInput("\x12"); assert.equal(instance.getText(), edited);
	}
});

test("insert cursor movement becomes a semantic dot delta, never a raw arrow", () => {
	const instance = editor(); enterNormal(instance, "abc");
	for (const key of ["A", "X", "\x1b[D", "Y", "\x1b", "."]) instance.handleInput(key);
	assert.equal(instance.getText(), "abcYXYX");
	instance.handleInput("u"); assert.equal(instance.getText(), "abcYX");
});

test("paste snapshots survive insert backspace renumbering, undo and redo", () => {
	const instance = editor();
	const first = "A".repeat(1200), second = "B".repeat(1200);
	instance.handleInput(`\x1b[200~${first}\x1b[201~`);
	instance.handleInput(`\x1b[200~${second}\x1b[201~`);
	instance.handleInput("\x1b");
	for (const key of ["0", "a", "\x7f", "\x1b"]) instance.handleInput(key);
	assert.equal(instance.getExpandedText(), second);
	instance.handleInput("u"); assert.equal(instance.getExpandedText(), first + second);
	instance.handleInput("\x12"); assert.equal(instance.getExpandedText(), second);
});

test("removed paste IDs never expand newly typed literal marker syntax", () => {
	const instance = editor(); const payload = "A".repeat(1200);
	instance.handleInput(`\x1b[200~${payload}\x1b[201~`);
	const marker = instance.getText();
	for (const key of ["\x1b", "0", "x", "i", marker, "\x1b"]) instance.handleInput(key);
	assert.equal(instance.getExpandedText(), marker);
	instance.handleInput("u"); assert.equal(instance.getExpandedText(), "");
	instance.handleInput("u"); assert.equal(instance.getExpandedText(), payload);
});

test("yanks own hidden payloads independently of setText and submit clearing Pi IDs", () => {
	const instance = editor(); const payload = "A".repeat(1200);
	instance.handleInput(`\x1b[200~${payload}\x1b[201~`);
	for (const key of ["\x1b", "0", "y", "y"]) instance.handleInput(key);
	instance.setText("new");
	instance.handleInput("p"); assert.equal(instance.getExpandedText(), "new\n" + payload);
	instance.handleInput("\r");
	instance.handleInput("p"); assert.equal(instance.getExpandedText(), payload);
});

test("programmatic clipboard insertion is its own undo unit and setText resets boundaries", () => {
	const instance = editor(); instance.handleInput("draft");
	instance.insertTextAtCursor(" paste");
	instance.handleInput("\x1b"); instance.handleInput("u");
	assert.equal(instance.getExpandedText(), "draft");
	instance.setText("replacement");
	instance.handleInput("u"); assert.equal(instance.getText(), "replacement");
});

test("history recall establishes a new insert transaction", () => {
	const instance = editor(); instance.addToHistory("old prompt");
	instance.handleInput("\x1b[A");
	instance.handleInput("!"); instance.handleInput("\x1b"); instance.handleInput("u");
	assert.equal(instance.getText(), "old prompt");
});

test("padded visual rendering shares Pi wrapping and keeps one cursor marker", () => {
	const instance = editor(); instance.setPaddingX(2); instance.focused = true;
	enterNormal(instance, "中文你好 abc\nx😀yéz");
	for (const key of ["g", "g", "v", "j"]) instance.handleInput(key);
	for (const width of [5, 8, 12, 30]) {
		const rows = instance.render(width);
		assert.ok(rows.slice(1, -1).every(row => row.startsWith(" ".repeat(Math.min(2, Math.floor((width - 1) / 2))))));
		if (width >= 8) assert.equal(rows.join("").split(CURSOR_MARKER).length - 1, 1);
		for (const row of rows) assert.ok(visibleWidth(row) <= width);
	}
});

test("insert forward-delete reconciles live paste IDs before new literal input", () => {
	const instance = editor(); const payload = "A".repeat(1200);
	instance.handleInput(`\x1b[200~${payload}\x1b[201~`); const marker = instance.getText();
	for (const key of ["\x1b", "0", "i", "\x1b[3~", marker]) instance.handleInput(key);
	assert.equal(instance.getExpandedText(), marker);
	instance.handleInput(`\x1b[200~${"B".repeat(1200)}\x1b[201~`);
	assert.equal(instance.getExpandedText(), marker + "B".repeat(1200));
});

test("large insert paste dot uses its actual payload rather than stale marker IDs", () => {
	const instance = editor(); const payload = "A".repeat(1200);
	instance.handleInput(`\x1b[200~${payload}\x1b[201~`);
	instance.handleInput("\x1b"); instance.handleInput(".");
	assert.equal(instance.getExpandedText(), payload + payload);
	instance.handleInput("u"); assert.equal(instance.getExpandedText(), payload);
	instance.handleInput("\x12"); assert.equal(instance.getExpandedText(), payload + payload);
});

test("visual highlight uses the exact padded body cells and bottom border", () => {
	const instance = editor(); instance.setPaddingX(2); enterNormal(instance, "abcdefgh");
	for (const key of ["0", "v", "l", "l"]) instance.handleInput(key);
	const rows = instance.render(10);
	assert.equal(rows[1], "  \x1b[7ma\x1b[0m\x1b[7mb\x1b[0m\x1b[7mc\x1b[0mdef  ");
	assert.equal(rows[2], "  gh      ");
	assert.ok(rows[3]!.includes("VISUAL"));
});

test("Normal dot recording restarts after external setText", () => {
	const instance = editor(); enterNormal(instance, "first"); instance.setText("abcd");
	for (const key of ["0", "x", "."]) instance.handleInput(key);
	assert.equal(instance.getText(), "cd");
});

test("asynchronous completion stays grouped and dot never invokes its provider", async () => {
	const instance = editor(); let calls = 0;
	instance.setAutocompleteProvider({
		async getSuggestions() { calls++; return { prefix: "", items: [{ value: "done", label: "done" }] }; },
		applyCompletion() { return { lines: ["done"], cursorLine: 0, cursorCol: 4 }; },
	});
	instance.handleInput("\t");
	await new Promise(resolve => setTimeout(resolve, 10));
	assert.equal(instance.getText(), "done");
	instance.render(40); instance.handleInput("\x1b");
	const beforeRepeat = calls; instance.handleInput(".");
	assert.equal(calls, beforeRepeat);
	instance.handleInput("u"); assert.equal(instance.getText(), "done");
	instance.handleInput("u"); assert.equal(instance.getText(), "");
});

test("out-of-range relative dot edits are no-ops, with original undo still available", () => {
	const instance = editor(); enterNormal(instance, "abc");
	for (const key of ["i", "\x1b[D", "\x7f", "\x1b"]) instance.handleInput(key);
	const before = instance.getText(); instance.handleInput(".");
	assert.equal(instance.getText(), before);
	instance.handleInput("u"); assert.equal(instance.getText(), "abc");
});

test("fragmented bracketed paste never routes payload controls as app or modal keys", () => {
	const instance = editor(); let aborted = 0, submitted = 0;
	instance.onEscape = () => aborted++;
	instance.onSubmit = () => submitted++;
	for (const fragment of ["\x1b[200~", "a", "\x1b", "\r", "b", "\x1b[20", "1~"]) instance.handleInput(fragment);
	assert.equal(aborted, 0); assert.equal(submitted, 0);
	assert.equal(instance.getExpandedText(), "a\nb");
	instance.handleInput("\x1b"); instance.handleInput(".");
	assert.equal(submitted, 0); assert.equal(aborted, 0);
});

test("same visible marker with different hidden payload is an undoable change", () => {
	const instance = editor(); const a = "A".repeat(1200), b = "B".repeat(1200);
	instance.handleInput(`\x1b[200~${a}\x1b[201~`);
	for (const key of ["\x1b", "0", "i", "\x1b[3~"]) instance.handleInput(key);
	instance.handleInput(`\x1b[200~${b}\x1b[201~`);
	instance.handleInput("\x1b"); instance.handleInput("u");
	assert.equal(instance.getExpandedText(), a);
	instance.handleInput("\x12"); assert.equal(instance.getExpandedText(), b);
});

test("Pi kill ring owns a killed compact paste after live IDs are reconciled", () => {
	const instance = editor(); const payload = "A".repeat(1200);
	instance.handleInput(`\x1b[200~${payload}\x1b[201~`);
	instance.handleInput("\x15"); assert.equal(instance.getText(), "");
	instance.handleInput("\x19"); assert.equal(instance.getExpandedText(), payload);
});

test("final-width padding safely renders wide characters and markers at every narrow width", () => {
	for (let padding = 0; padding <= 4; padding++) {
		for (const text of ["😀", "中文", "[paste #1 1200 chars]"]) {
			const instance = editor(); instance.setPaddingX(padding); instance.setText(text);
			for (let width = 1; width <= 12; width++) {
				const rows = instance.render(width);
				assert.ok(rows.every(row => visibleWidth(row) <= width), `${padding}/${width}/${text}`);
				assert.equal(instance.getText(), text);
			}
		}
	}
});

test("dot of change with no insertion does not manufacture an EOF-relative edit", () => {
	const instance = editor(); enterNormal(instance, "one two three");
	for (const key of ["0", "c", "w", "\x1b", "w", "."]) instance.handleInput(key);
	assert.equal(instance.getText(), "  three");
});

test("Pi stock undo cannot cross setText boundaries or restore stale paste snapshots", () => {
	const instance = editor(); instance.setText("old"); instance.setText("new");
	instance.handleInput("\x1f"); assert.equal(instance.getText(), "new");
	instance.handleInput("!"); instance.handleInput("\x1f"); assert.equal(instance.getText(), "new");
	instance.handleInput("\x1f"); assert.equal(instance.getText(), "new");
});

test("Pi yank-pop retains independent killed payloads after ID reuse", () => {
	const instance = editor(); const a = "A".repeat(1200), b = "B".repeat(1200);
	for (const payload of [a, b]) {
		instance.handleInput(`\x1b[200~${payload}\x1b[201~`); instance.handleInput("\x15");
	}
	instance.handleInput("\x19"); assert.equal(instance.getExpandedText(), b);
	instance.handleInput("\x1by"); assert.equal(instance.getExpandedText(), a);
	instance.setText(""); instance.handleInput("[paste #1 1200 chars]");
	assert.equal(instance.getExpandedText(), "[paste #1 1200 chars]");
});

test("typing after stock undo resumes at the restored insertion boundary", () => {
	for (const text of ["abc", "x😀", "first\nsecond", ""]) {
		const instance = editor(); instance.setText(text);
		const cursor = instance.getCursor();
		instance.handleInput("X"); instance.handleInput("\x1f");
		assert.equal(instance.getText(), text);
		assert.deepEqual(instance.getCursor(), cursor);
		instance.handleInput("Y");
		assert.equal(instance.getText(), text + "Y");
	}
});

test("stock undo uses payload-aware modal snapshots inside insert mode", () => {
	const instance = editor(); const a = "A".repeat(1200), b = "B".repeat(1200);
	instance.handleInput(`\x1b[200~${a}\x1b[201~`);
	for (const key of ["\x1b", "0", "i", "\x1b[3~"]) instance.handleInput(key);
	instance.handleInput(`\x1b[200~${b}\x1b[201~`);
	instance.handleInput("\x1f"); assert.equal(instance.getExpandedText(), a);
	instance.setText("new"); instance.handleInput("\x1f");
	assert.equal(instance.getText(), "new"); assert.deepEqual(instance.getCursor(), { line: 0, col: 3 });
});
