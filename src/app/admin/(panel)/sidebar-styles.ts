/**
 * A row of the sidebar: an icon and its label (in a .sidebar-label, which fades out when the sidebar collapses to its
 * icons). The open section's row is lifted onto the card colour; the rest are quiet until hovered.
 */
export const SIDEBAR_ROW = "flex h-10 w-full items-center gap-3 overflow-hidden rounded-xl px-3 text-[15px] whitespace-nowrap transition-colors pointer-coarse:h-11";
export const SIDEBAR_IDLE = "text-prussian/70 hover:bg-white/60 hover:text-prussian";
export const SIDEBAR_OPEN = "bg-white font-medium text-prussian shadow-[0_1px_2px_rgb(11_37_69/0.08)]";
