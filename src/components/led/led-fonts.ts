import { Cinzel, Montserrat, Oswald, Playfair_Display } from "next/font/google";

// The LED wall's font choices (see LED_FONTS). Not preloaded: a wall only downloads the one it shows.
const elegant = Playfair_Display({ subsets: ["latin"], variable: "--font-led-elegant", preload: false, display: "swap" });
const modern = Montserrat({ subsets: ["latin"], variable: "--font-led-modern", preload: false, display: "swap" });
const condensed = Oswald({ subsets: ["latin"], variable: "--font-led-condensed", preload: false, display: "swap" });
const classic = Cinzel({ subsets: ["latin"], variable: "--font-led-classic", preload: false, display: "swap" });

/** Classes that define every LED font's CSS variable, for the wall's root and the font choices on the LED tab. */
export const LED_FONT_VARIABLES = [elegant, modern, condensed, classic].map((f) => f.variable).join(" ");
