import assert from "node:assert/strict";
import test from "node:test";
import { VimCore } from "../extensions/modal-editor/core.ts";

function normal(text: string, cursor = 0): VimCore {
	return new VimCore(text, cursor, "normal");
}

function keys(core: VimCore, sequence: string): void {
	for (const key of sequence) core.feed(key);
}

test("operator and motion counts multiply in either position", () => {
	for (const sequence of ["2dw", "d2w"]) {
		const core = normal("one two three four");
		keys(core, sequence);
		assert.equal(core.text, "three four", sequence);
	}
	const multiplied = normal("one two three four five");
	keys(multiplied, "2d2w");
	assert.equal(multiplied.text, "five");
});

test("linewise dd, cc, and yy preserve line boundaries including the final line", () => {
	const deleted = normal("one\ntwo\nthree", 4);
	keys(deleted, "2dd");
	assert.equal(deleted.text, "one");
	assert.equal(deleted.yank.text, "two\nthree");
	assert.equal(deleted.yank.linewise, true);

	const only = normal("only");
	keys(only, "dd");
	assert.equal(only.text, "");
	assert.equal(only.cursor, 0);

	const changed = normal("one\ntwo\nthree", 4);
	keys(changed, "cc");
	assert.equal(changed.mode, "insert");
	assert.equal(changed.text, "one\n\nthree");
	changed.sync("one\nTWO\nthree", 7);
	assert.equal(changed.finishInsert(), true);
	assert.equal(changed.undo(), true);
	assert.equal(changed.text, "one\ntwo\nthree");

	const yanked = normal("a\nb\nc", 2);
	keys(yanked, "2yy");
	assert.equal(yanked.text, "a\nb\nc");
	assert.deepEqual(yanked.yank, { text: "b\nc", linewise: true });
});

test("word motions distinguish Vim words and WORDs", () => {
	const small = normal("alpha-beta gamma");
	keys(small, "w");
	assert.equal(small.cursor, 5);
	keys(small, "w");
	assert.equal(small.cursor, 6);
	keys(small, "e");
	assert.equal(small.cursor, 9);
	keys(small, "b");
	assert.equal(small.cursor, 6);

	const big = normal("alpha-beta gamma");
	keys(big, "W");
	assert.equal(big.cursor, 11);
	keys(big, "B");
	assert.equal(big.cursor, 0);
	keys(big, "E");
	assert.equal(big.cursor, 9);
});

test("logical line motions and gg/G do not depend on prompt history", () => {
	const core = normal("abcdef\nx\n12345", 4);
	keys(core, "j");
	assert.equal(core.cursor, 7);
	keys(core, "j");
	assert.equal(core.cursor, 13);
	keys(core, "k");
	assert.equal(core.cursor, 7);
	keys(core, "gg");
	assert.equal(core.cursor, 0);
	keys(core, "G");
	assert.equal(core.cursor, 9);
	keys(core, "2G");
	assert.equal(core.cursor, 7);
});

test("find/till repetition and matching pairs support operators", () => {
	const find = normal("a-c-b-c-d");
	keys(find, "2fc");
	assert.equal(find.cursor, 6);
	keys(find, ";");
	assert.equal(find.cursor, 6, "no third c leaves cursor unchanged");
	keys(find, ",");
	assert.equal(find.cursor, 2);

	const backward = normal("a:b:c", 4);
	keys(backward, "F:");
	assert.equal(backward.cursor, 3);
	keys(backward, ";");
	assert.equal(backward.cursor, 1);
	keys(backward, ",");
	assert.equal(backward.cursor, 3);
	const backwardTill = normal("a:b:c", 4);
	keys(backwardTill, "2T:");
	assert.equal(backwardTill.cursor, 2);

	const tillDelete = normal("abc:def:ghi");
	keys(tillDelete, "dt:");
	assert.equal(tillDelete.text, ":def:ghi");

	const matched = normal("x (a[b]c) y");
	keys(matched, "%");
	assert.equal(matched.cursor, 8);
	keys(matched, "d%");
	assert.equal(matched.text, "x  y");
});

