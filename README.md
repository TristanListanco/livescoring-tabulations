# LiveScoring

Web tabulation for judged competitions. An admin sets up an activity, judges score entries from their own devices, and a public page shows every judge's score and the average, ranked live.

- **Admin panel** (`/admin`): create activities with a name, a score range (min to max), decimal places (whole numbers, 1 or 2 decimals), judges with names and photos, and entries. Each activity's tabs follow the event day: **Session** (the control desk), **Judge devices** (codes, QR codes and device approval) and **LED wall** for running the show; **Judges**, **Entries** and **Settings** (name, organizer, delete) for setting it up; and **Developer** tools (reset scores) everywhere but the live site. On the **Session** tab you can hide or show ranks on the public page, and download the official results as a PDF once every judge has scored every entry. The PDF carries a report ID that changes if any score changes, marks each judge's sign-off (Sgd.), and prints the organizer's photo and their signatories (for example the Board of Tabulators) with designations.
- **Accounts**: the super admin (the developer, using `ADMIN_PASSWORD`) creates, edits and deletes **organizer** accounts with an email, password, organizer name and photo. Organizers sign in with their email and see only their own activities; their name and photo show in the admin header. The super admin sees every activity and can hand one to an organizer from its Settings tab. Deleting an organizer keeps their activities for the super admin.
- **Judge portal** (`/judge`): a judge enters their six-character code, or scans their QR code, to sign that device in. The device shows a pairing code and waits until the organizer approves it on the Judge devices tab, or from that judge's tile on the Session tab; only one approved device per judge can score, so a stray device that scanned the QR can't. Their screen then waits until the organizer starts the session, then shows the entry the organizer picks. They type the score on a large keypad and submit it, then wait for the next entry. Submitted scores are final.
- **Scoring modes**: simple (one score from a min to a max) or criteria (points for each criterion, adding up to 100, entered on the same keypad). Criteria totals show on the live results, LED wall and PDF as a percentage or scaled to 10.
- **Judging session** (Session tab): before judging, the desk shows which judges have an approved device. The organizer starts and ends judging and shows judges one entry at a time, watching who is still scoring and whether the desk's connection is live. Starting locks the judges and the running order; entries can still be added and renamed. Judges can only score the entry on screen while the session is live. Once the session ends, the desk shows the report ID and the results PDF.
- **Live results** (`/live/<id>`): every judge's score and the average for each entry, updated in real time and made to be projected. With ranks on, entries are sorted by average and the top 3 stand out; with ranks off, entries stay in running order.
- **LED wall** (`/led/<id>`): one entry's scores for the LED wall or video switcher, either as a lower third on chroma green (`#00FF00`) to key over the camera shot, or as a full-screen scoresheet. Scores fade in as judges submit them, or, with **Show scores only when every judge has scored**, all at once when the last judge is in. With **Keep judges anonymous**, each judge's name and photo on the wall becomes a "?". The wall follows the entry being judged; the admin picks the display and animation in the **LED wall** tab.

Built with Next.js 16, Supabase (Postgres, Realtime and Storage) and Tailwind CSS 4.

## Setup

1. **Create a Supabase project** at [supabase.com](https://supabase.com).
2. **Create the database.** In the Supabase dashboard open **SQL Editor**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql) and run it. It creates the tables, the score rules, public read access, realtime and the `judge-photos` storage bucket. Running it again is safe.

   Databases set up before a feature existed need the migrations in [`supabase/migrations/`](supabase/migrations/), in order: `003_led_wall.sql` (also covers 002) for show ranks and the LED wall, then `004_organizer_accounts.sql` for organizer accounts and the LED display settings, then `005_judging_session.sql` for judging sessions, then `006_devices_criteria_signatories.sql` for judge device approval, criteria scoring and PDF signatories, then `007_entry_photos_result_decimals.sql` for entry photos and result decimals, then `008_judge_names_and_chair.sql` for judges' first and last names and the chair, then `009_led_transition.sql` for the LED wall's wipe animation, then `010_led_anonymous_judges.sql` for keeping judges anonymous on the LED wall. Each only adds tables and columns, so a deployed older version keeps working after you run it.
