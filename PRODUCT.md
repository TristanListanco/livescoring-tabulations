# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Organizers (primary):** event and production companies that run pageants and judged competitions for their clients. They set up an activity, run the judging session from a laptop at the control desk while the show is live, and hand the client signed official results. They do not sign up themselves: the super admin creates each organizer account.
- **Judges:** the invited panel. They are often not technical and have never seen the product before. Each one scores from their own phone or tablet, in a single sitting, while the show runs. One judge is the chair of the board of judges and can move to the previous or next entry from their own screen.
- **Audience:** people at the venue, or watching a broadcast, who follow the scores on the projected live results page, on their own phones, or on the LED wall and broadcast lower third.
- **Board of Tabulators and signatories:** the people who sign the results PDF. Their names and designations print as signature lines.
- **Super admin:** the developer. They create, edit and delete organizer accounts, can see every activity, and can hand an activity to an organizer.

## Product Purpose

LiveScoring is the tabulation for a judged event. Judges score each entry from their own devices. Averages and rankings update the moment a score comes in, on the live results page and the LED wall. When judging ends, the organizer downloads an official results PDF that cannot be quietly changed. Success means a whole event runs with no paper scoresheets and no spreadsheet tally. Judges and organizers get through it without training, the audience sees the scores as they happen, and nobody can dispute the final results.

## Positioning

At most events today, judges fill in paper sheets and tabulators add them up in Excel. LiveScoring replaces both with one system, where every score is:

- **Final and traceable:** a submitted score can't be changed, and the database rejects any attempt. Only an approved device per judge can score. The PDF's report ID changes if any score changes, and each judge's sign-off is recorded (Sgd.).
- **On screen instantly:** the same score reaches the live results page, the LED wall and the broadcast lower third the moment the judge submits it.
- **Usable cold:** judges and organizers who have never used it can run an event with no training.

The selling point is all three together, integrity and broadcast-speed output, in a tool non-technical people can use under show pressure.

## Operating Context