test("word, quote, and nested bracket text objects select expected ranges", () => {
	const innerWord = normal("say alpha beta", 5);
	keys(innerWord, "diw");
	assert.equal(innerWord.text, "say  beta");

	const aroundWord = normal("say alpha beta", 5);
	keys(aroundWord, "daw");
	assert.equal(aroundWord.text, "say beta");

	const quote = normal("say \"hello world\" now", 7);
	keys(quote, "ci\"");
	assert.equal(quote.text, "say \"\" now");
	assert.equal(quote.mode, "insert");

	const nested = normal("a(foo[bar[baz]qux]z)", 10);
	keys(nested, "di[");
	assert.equal(nested.text, "a(foo[bar[]qux]z)");
});

test("visual character and line selections yank, delete, and change", () => {
	const chars = normal("abcd ef");
	keys(chars, "vllld");
	assert.equal(chars.text, " ef");
	assert.deepEqual(chars.yank, { text: "abcd", linewise: false });

	const lines = normal("a\nb\nc", 2);
	keys(lines, "Vjy");
	assert.deepEqual(lines.yank, { text: "b\nc", linewise: true });
	assert.equal(lines.text, "a\nb\nc");

	const change = normal("abc");
	keys(change, "vlc");
	assert.equal(change.text, "c");
	assert.equal(change.mode, "insert");
});

test("undo and redo group an insert/change transaction", () => {
	const core = normal("one two");
	keys(core, "cw");
	assert.equal(core.mode, "insert");
	core.sync("ONEtwo", 3);
	core.finishInsert();
	assert.equal(core.undo(), true);
	assert.equal(core.text, "one two");
	assert.equal(core.redo(), true);
	assert.equal(core.text, "ONEtwo");
});

test("insert entry points and common edit shortcuts keep correct line edges", () => {
	for (const command of ["o", "O"]) {
		const empty = normal("");
		keys(empty, command);
		assert.equal(empty.text, "", `${command} does not create a phantom line in an empty buffer`);
		assert.equal(empty.mode, "insert");
	}

	const below = normal("a\nb");
	keys(below, "o");
	assert.equal(below.text, "a\n\nb");
	assert.equal(below.cursor, 2);
	const above = normal("a\nb", 2);
	keys(above, "O");
	assert.equal(above.text, "a\n\nb");
	assert.equal(above.cursor, 2);

	const append = normal("  abc");
	keys(append, "I");
	assert.equal(append.cursor, 2);
	append.finishInsert();
	keys(append, "A");
	assert.equal(append.cursor, 5);

	const changes = normal("one two");
	keys(changes, "cw");
	assert.equal(changes.text, " two", "cw follows Vim's ce special case");
	assert.equal(changes.mode, "insert");

	const deleteEnd = normal("abc", 1);
	keys(deleteEnd, "D");
	assert.equal(deleteEnd.text, "a");
	const substitute = normal("abcd", 1);
	keys(substitute, "2s");
	assert.equal(substitute.text, "ad");
	assert.equal(substitute.mode, "insert");
});

test("linewise paste, joins, case toggling, and replacement are undoable", () => {
	const core = normal("a\nb\nc");
	keys(core, "yyjp");
	assert.equal(core.text, "a\nb\na\nc");
	assert.equal(core.undo(), true);
	assert.equal(core.text, "a\nb\nc");

	const intoEmpty = normal("z");
	keys(intoEmpty, "yyddp");
	assert.equal(intoEmpty.text, "z");

	const edits = normal("one\n  two");
	keys(edits, "J");
	assert.equal(edits.text, "one two");
	keys(edits, "0~lrX");
	assert.equal(edits.text, "OnX two");
});

test("graphemes and Pi paste markers remain atomic", () => {
	const emoji = normal("👨‍👩‍👧‍👦x");
	keys(emoji, "x");
	assert.equal(emoji.text, "x");

	const marker = "[paste #1 +99 lines]";
	const paste = normal(`${marker} tail`);
	keys(paste, "%");
	assert.equal(paste.cursor, 0, "matching does not enter marker syntax");
	keys(paste, "f]");
	assert.equal(paste.cursor, 0, "find does not enter marker syntax");
	keys(paste, "~");
	assert.equal(paste.text, `${marker} tail`, "case toggle preserves marker spelling");
	keys(paste, "0x");
	assert.equal(paste.text, " tail");
	assert.equal(paste.undo(), true);
	assert.equal(paste.text, `${marker} tail`);
});

test("failed operators cancel without standalone edits or changes", () => {
	for (const seq of ["dx", "dA", "dfz", "cfz", "d%", "c%", "dgx"]) {
		const core = normal("abc"); keys(core, seq);
		assert.equal(core.text, "abc", seq); assert.equal(core.mode, "normal", seq);
		assert.equal(core.undo(), false, seq);
	}
});

