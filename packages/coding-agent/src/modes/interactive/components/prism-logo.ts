import { type RgbColor, Text, type TUI } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";

/** Pixel-art prism rendered with half/full block characters. */
const PRISM_ROWS: string[] = ["     ▄", "    ▄█▄", "   ▄███▄", "  ▄█████▄", " ▄███████▄"];

const FRAME_INTERVAL_MS = 66;
const ANIMATION_DURATION_MS = 2600;
/** Number of shimmer wave cycles that travel through the prism during the animation. */
const SHIMMER_CYCLES = 2.5;

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

/**
 * Startup logo: a prism whose purple-to-white gradient shimmers for a few
 * seconds, then settles into a static diagonal gradient. Gradient endpoints
 * come from the theme (logoGradientStart/logoGradientEnd), so custom themes
 * restyle it and it follows theme switches.
 */
export class PrismLogo extends Text {
	private ui: TUI;
	private intervalId: NodeJS.Timeout | null = null;
	private startTime = 0;

	constructor(ui: TUI) {
		super("", 1, 0);
		this.ui = ui;
		this.setText(this.renderFrame(1));
	}

	/** Begin the startup shimmer animation. */
	start(): void {
		this.stop();
		this.startTime = Date.now();
		this.intervalId = setInterval(() => {
			const progress = Math.min((Date.now() - this.startTime) / ANIMATION_DURATION_MS, 1);
			this.setText(this.renderFrame(progress));
			this.ui.requestRender();
			if (progress >= 1) {
				this.stop();
			}
		}, FRAME_INTERVAL_MS);
		// Never keep the process alive just for the intro animation.
		this.intervalId.unref();
	}

	stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	/** Re-render with current theme colors (e.g. after a theme change). */
	refresh(): void {
		if (!this.intervalId) {
			this.setText(this.renderFrame(1));
		}
	}

	private renderFrame(progress: number): string {
		const start = theme.getFgRgb("logoGradientStart") ?? { r: 167, g: 139, b: 250 };
		const end = theme.getFgRgb("logoGradientEnd") ?? { r: 245, g: 243, b: 255 };
		const rows = PRISM_ROWS.length;
		const width = Math.max(...PRISM_ROWS.map((row) => row.length));
		// Ease-out so the shimmer decelerates before settling into the static gradient.
		const settle = progress * progress;
		const phase = progress * SHIMMER_CYCLES * 2 * Math.PI;

		const lines: string[] = [];
		for (let y = 0; y < rows; y++) {
			const row = PRISM_ROWS[y];
			let line = "";
			for (let x = 0; x < row.length; x++) {
				const ch = row[x];
				if (ch === " ") {
					line += ch;
					continue;
				}
				// Diagonal gradient coordinate (0..1) across the prism.
				const u = (y / (rows - 1) + x / (width - 1)) / 2;
				// Travelling wave remapped to 0..1, cross-faded into the static gradient.
				const wave = 0.5 + 0.5 * Math.sin(2 * Math.PI * u - phase);
				const t = lerp(wave, u, settle);
				line += theme.fgRgb(lerpRgb(start, end, t), ch);
			}
			lines.push(line);
		}
		return lines.join("\n");
	}
}
