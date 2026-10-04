import "server-only";
import QRCode from "qrcode";

/** A QR code for a URL as SVG markup, in the app's navy on white so it scans in light and dark mode alike. */
export function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0b2545", light: "#ffffff" } });
}
