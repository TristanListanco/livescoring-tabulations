/**
 * A random id for something the browser asks the server to create, sent with the request: if the request is sent again
 * (its reply was lost on flaky Wi-Fi, and the person pressed again), the server finds that id already used and answers
 * with what the first one made rather than making it twice. A version 4 UUID, built from crypto.getRandomValues:
 * crypto.randomUUID needs HTTPS, which a server on the venue Wi-Fi doesn't have.
 */
export function newRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
