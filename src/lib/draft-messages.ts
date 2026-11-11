/**
 * Creating from a draft another window has already created (or deleted). Shared by the server, which says it, and the
 * create forms, which then forget the draft, so the next Create makes the activity on its own.
 */
export const DRAFT_GONE = "This draft was already created or deleted in another window. Check your activities before creating it again.";
