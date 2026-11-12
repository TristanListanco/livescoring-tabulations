import type { CSSProperties } from "react";

/**
 * The LED wall's look: a dark colour theme, chosen on the LED wall tab, and one font, Modern, with rounded panels. Every
 * theme keeps the wall's text readable (at least 5:1 against what it sits on); the green screen around the lower third
 * stays chroma green whatever the theme, so it still keys out. Activities set before to a choice no longer offered
 * (a light theme, another font, square or soft corners) show the default instead; the database keeps what they had.
 */

export type LedFont = "default" | "modern" | "condensed";
export type LedTheme = "navy" | "gold" | "crimson" | "emerald" | "royal" | "teal" | "rose" | "sunset" | "berry" | "graphite";

/**
 * The wall's font and the CSS variable it sets (see led-fonts.ts). Modern alone: Standard (the app's own) and the heavy
 * Condensed were taken away, and walls set to them show Modern.
 */
export const LED_FONTS: { value: LedFont; label: string; variable: string | null; fallback: string }[] = [
  { value: "modern", label: "Modern", variable: "--font-led-modern", fallback: "sans-serif" },
];

/**
 * Each theme's five colours, in the wall's own roles: `base` behind everything, `tile` behind each judge,
 * `accent` behind the average, `ink` for text (and the number box), `muted` for subtitles and marks.
 */
export type LedColors = { base: string; tile: string; accent: string; ink: string; muted: string };

export const LED_THEMES: { value: LedTheme; label: string; colors: LedColors }[] = [
  { value: "navy", label: "Navy", colors: { base: "#0b2545", tile: "#13315c", accent: "#134074", ink: "#eef4ed", muted: "#8da9c4" } },
  { value: "gold", label: "Black and gold", colors: { base: "#121110", tile: "#24211b", accent: "#5a4413", ink: "#fbf4e2", muted: "#d6b66e" } },
  { value: "crimson", label: "Crimson", colors: { base: "#2a0a10", tile: "#43121c", accent: "#74192a", ink: "#fdf0f2", muted: "#eaa6b1" } },
  { value: "emerald", label: "Emerald", colors: { base: "#04241a", tile: "#0b3a2a", accent: "#10593b", ink: "#effaf4", muted: "#8fd3b5" } },
  { value: "royal", label: "Royal purple", colors: { base: "#1b0c36", tile: "#2c1656", accent: "#46288a", ink: "#f5f0ff", muted: "#bfaef0" } },
  { value: "teal", label: "Midnight teal", colors: { base: "#062a30", tile: "#0b3c44", accent: "#0f5560", ink: "#eefbfb", muted: "#8fd4d8" } },
  { value: "rose", label: "Rose gold", colors: { base: "#2b1418", tile: "#3e1e24", accent: "#6e3540", ink: "#fdf1ef", muted: "#ecb9ad" } },
  { value: "sunset", label: "Sunset amber", colors: { base: "#2a1505", tile: "#40210a", accent: "#7a3c0e", ink: "#fff4e8", muted: "#f5b878" } },
  { value: "berry", label: "Berry", colors: { base: "#2a0a24", tile: "#401236", accent: "#6e1a59", ink: "#fdf0fa", muted: "#eba8da" } },
  { value: "graphite", label: "Graphite", colors: { base: "#17191c", tile: "#25292e", accent: "#434a53", ink: "#f4f6f8", muted: "#b9c1cb" } },
];

/** The panels' rounded corners: in stage pixels for the 1920×1080 lower third, and in container units for the full screen. */
const RADIUS = { overlay: "28px", full: "min(2cqw, 3.6cqh)" };

export const toLedFont = (value: unknown): LedFont => LED_FONTS.find((f) => f.value === value)?.value ?? "modern";
export const toLedTheme = (value: unknown): LedTheme => LED_THEMES.find((t) => t.value === value)?.value ?? "navy";

/** A theme's colours. */
export const ledColors = (theme: LedTheme): LedColors => (LED_THEMES.find((t) => t.value === theme) ?? LED_THEMES[0]).colors;

/** The font-family for a font choice; undefined keeps the app's. */
export function ledFontFamily(font: LedFont): string | undefined {
  const choice = LED_FONTS.find((f) => f.value === font);
  return choice?.variable ? `var(${choice.variable}), ${choice.fallback}` : undefined;
}

/**
 * The wall's look as styles for its root: the theme's colours in place of the palette the graphic is drawn with
 * (so every part follows), the font, and the corner radius as --led-radius.
 */
export function ledStyle(look: { font: LedFont; theme: LedTheme }, fullscreen: boolean): CSSProperties {
  const c = ledColors(look.theme);
  return {
    "--color-prussian": c.base,
    "--color-oxford": c.tile,
    "--color-regal": c.accent,
    "--color-mint": c.ink,
    "--color-powder": c.muted,
    "--led-radius": fullscreen ? RADIUS.full : RADIUS.overlay,
    fontFamily: ledFontFamily(look.font),
    // Scores sit on the line in every font (the elegant serif's own numbers dip below it).
    fontFeatureSettings: '"lnum" 1',
  } as CSSProperties;
}
