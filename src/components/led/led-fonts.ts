import { Montserrat } from "next/font/google";

// The LED wall's font (see LED_FONTS). Not preloaded: only a wall (or its preview) downloads it.
const modern = Montserrat({ subsets: ["latin"], variable: "--font-led-modern", preload: false, display: "swap" });

/** Classes that define the LED font's CSS variable, for the wall's root. */
export const LED_FONT_VARIABLES = modern.variable;
