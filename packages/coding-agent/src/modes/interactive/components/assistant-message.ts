import type { AssistantMessage } from "@earendil-works/pi-ai";
import { Container, Markdown, type MarkdownTheme, Spacer, Text, type TUI } from "@earendil-works/pi-tui";
import type { MarkdownTransformer } from "../../../core/extensions/types.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";
import { createMarkdownTransform } from "./markdown-transform.ts";
import { PrefixedBlock } from "./prefixed-block.ts";
import { formatThinkingDuration, ThinkingIndicator } from "./thinking-indicator.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

/**
 * Component that renders a complete assistant message
 */
export class AssistantMessageComponent extends Container {
	private contentContainer: Container;
	private hideThinkingBlock: boolean;
	private markdownTheme: MarkdownTheme;
	private hiddenThinkingLabel: string;
	private outputPad: number;
	private markdownTransformers: readonly MarkdownTransformer[];
	private lastMessage?: AssistantMessage;
	private hasToolCalls = false;
	private isStreaming = false;
	private ui?: TUI;
	// Thinking-run timing, keyed by the content index where each run starts.
	// Only populated for runs observed live while streaming; historical runs
	// (e.g. resumed sessions) have no measured duration.
	private thinkingStartTimes = new Map<number, number>();
	private thinkingDurations = new Map<number, number>();
	// Reused across updateContent() calls so the glimmer animation keeps its
	// phase and timer instead of restarting on every stream delta.
	private thinkingIndicators = new Map<number, ThinkingIndicator>();

	constructor(
		message?: AssistantMessage,
		hideThinkingBlock = false,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		hiddenThinkingLabel = "Thinking...",
		outputPad = 1,
		markdownTransformers: readonly MarkdownTransformer[] = [],
		ui?: TUI,
	) {
		super();

		this.ui = ui;

		this.hideThinkingBlock = hideThinkingBlock;
		this.markdownTheme = markdownTheme;
		this.hiddenThinkingLabel = hiddenThinkingLabel;
		this.outputPad = outputPad;
		this.markdownTransformers = markdownTransformers;

		// Container for text/thinking content
		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		if (message) {
			this.updateContent(message);
		}
	}

	override invalidate(): void {
		super.invalidate();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHideThinkingBlock(hide: boolean): void {
		this.hideThinkingBlock = hide;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHiddenThinkingLabel(label: string): void {
		this.hiddenThinkingLabel = label;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	private stopIndicator(runStart: number): void {
		const indicator = this.thinkingIndicators.get(runStart);
		if (indicator) {
			indicator.stop();
			this.thinkingIndicators.delete(runStart);
		}
	}

	setOutputPad(padding: number): void {
		this.outputPad = padding;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		if (this.hasToolCalls || lines.length === 0) {
			return lines;
		}

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return lines;
	}

	updateContent(message: AssistantMessage, isStreaming = this.isStreaming): void {
		this.lastMessage = message;
		this.isStreaming = isStreaming;

		// Clear content container
		this.contentContainer.clear();

		const hasVisibleContent = message.content.some(
			(c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()),
		);

		if (hasVisibleContent) {
			this.contentContainer.addChild(new Spacer(1));
		}

		// Render content in order
		for (let i = 0; i < message.content.length; i++) {
			const content = message.content[i];
			if (content.type === "text" && content.text.trim()) {
				// Claude Code style: "⏺ " bullet prefix, no background, continuation
				// lines aligned under the text. paddingY=0 avoids extra spacing before
				// tool executions.
				this.contentContainer.addChild(
					new PrefixedBlock(
						`${" ".repeat(this.outputPad)}${theme.fg("text", "⏺")} `,
						this.outputPad + 2,
						new Markdown(content.text.trim(), 0, 0, this.markdownTheme, undefined, {
							transform: createMarkdownTransform("assistant", this.isStreaming, this.markdownTransformers),
						}),
					),
				);
			} else if (content.type === "thinking") {
				const runStart = i;
				const thinkingBlocks: string[] = [];
				for (; i < message.content.length; i++) {
					const thinkingContent = message.content[i];
					if (thinkingContent.type !== "thinking") {
						break;
					}
					const thinking = thinkingContent.thinking.trim();
					if (thinking) {
						thinkingBlocks.push(thinking);
					}
				}
				i--;

				if (thinkingBlocks.length === 0) {
					continue;
				}

				// A run is "active" while it is still streaming in: it reaches the end
				// of the content array and no later content has started yet.
				const runActive = this.isStreaming && i === message.content.length - 1;
				if (runActive) {
					if (!this.thinkingStartTimes.has(runStart)) {
						this.thinkingStartTimes.set(runStart, Date.now());
					}
				} else {
					const startTime = this.thinkingStartTimes.get(runStart);
					if (startTime !== undefined && !this.thinkingDurations.has(runStart)) {
						this.thinkingDurations.set(runStart, Date.now() - startTime);
					}
				}

				// Add spacing only when another visible assistant content block follows.
				// This avoids a superfluous blank line before separately-rendered tool execution blocks.
				const hasVisibleContentAfter = message.content
					.slice(i + 1)
					.some((c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()));

				if (this.hideThinkingBlock) {
					if (runActive) {
						// Show one glimmering label while this run of thinking blocks streams in.
						let indicator = this.thinkingIndicators.get(runStart);
						if (!indicator) {
							indicator = new ThinkingIndicator(this.hiddenThinkingLabel, this.outputPad, this.ui);
							indicator.start();
							this.thinkingIndicators.set(runStart, indicator);
						}
						this.contentContainer.addChild(indicator);
					} else {
						this.stopIndicator(runStart);
						const duration = this.thinkingDurations.get(runStart);
						const label =
							duration !== undefined ? `Thought for ${formatThinkingDuration(duration)}` : "Thought for a while";
						this.contentContainer.addChild(
							new Text(theme.italic(theme.fg("thinkingText", label)), this.outputPad, 0),
						);
					}
				} else {
					this.stopIndicator(runStart);
					// Render each run of thinking blocks as one Markdown section.
					this.contentContainer.addChild(
						new Markdown(
							thinkingBlocks.join("\n\n"),
							this.outputPad,
							0,
							this.markdownTheme,
							{
								color: (text: string) => theme.fg("thinkingText", text),
								italic: true,
							},
							{
								transform: createMarkdownTransform(
									"assistant-thinking",
									this.isStreaming,
									this.markdownTransformers,
								),
							},
						),
					);
				}
				if (hasVisibleContentAfter) {
					this.contentContainer.addChild(new Spacer(1));
				}
			}
		}

		// Check if incomplete/failed - show after partial content.
		// For aborted/error tool calls, tool execution components show the error.
		// Length stops can happen before a tool call is complete, so surface them here too.
		const hasToolCalls = message.content.some((c) => c.type === "toolCall");
		this.hasToolCalls = hasToolCalls;
		if (message.stopReason === "length") {
			this.contentContainer.addChild(new Spacer(1));
			this.contentContainer.addChild(
				new Text(theme.fg("error", "Response was truncated before completion."), this.outputPad, 0),
			);
		} else if (!hasToolCalls) {
			if (message.stopReason === "aborted") {
				const abortMessage =
					message.errorMessage && message.errorMessage !== "Request was aborted"
						? message.errorMessage
						: "Operation aborted";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", abortMessage), this.outputPad, 0));
			} else if (message.stopReason === "error") {
				const errorMsg = message.errorMessage || "Unknown error";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", `Error: ${errorMsg}`), this.outputPad, 0));
			}
		}
	}
}
