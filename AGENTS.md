<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Tabulous

The app's state machines (an activity's phases and the moves between them, what can change when, judges' devices, corrections, the timer, drafts) are listed in `docs/state-machines.md`, with which layer guards each move: server action, database trigger, or what the panel offers. The phases, moves and lock table themselves are `src/lib/lifecycle.ts`: check a move or a lock there rather than comparing `session_state` by hand, and keep the database's triggers in `supabase/schema.sql` in step with it.