3. **Configure the app.** Copy `.env.example` to `.env.local` and fill it in. The Supabase values are under **Project Settings > API Keys**. Keep real values out of `.env.example`, because that file is committed.
4. **Run it.**

   ```bash
   npm install
   npm run dev
   ```

   Open http://localhost:3000/admin/login?as=super and sign in with `ADMIN_PASSWORD` as the super admin. Create organizer accounts on the **Organizers** page.

## Running an event

1. Create the activity in the admin panel. You land on the **Judge devices** tab.
2. Give each judge their code, or have them scan their QR code. Judges can also open `/judge` and type the code. Each device shows a pairing code: approve the matching one on the **Judge devices** tab, or from the judge's tile on the **Session** tab.
3. Open the public results link on the venue screen, or share it with the audience.
4. In the **Session** tab, start the session, then show each entry in turn. When every judge has scored, show the next one. End the session after the last entry.
5. For the LED wall, open the LED wall link full screen on the computer that feeds the wall or video switcher, and key out the green. The wall shows the entry being judged on the **Session** tab; choose the display and animation in the **LED wall** tab.
6. Use **Developer > Reset scores** after a rehearsal to start clean. It also puts the session back to not started. The Developer tab isn't on the live (production) site.
7. After the last entry, end the session. The Session tab then shows the report ID and **Download results PDF**.

### Running on a laptop over the venue Wi-Fi

Judges' phones and tablets must be on the same Wi-Fi as the laptop. For the event itself, use a production build; it is faster and more reliable than the dev server:

```bash
npm run build
npm start -- -H 0.0.0.0
```

The admin panel works at `http://localhost:3000/admin` on the laptop. Judge links, QR codes and the results link automatically use the laptop's Wi-Fi address (for example `http://192.168.1.16:3000`) so other devices can open them. Set `NEXT_PUBLIC_SITE_URL` to pin a specific address.

`npm run dev -- -H 0.0.0.0` also works for testing on phones; the dev server allows this laptop's network addresses.

## Deploying to Vercel

Import the repository in Vercel and add the same environment variables. Set `NEXT_PUBLIC_SITE_URL` to your production URL.

## How it works

- All writes go through Next.js Server Actions using the Supabase secret key. The browser only gets the publishable key, which can read the public tables for realtime but cannot write.
- Judge access codes live in a separate table with no public access.
- Database triggers check every score against the activity's range and decimal places, and reject any attempt to change a submitted score.
- Sessions are signed, http-only cookies (`SESSION_SECRET`). Admin sessions last 12 hours and judge sessions 3 days. Organizer passwords are hashed with scrypt; changing one signs that organizer out on other devices, and deleting an account ends its sessions.
- Organizer accounts and password hashes sit in a table with no public access. Every admin action checks that the signed-in organizer owns the activity it touches.
- Live pages refresh on Supabase Realtime events, poll every 15 seconds as a fallback, and refresh when the tab regains focus.
- Rankings use the average of the scores submitted so far, rounded to two decimals. Entries with equal averages share a rank.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm test` | Unit tests for keypad input, score validation, ranking and progress |
| `npm run test:e2e` | Web tests in a real browser (Playwright) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |

## Tests and CI

GitHub Actions runs on every pull request and every push to `main` (`.github/workflows/ci.yml`):

- **Lint, types and unit tests**: `npm run lint`, `npm run typecheck`, `npm test`.
- **Web tests**: starts a throwaway local Supabase on the runner, loads `supabase/schema.sql`, builds the app and runs the Playwright tests in `e2e/` against it. They walk through a whole event: creating an activity with a judge photo, judges scoring on a phone and a tablet, the live board updating in real time, hiding ranks, the PDF export, the LED wall, and resetting and deleting. They also check sign-in guards and scan key pages for WCAG 2.1 AA issues. The HTML report is attached to each run.

To run the web tests locally, start the app with `npm run dev` and run `E2E_PORT=3000 npm run test:e2e`. They use your `.env.local` project, create an activity named `E2E …` and delete it at the end.

## Fonts

The UI uses Avenir Next, which is built into Apple devices. Other devices fall back to Nunito Sans from Google Fonts. If you have an Avenir web-font license, add the files with `next/font/local` in `src/app/layout.tsx`.
