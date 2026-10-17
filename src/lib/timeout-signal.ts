/**
 * A signal that aborts after `ms` (a "TimeoutError", as a fetch reports it), or as soon as `signal` does. Built on
 * AbortController alone: AbortSignal.timeout and AbortSignal.any are missing from browsers judges still bring (Safari
 * before 16 and 17.4, Chrome before 116).
 */
export function timeoutSignal(ms: number, signal?: AbortSignal | null): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("The request took too long.", "TimeoutError")), ms);
  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  return controller.signal;
}
