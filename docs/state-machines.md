# State machines

Tabulous runs on a handful of state machines. Most aren't one declared table: a state lives in a column (or a few), and its moves are checked in a server action, held again by a database trigger, and shown by the panel. This page lists each one, where it lives, what moves it, and which layer guards each move, so a change to one can be made in every place it's checked.

**Where the rules live in code:**
- **`src/lib/lifecycle.ts`:** the activity's phases, the moves between them (`SESSION_MOVES`, `canMove`), what can still change in each phase (`editable`), and the mode helpers (`scoresGoOutLive`, `hasLedWall`). It's pure and tested (`lifecycle.test.ts`). Server actions check moves there before writing, and the panel asks there what to offer.
- **`supabase/schema.sql`:** the triggers, which hold the same rules for anything that slips past the server: a stale tab, two requests at once, a direct database call.

Guard columns below: **S** server action, **D** database trigger or constraint, **U** what the panel offers. A move with **S** but no **D** relies on every caller going through the server.

---

## 1. Activity lifecycle (the core)

**Lives in:**
- `activities.session_state` (`draft` · `live` · `deliberation` · `ended`)
- `session_started_at`, `signed_off_at`, `archived_at`
- `phaseOf()` names the phases.

**Phases:**
- **`setup`:** not started yet.
- **`setup-after-reset`:** draft, but it started before and its scores were reset. The panel and the rules stay locked.
- **`live`:** judges are scoring.
- **`deliberation`:** an event without live scoring, with every entry scored. Judges review, correct and sign.
- **`ended`:** judging is over.
- **`signed-off`:** ended through the deliberation, signed by every judge and the organizer.
- **`archived`:** put away for good; it can only be read, exported or deleted.

