# State machines

Tabulous runs on a handful of state machines. Most aren't one declared table: a state lives in a column (or a few), and its moves are checked in a server action, held again by a database trigger, and shown by the panel. This page lists each one, where it lives, what moves it, and which layer guards each move, so a change to one can be made in every place it's checked.

**Where the rules live in code:**
- **`src/lib/lifecycle.ts`:** the activity's phases, the moves between them (`SESSION_MOVES`, `canMove`), a pageant's segments (`segmentPhase`, `runningSegment`, `canMoveSegment`), what can still change in each phase (`editable`), and the mode helpers (`scoresGoOutLive`, `hasLedWall`). It's pure and tested (`lifecycle.test.ts`). Server actions check moves there before writing, and the panel asks there what to offer.
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
| start | setup, setup-after-reset | `setSessionState(…, "live")` | **S** needs judges, entries, a chair without live scoring, and for a pageant the preliminary's board (judges and chair). A pageant's start is its preliminary's. **U** |
| deliberate | live | `beginDeliberation` (desk, or the chair's `startDeliberation`) | **S** `deliberationGap`. **D** `check_deliberation` (every score in), `check_entry_added` |
| end | live, deliberation | `setSessionState(…, "ended")`, and `endWhenEveryScoreIsIn` with live scoring | **S** needs the password; a deliberation also needs every signature, no unbroken tie and the organizer's signature; a pageant needs pageant proper running and its deliberated sub-activities signed off. **D** `check_deliberation` (signatures and sign-off) |
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
| judges | setup; a pageant's pageant proper judges until pageant proper starts | **D** `judges_locked` (insert and delete; migrations 039 and 040) and `set_judge_chair`. Renames, photos and boards are **S** only; moving a judge between boards stays locked once the preliminary starts. |
| rules (live scoring, timer, own pace, decimal places) | setup | **S**; writes are conditional on still being draft |
| running order, program, guides | setup, setup-after-reset; a pageant's pageant proper sub-activities until pageant proper starts | **D** `set_entry_order` for the order. `savePageant` keeps the preliminary's part as saved once it has started. |
| entries | until ended | Each action has finer rules: no adding in deliberation, and nothing scored or on screen can be removed |
| judges' options (reasons list, see ranking) | until ended | |

Pass the segment (`editable(activity, part, "proper")`) for a pageant's pageant proper judges and program.

## 3. Activity mode

**Lives in:** `kind` × `live_scoring` × `independent_scoring`.

**Modes:**
- a live event: scores show as they come in;
- a deliberated event: scores stay with the judges until everyone has signed;
- an own-pace event: a deliberated event where judges pick entries themselves;
- a pageant, whose scores go out live, except a sub-activity set to deliberate (see section 15).

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
- `setCurrentRound`: only a sub-activity of the segment running now (`segmentClosed`), any of them, a judged one again too; not while another is being deliberated; written only while the segments stand as read;
- `confirmCut`, which writes only while unconfirmed, not while a correction is open, and not before every deliberated sub-activity it counts is signed off (`CutPlan.awaiting`);
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

The undo window exists only on the screen, and only where scores don't go out as they come in (not an event with live scoring, nor a pageant sub-activity whose results are live). The server allows for it with `SUBMIT_GRACE_MS`.

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

## 14. Pageant segments

**Lives in:** `session_started_at` (the preliminary's start), `activities.preliminary_ended_at`, `activities.proper_started_at` (migration 040), and `session_state` (pageant proper ends with the session). `segmentPhase()` names each segment's phase: setup, live, ended.

| Move | From | Triggered by | Guards |
|------|------|--------------|--------|
| start preliminary | setup | the session's start | as start, above |
| end preliminary | preliminary live | `moveSegment(…, "endPreliminary")` | **S** the password, every preliminary score in, its deliberated sub-activities signed off; writes only while the segments stand as read. **D** `check_score` refuses new preliminary scores after it |
| reopen preliminary | between the two | `moveSegment(…, "reopenPreliminary")` | **S** only until pageant proper starts |
| start pageant proper | between the two | `moveSegment(…, "startProper")` | **S** pageant proper's board (three judges, a chair). **D** `check_score` refuses pageant proper scores before it |
| end pageant proper | pageant proper live | the session's end | as end, above |

**Judges' screens:** a judge of the preliminary only reads "Your part of the pageant is done" once it has ended; one of pageant proper (only, or of both between the segments) reads "Pageant proper starts soon".

**Deductions** stay open through the break after the preliminary, when they're usually tallied (the desk shows them there), and close when pageant proper starts (`deductionsOpen`).

**Reset** (`resetScores`, `canReset`): both segments (back to not started, as any activity), the preliminary alone until pageant proper starts (it opens again from the start; its deductions and any confirmed cut go), or pageant proper alone once it has started (back to not started, its cuts open again; an ended pageant is live again, between the segments). Judges stay signed in for a segment's reset.

## 15. Deliberation per sub-activity

**Lives in:** `rounds.live_scoring` (false: results after a deliberation; a part follows its sub-activity), `rounds.deliberation_started_at`, `round_signatures`, `round_signoffs` (migration 040). Each part deliberates on its own.

**Steps:** judged as usual (the audience sees a tick per score, `loadPublicBoard` holds its values) → every score in → the desk starts its deliberation (`startRoundDeliberation`) → its judges review, correct their own with a reason (applied at once) and sign (`signOff` → `signRound`) → the organizer signs it off with their password (`signOffRound`), and its scores go out.

| Guard | Where |
|-------|-------|
| One deliberation at a time; the desk can't switch sub-activity or show a candidate meanwhile | **S** `roundDeliberationGap`, `setCurrentRound`, `showColumns` |
| Signatures and sign-off voided by any score change in it | **D** `void_round_signatures` |
| Cuts, the preliminary's end and the pageant's end wait for its sign-off | **S** `awaitingSignoff` |
| Its results PDF waits for its sign-off and prints its judges' signatures | **S** `exports.ts` |

**Gap:** no tie-break step: a cut has the organizer break ties at the line.