- **Before the show:** the organizer creates the activity: name, score range and decimal places, simple or criteria scoring (criteria add up to 100), the judges with photos, the chair, and the entries in running order. A pageant is set up step by step instead: the candidates first, then the judges, then the program (see Pageant mode). Resetting scores after a rehearsal is a developer tool. It is hidden and refused on the production Vercel site, so organizers there can't reset an activity.
- **Device pairing:** each judge enters a six-character code or scans a QR code. Their device shows a pairing code, which the organizer approves in the Access tab.
- **During the show:** the organizer runs the Session tab as the control desk. They start the session, which locks the judges and the running order, show one entry at a time, watch who has scored, and end the session (ending asks for the organizer's password). Judges see only the entry on screen and type their score on a large keypad.
- **Venue screen:** the live results page (`/live/<id>`) is projected or shared with the audience. With ranks on, entries are sorted and the top 3 stand out. With ranks off, entries stay in running order.
- **LED wall and broadcast:** the LED page (`/led/<id>`) runs full screen on the computer that feeds the wall or video switcher. It shows either a lower third on chroma green `#00FF00`, keyed over the camera shot, or a full-screen scoresheet. The wall follows the entry being judged. The organizer picks the display, the animation, and whether scores wait for every judge from the LED wall tab.
- **Pageant mode:** a pageant has a preliminary segment and a pageant proper segment, each with a share of the overall score set by the organizer. Each segment has sub-activities with a share of the segment and their own simple or criteria scoring. Cuts after pageant proper sub-activities (Top 10, Top 5) narrow the field, ranked by the sub-activities the organizer ticks for each one; the last sub-activity ends with the final cut, whose order is the final placement. The organizer judges one sub-activity at a time from the Session tab, breaks ties on a cut's line (and for a final placement) by choosing, and confirms each cut. A sub-activity can have a scoring timer: green while judges can score, yellow as it closes, red once it has, when the server refuses scores until the organizer gives more time. Every sub-activity, cut, the final results and the preliminary standings have their own PDF.
- **After the show:** once every judge has scored every entry, the organizer downloads the results PDF. It carries the report ID, the judges' sign-offs, the organizer's photo, and the signatories' signature lines.
- **Environment:** a live event venue, with judges' phones and tablets on the venue Wi-Fi. The app runs either as a production build on the organizer's laptop or as a Vercel deployment. Either way it needs to reach the Supabase project.

## Capabilities and Constraints

- **Built on:** Next.js 16 (App Router), Supabase (Postgres, Realtime, Storage) and Tailwind CSS 4. All writes go through Server Actions. The browser holds only the publishable key.
- **Accounts:** organizers see only their own activities. Organizer passwords need at least 8 characters, a number and a special character. Judges' first and last names are letters (with the spaces, hyphens, apostrophes and periods names carry). Organizer accounts and judge access codes sit in tables with no public access.
- **Live updates:** live pages update on Realtime events, poll every 15 seconds as a fallback, and refresh when the tab regains focus.
- **Rankings:** rankings use the average of the scores submitted so far, rounded to two decimals. Equal averages share a rank.
- **Criteria totals:** shown as a percentage or scaled to 10 on the live results, LED wall and PDF.
- **Fixed requirement:** the LED lower third's chroma green is there so the switcher can key it out. It is not a styling choice. The lower third is one slim bar along the bottom, so the camera keeps most of the frame.
- **Admin themes:** the admin panel has light and dark themes. The judge screens, the live results page and the LED wall keep their own fixed appearance.
- **Terms:** activity, event, pageant, entry (a pageant's candidate), running order, segment (preliminary, pageant proper), sub-activity, share, cut, final cut, scoring timer, judge, chair (of the board of judges), organizer, super admin, session (not started, live, ended), access code, pairing code, judge device, simple and criteria scoring, live results, LED wall, lower third, scoresheet, signatories, Board of Tabulators, report ID, Sgd.
- **Undecided or unrecorded:** the business model, pricing, and how event companies find and join LiveScoring. Future work must not invent them.

## Brand Commitments

- **Name:** LiveScoring, used throughout the product and the repository.
- **Voice in the shipped copy:** plain, short and direct, written for people under time pressure. Examples: "I'm a judge", "Show it below when the contestant is ready."

## Evidence on Hand

- **Real-world use:** none yet. LiveScoring has only been used in rehearsals and has not scored a real event. Nothing may claim real events, clients, testimonials, usage numbers or reliability records.
- **Test suite:** the Playwright tests in `e2e/` walk through a whole event. They cover creating an activity with a judge photo, judges scoring on a phone and a tablet, the live board updating in real time, hiding ranks, the PDF export, the LED wall, and resetting and deleting. A pageant run covers the step-by-step setup, cuts with an organizer-broken tie, the scoring timer, and the pageant's results PDFs. They also check sign-in guards and scan key pages for WCAG 2.1 AA issues.
- **Logo:** there is no logo or brand asset beyond `src/app/favicon.ico`.

## Product Principles

1. **Integrity first.** A submitted score is final, and every published number traces back to a judge's approved device. No convenience feature may weaken that.
2. **No training needed.** A first-time judge holding their own phone, or an organizer at the control desk mid-show, should always see the next action without being told.
3. **The organizer runs the show.** The organizer, and the chair from their own screen, decide what is on. Judges see only the entry in front of them, and the audience sees only what has been submitted.
4. **Every output is public.** The live results page, the LED wall and the PDF are seen by an audience, keyed into a broadcast, or signed as the official record. They have to hold up projected, on air and in print.

## Accessibility & Inclusion

The target is WCAG 2.1 AA. Axe runs in the Playwright suite to check it. Judges score on small phone screens under venue lighting, often without having used the product before, so the controls they rely on must stay large, high-contrast and easy to understand.
