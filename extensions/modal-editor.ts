/**
 * Vim-like modal editor for Pi.
 *
 * Small, intentionally boring subset:
 * - Escape: insert -> normal; normal -> Pi interrupt behavior
 * - i/a/A/o/O: enter insert mode
 * - h/j/k/l, w/b/e, 0/$/^: movement
 * - x, dd, D, C, I: editing shortcuts
 * - u: undo
 */

import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const ESC = "\x1b";

class VimEditor extends CustomEditor {
	private mode: "normal" | "insert" = "insert";
	private pending: string | undefined;

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) {
			this.pending = undefined;
			if (this.mode === "insert") {
				this.mode = "normal";
				return;
			}
			super.handleInput(data);
			return;
		}

		if (this.mode === "insert") {
			super.handleInput(data);
			return;
		}

		// Pass app/control keys through in normal mode.
		if (data.length !== 1 || data.charCodeAt(0) < 32) {
			super.handleInput(data);
			return;
		}

		// Tiny operator state for dd.
		if (this.pending === "d") {
			this.pending = undefined;
			if (data === "d") {
				super.handleInput("\x01"); // start of line
				super.handleInput("\x0b"); // delete to end of line
				return;
			}
		}

		switch (data) {
			case "i":
				this.mode = "insert";
				return;
			case "a":
				this.mode = "insert";
				super.handleInput(`${ESC}[C`);
				return;
			case "A":
				this.mode = "insert";
				super.handleInput("\x05"); // end of line
				return;
			case "I":
				this.mode = "insert";
				super.handleInput("\x01"); // start of line
				return;
			case "o":
				this.mode = "insert";
				super.handleInput("\x05");
				super.handleInput("\n");
				return;
			case "O":
				this.mode = "insert";
				super.handleInput("\x01");
				super.handleInput("\n");
				super.handleInput(`${ESC}[A`);
				return;
			case "h":
				super.handleInput(`${ESC}[D`);
				return;
			case "j":
				super.handleInput(`${ESC}[B`);
				return;
			case "k":
				super.handleInput(`${ESC}[A`);
				return;
			case "l":
				super.handleInput(`${ESC}[C`);
				return;
			case "w":
				super.handleInput(`${ESC}f`); // alt+f
				return;
			case "b":
				super.handleInput(`${ESC}b`); // alt+b
				return;
			case "e":
				super.handleInput(`${ESC}f`);
				super.handleInput(`${ESC}[D`);
				return;
			case "0":
			case "^":
				super.handleInput("\x01");
				return;
			case "$":
				super.handleInput("\x05");
				return;
			case "x":
				super.handleInput(`${ESC}[3~`); // delete
				return;
			case "D":
				super.handleInput("\x0b"); // ctrl+k
				return;
			case "C":
				this.mode = "insert";
				super.handleInput("\x0b");
				return;
			case "d":
				this.pending = "d";
				return;
			case "u":
				super.handleInput("\x1f"); // ctrl+_ / undo-ish fallback
				super.handleInput("\x1b-"); // alt+- fallback for terminals that encode ctrl+- oddly
				return;
		}

		// Ignore printable chars in normal mode.
	}

	render(width: number): string[] {
		const lines = super.render(width);
		if (lines.length === 0) return lines;

		const label = this.mode === "normal" ? " NORMAL " : " INSERT ";
		const last = lines.length - 1;
		if (visibleWidth(lines[last]!) >= label.length) {
			lines[last] = truncateToWidth(lines[last]!, width - label.length, "") + label;
		}
		return lines;
	}
}

export default function modalEditor(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		// Let package-provided editor hooks settle, then claim the editor.
		setTimeout(() => {
			ctx.ui.setEditorComponent((tui, theme, keybindings) => new VimEditor(tui, theme, keybindings));
		}, 0);
	});
}
