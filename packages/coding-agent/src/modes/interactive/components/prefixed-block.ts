import type { Component } from "@earendil-works/pi-tui";

/**
 * Wraps a child component and renders a styled prefix (e.g. "⏺ " or "> ")
 * in front of its first line, indenting continuation lines so the content
 * stays aligned — the way Claude Code renders transcript messages.
 */
export class PrefixedBlock implements Component {
	private prefix: string;
	private prefixWidth: number;
	private child: Component;

	/**
	 * @param prefix - Styled prefix string (may contain ANSI codes)
	 * @param prefixWidth - Visible width of the prefix (used for continuation indent)
	 * @param child - Component to render after the prefix
	 */
	constructor(prefix: string, prefixWidth: number, child: Component) {
		this.prefix = prefix;
		this.prefixWidth = prefixWidth;
		this.child = child;
	}

	invalidate(): void {
		this.child.invalidate?.();
	}

	render(width: number): string[] {
		const innerWidth = Math.max(1, width - this.prefixWidth);
		const lines = this.child.render(innerWidth);
		if (lines.length === 0) {
			return lines;
		}
		const indent = " ".repeat(this.prefixWidth);
		return lines.map((line, i) => (i === 0 ? this.prefix + line : indent + line));
	}
}
