import type { ActionResult } from "@/lib/types";

/**
 * What a save or an action did, next to the control that did it: announced politely when it worked and as an
 * alert when it didn't. A success without a message shows nothing.
 *
 * `small` for inline rows; `onDark` for the navy session desk, where the usual accent and danger colours don't read.
 */
export function FormMessage({
  state,
  small = false,
  onDark = false,
  className = "",
}: {
  state: ActionResult | null;
  small?: boolean;
  onDark?: boolean;
  className?: string;
}) {
  if (!state || (state.ok && !state.message)) return null;
  const tone = state.ok ? (onDark ? "text-powder" : "text-regal") : `font-semibold ${onDark ? "text-danger-soft" : "text-danger"}`;
  return (
    <p role={state.ok ? "status" : "alert"} className={`${small ? "text-sm" : ""} ${tone} ${className}`}>
      {state.ok ? state.message : state.error}
    </p>
  );
}