| Move | From | Triggered by | Guards |
|------|------|--------------|--------|
| start | setup, setup-after-reset | `setSessionState(…, "live")` | **S** needs judges, entries, a chair without live scoring, and complete pageant boards. **U** |
| deliberate | live | `beginDeliberation` (desk, or the chair's `startDeliberation`) | **S** `deliberationGap`. **D** `check_deliberation` (every score in), `check_entry_added` |
| end | live, deliberation | `setSessionState(…, "ended")`, and `endWhenEveryScoreIsIn` with live scoring | **S** needs the password; a deliberation also needs every signature, no unbroken tie and the organizer's signature. **D** `check_deliberation` (signatures and sign-off) |
| reopen | ended | `setSessionState(…, "live")` | **S** not when signed off, and not with live scoring once every score is in. **D** `clear_signatures_on_reopen` |
| redeliberate | signed-off | `setSessionState(…, "deliberation")` → `redeliberate` | **S** needs the password; writes only if still ended |
| reset | any but archived | `resetScores` | **S** needs the password; clears the scores, moves to draft and retries if a score lands in between. **D** `check_session_restart` (no scores when moving to draft) |
| archive | ended, signed-off | `archiveActivity` | **S** needs the password and no open correction; the dialog says when results can't be downloaded. **D** `activities_archived_ended_check`, `forbid_unarchive`, `sign_out_on_archive` |

**Every write only happens from the state it was decided on** (`.eq("session_state", …)`), and it checks that a row changed, so a stale click or a second request changes nothing and says so.

**Gaps:**
- The database doesn't hold "no unbroken ties at end".
- The database doesn't refuse deliberation → live or reopening signed results (the server does).

## 2. What can still change (`editable`)

| Part | Phases | Notes |
|------|--------|-------|
| judges | setup | **D** `judges_locked` (insert and delete; migration 039). Renames, photos and boards are **S** only. |
| rules (live scoring, timer, own pace, decimal places) | setup | **S**; writes are conditional on still being draft |
| running order, program, guides | setup, setup-after-reset | **D** `set_entry_order` for the order |
| entries | until ended | Each action has finer rules: no adding in deliberation, and nothing scored or on screen can be removed |
| judges' options (reasons list, see ranking) | until ended | |

## 3. Activity mode

**Lives in:** `kind` × `live_scoring` × `independent_scoring`.

**Modes:**
- a live event: scores show as they come in;
- a deliberated event: scores stay with the judges until everyone has signed;
- an own-pace event: a deliberated event where judges pick entries themselves;
- a pageant, whose scores go out live.

**Helpers:** `scoresGoOutLive` (also "has an LED wall" and the "Live" status), `resultsReleased` (in `data.ts`), `atOwnPace` and `chairMovesEntries` (in `judging.ts`).

## 4. Deliberation

**Steps:** reviewing → ties open → a correction open → every judge signed → the organizer signs, which ends the session.

| Guard | Where |
|-------|-------|
| Ties broken before anyone signs | **S** `signOff`, `setSessionState` |
| Signatures voided by any score change | **D** `void_signatures*` triggers |
| Every judge signed before the end | **D** `check_deliberation` |
| The organizer's signature taken back if the end doesn't happen | **S** removes only the row its own request wrote |

## 5. Judge device

**Lives in:** `judge_devices.status`.

**States:**
- **pending:** signed in with the code and waiting.
- **approved:** the one device that scores.
- **revoked:** signed out, turned away or replaced. It's final.
- **gone:** the row is deleted by a reset or an archive.

| Move | Where | Guards |
|------|-------|--------|
| → pending | `devices.ts` on sign-in | rate-limited |
| pending → approved | `approveDevice` | **S** `canApprove`: only a waiting device, and only while it's still waiting. **D** one approved device per judge (unique index) |
| → revoked | `revokeDevice`, the judge signing out, a newer approval | |
| → gone | `resetScores` (after the move to draft), `archiveActivity`, `sign_out_on_archive` | |

## 6. Score correction

**Lives in:** `score_corrections.status`.

**States:**
- open
- approved
- rejected
- withdrawn

**Settled** only through `settle_score_correction` (**D**, open rows only).

**Votes:** each vote settles from the votes read after it went in, so two last votes at once still settle it. One open correction per score (**D**).

**Gaps:**
- Opening a correction while live or deliberating is checked by the server only.
- A pageant cut can't be confirmed while a correction is open (**S**).

## 7. Scoring window and timer

**Lives in:** `scoring_closes_at`, `current_entry_id`, `previous_entry_id`, `entry_shown_at`.

**Phases** (`timerPhase`):
- open
- closing
- closed

**Guards:**
- **S** `submitScore` with `scoreWindowOpen`, `SUBMIT_GRACE_MS`.
- **D** `check_score` (only while live).
- A score sent again after it was saved counts as saved even if the window has closed since.

## 8. Pageant rounds and cuts

**Lives in:** `current_round_id`, `rounds.cut_entry_ids` (null means the cut isn't confirmed).

**Moves:**
- `setCurrentRound`;
- `confirmCut`, which writes only while unconfirmed and not while a correction is open;
- `undoCut`.

**Gap:** these have no database guards; the server's checks are the only ones.

## 9. Judge screen

**Lives in:** the browser, from `judgeView` in `judging.ts`.

**Layers:**
- the device gate;
- not started, waiting, scoring, scored, deliberation, ended;
- the undo window, then sending, then saved or failed;
- the timer phase;
- the privacy screen.

The undo window exists only on the screen. The server allows for it with `LATE_SCORE_MS`.

## 10. Judges' calls for help

**Lives in:** `assistance_requests.answered_at` and `cancelled_at`.

**States:**
- open
- answered
- cancelled

A call is answered only while it's open, never once cancelled. One open call per judge (**D**).

## 11. Admin session

**Lives in:** `admin_sessions` rows and a signed cookie.

**States:**
- open
- due for renewal (renewed by `renewAdminSession` while the panel is open)
- ended or expired

**Signing out** isn't allowed while an activity is running or has judges waiting (`accountInUse`).

**Trade-off:** a database error while checking the session lets it through, so a blip doesn't sign the desk out mid-show.

## 12. Create-form drafts

**Lives in:** `activity_drafts.updated_at`.

**States:**
- unsaved
- saved, with a version
- conflict: changed in another window
- claimed by Create
- created, or restored if Create fails
- gone

The forms read **"gone"** from the result's `code: "draft-gone"`, not from its wording.

## 13. LED wall

**Lives in:** `led_entry_id`, which follows the entry shown and is cleared when the deliberation starts or the scores are reset.

**Derived states** (`led.ts`):
- each judge's tile is waiting, submitted or shown;
- the average is none, hidden, running or final.

**Wall:** only where `hasLedWall`.
