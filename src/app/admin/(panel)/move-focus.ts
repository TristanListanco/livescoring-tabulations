import { flushSync } from "react-dom";

/**
 * Props for an item's move-up or move-down button, so moveKeepingFocus can find it again after the list changes.
 * `item` is the item's key, which stays the same as it moves.
 */
export const moveButton = (item: string | number, direction: -1 | 1) => ({ "data-move": String(item), "data-direction": String(direction) });

/**
 * Move an item up or down a list and keep focus on its move button: moving can remount the item (or disable the
 * button, at the end of the list), which would leave a keyboard user at the top of the page. It's the same button
 * while the item can still go that way, otherwise the other one. The move is applied at once, so focus never drops.
 */
export function moveKeepingFocus(item: string | number, direction: -1 | 1, move: () => void) {
  flushSync(move);
  const find = (d: -1 | 1) => document.querySelector<HTMLButtonElement>(`[data-move="${CSS.escape(String(item))}"][data-direction="${d}"]`);
  const same = find(direction);
  (same && !same.disabled ? same : find(direction === -1 ? 1 : -1))?.focus();
}