test("word-end counts include single-character words and cw keeps the next word", () => {
	const core = normal("a b c d"); keys(core, "2e"); assert.equal(core.cursor, 4);
	const change = normal("a next"); keys(change, "cw"); assert.equal(change.text, " next");
	const end = normal("ab c d"); keys(end, "3e"); assert.equal(end.cursor, 5);
});

test("closing delimiter belongs to enclosing text object", () => {
	const core = normal("(foo)", 4); keys(core, "di)"); assert.equal(core.text, "()");
});

test("all motion and paste cursor placements preserve graphemes", () => {
	const core = normal("abc\nx😀y", 2); keys(core, "jx"); assert.equal(core.text, "abc\nxy");
	const combining = normal("abc\nx éz", 4); keys(combining, "k");
	const paste = normal("a"); paste.yank = { text: "😀", linewise: false }; keys(paste, "px"); assert.equal(paste.text, "a");
	const insert = new VimCore("a\nb", 2, "insert"); insert.finishInsert(); assert.equal(insert.cursor, 2);
});

test("linewise blank and final-line yanks preserve exact logical lines", () => {
	const final = normal("a\nb", 2); keys(final, "yy"); assert.equal(final.cursor, 2);
	const trailing = normal("a\n"); keys(trailing, "yyp"); assert.equal(trailing.text, "a\na\n");
	const blank = normal("a\n\nb", 2); keys(blank, "yyp"); assert.equal(blank.text, "a\n\n\nb");
	const blanks = normal("\n\na"); keys(blanks, "2yy"); assert.equal(blanks.yank.text, "\n");
});

test("counts are capped without enormous loops or allocation", () => {
	const core = normal("abc"); keys(core, "9".repeat(400) + "x"); assert.equal(core.text, "");
	core.yank = { text: "x", linewise: false }; keys(core, "9".repeat(400) + "p"); assert.equal(core.text.length, 1000);
});

test("Unicode edits at every UTF-16 input column never leave unpaired surrogates", () => {
	const text = "a😀é👨‍👩‍👧‍👦\nx😀z";
	for (let cursor = 0; cursor <= text.length; cursor++) {
		for (const seq of ["x", "X", "jx", "kx", "lx", "bx", "~", "diw"]) {
			const core = normal(text, cursor); keys(core, seq);
			assert.equal(core.text.isWellFormed(), true, `${cursor}: ${seq}`);
		}
	}
});

test("valid empty bracket objects enter change mode while failed motions do not", () => {
	const core = normal("()", 1); keys(core, "ci)");
	assert.equal(core.mode, "insert"); assert.equal(core.cursor, 1);
	assert.equal(core.text, "()");
	const failed = normal("abc"); keys(failed, "cfz"); assert.equal(failed.mode, "normal");
});

test("cc on the final line preserves an unselected leading blank line", () => {
	const core = normal("\na", 1); keys(core, "cc");
	assert.equal(core.text, "\n"); assert.equal(core.cursor, 1); assert.equal(core.mode, "insert");
});

test("till repetition advances beyond the target that produced the current stop", () => {
	const forward = normal("a:b:c"); keys(forward, "t:;"); assert.equal(forward.cursor, 2);
	const backward = normal("a:b:c", 4); keys(backward, "T:;"); assert.equal(backward.cursor, 2);
	const reverse = normal("a:b:c:d:e"); keys(reverse, "2t:;"); assert.equal(reverse.cursor, 4);
	keys(reverse, ","); assert.equal(reverse.cursor, 2);
	keys(reverse, ";"); assert.equal(reverse.cursor, 4);
});

test("saveChange compares paste registries even when visible text is identical", () => {
	const core = normal("[paste #1 1200 chars]");
	core.pastes.set(1, "A".repeat(1200)); const before = core.snapshot();
	core.pastes.set(1, "B".repeat(1200)); core.saveChange(before);
	assert.equal(core.undo(), true); assert.equal(core.pastes.get(1), "A".repeat(1200));
	assert.equal(core.redo(), true); assert.equal(core.pastes.get(1), "B".repeat(1200));
});

test("counted reverse till repetition skips the adjacent stopping target", () => {
	const core = normal("a:b:c:d:e", 8); keys(core, "T:2;"); assert.equal(core.cursor, 4);
	keys(core, ","); assert.equal(core.cursor, 6);
	keys(core, ";"); assert.equal(core.cursor, 4);
});
