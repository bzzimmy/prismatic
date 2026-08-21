import { type RgbColor, Text, type TUI } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";

const FRAME_INTERVAL_MS = 66;
/** Duration of one full light sweep across the label. */
const SWEEP_DURATION_MS = 1800;
/** Width of the glimmer highlight band, in characters. */
const BAND_WIDTH = 4;
/**
 * Self-stop the animation when the component has not been rendered for this
 * long (i.e. it was removed from the UI without an explicit stop()).
 */
const IDLE_STOP_MS = 5000;

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function lerpRgb(a: RgbColor, b: RgbColor, t: number): RgbColor {
	return {
		r: Math.round(lerp(a.r, b.r, t)),
		g: Math.round(lerp(a.g, b.g, t)),
		b: Math.round(lerp(a.b, b.b, t)),
	};
}

/** Round to whole seconds (min 1) and format as "1s", "1m 12s", etc. */
export function formatThinkingDuration(durationMs: number): string {
	const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes === 0) return `${seconds}s`;
	return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

/**
 * Collapsed thinking indicator: while the model is reasoning it shows the
 * label with a light glimmer sweeping across it; stop() freezes it back to
 * the plain themed label. Colors come from the theme (thinkingText base,
 * text as the highlight), so it follows theme switches.
 */
export class ThinkingIndicator extends Text {
	private ui?: TUI;
	private label: string;
	private intervalId: NodeJS.Timeout | null = null;
	private startTime = 0;
	private lastRenderTime = 0;

	constructor(label: string, paddingX: number, ui?: TUI) {
		super("", paddingX, 0);
		this.label = label;
		this.ui = ui;
		this.setText(this.staticText());
	}

	/** Begin the glimmer animation. No-op without a TUI (stays static). */
	start(): void {
		if (this.intervalId || !this.ui) return;
		this.startTime = Date.now();
		this.lastRenderTime = Date.now();
		this.intervalId = setInterval(() => {
			// Safety net: stop animating if we were dropped from the UI.
			if (Date.now() - this.lastRenderTime > IDLE_STOP_MS) {
				this.stop();
				return;
			}
			this.setText(this.renderFrame(Date.now() - this.startTime));
			this.ui?.requestRender();
		}, FRAME_INTERVAL_MS);
		// Never keep the process alive just for the glimmer.
		this.intervalId.unref();
	}

	stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
		this.setText(this.staticText());
	}

	/** Re-render with current theme colors (e.g. after a theme change). */
	refresh(): void {
		if (!this.intervalId) {
			this.setText(this.staticText());
		}
	}

	override render(width: number): string[] {
		this.lastRenderTime = Date.now();
		return super.render(width);
	}

	private staticText(): string {
		return theme.italic(theme.fg("thinkingText", this.label));
	}

	private renderFrame(elapsedMs: number): string {
		const base = theme.getFgRgb("thinkingText") ?? { r: 128, g: 128, b: 128 };
		const highlight = theme.getFgRgb("text") ?? { r: 235, g: 235, b: 235 };
		const progress = (elapsedMs % SWEEP_DURATION_MS) / SWEEP_DURATION_MS;
		// Sweep the band center from just before the label to just after it.
		const center = progress * (this.label.length + 2 * BAND_WIDTH) - BAND_WIDTH;

		let out = "";
		for (let x = 0; x < this.label.length; x++) {
			const ch = this.label[x];
			if (ch === " ") {
				out += ch;
				continue;
			}
			const distance = Math.abs(x - center);
			// Triangular falloff, smoothed to ease the band edges.
			const linear = Math.max(0, 1 - distance / BAND_WIDTH);
			const intensity = linear * linear * (3 - 2 * linear);
			out += theme.fgRgb(lerpRgb(base, highlight, intensity), ch);
		}
		return theme.italic(out);
	}
}
