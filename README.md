# LiveScoring

Web tabulation for judged competitions. An admin sets up an activity, judges score entries from their own devices, and a public page shows every judge's score and the average, ranked live.

- **Admin panel** (`/admin`): create activities with a name, a score range (min to max), decimal places (whole numbers, 1 or 2 decimals), judges with names and photos, and entries. Each activity has tabs for access codes, judges, entries, live results, settings and developer tools (reset scores, delete activity). In **Settings** you can hide or show ranks on the public page, and download the official results as a PDF once every judge has scored every entry.
- **Judge portal** (`/judge`): a judge enters their six-character code, or scans their QR code, to sign that device in. They pick an entry, type the score on a large keypad and submit it. Submitted scores are final.
- **Live results** (`/live/<id>`): every judge's score and the average for each entry, updated in real time and made to be projected. With ranks on, entries are sorted by average and the top 3 stand out; with ranks off, entries stay in running order.
- **LED wall** (`/led/<id>`): a broadcast-style lower third for one entry on a chroma green (`#00FF00`) background, for the LED wall or a video switcher to key over the camera shot. Each judge's score appears as it is submitted, and the average turns final when every judge has scored. The admin picks the entry in the **LED wall** tab.

Built with Next.js 16, Supabase (Postgres, Realtime and Storage) and Tailwind CSS 4.

## Setup

1. **Create a Supabase project** at [supabase.com](https://supabase.com).
2. **Create the database.** In the Supabase dashboard open **SQL Editor**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql) and run it. It creates the tables, the score rules, public read access, realtime and the `judge-photos` storage bucket. Running it again is safe.

   If you set up the database before the "show ranks" setting and the LED wall existed, also run [`supabase/migrations/003_led_wall.sql`](supabase/migrations/003_led_wall.sql). It brings any older database up to date.
3. **Configure the app.** Copy `.env.example` to `.env.local` and fill it in. The Supabase values are under **Project Settings > API Keys**. Keep real values out of `.env.example`, because that file is committed.
4. **Run it.**

   ```bash
   npm install
   npm run dev
   ```

   Open http://localhost:3000/admin and sign in with `ADMIN_PASSWORD`.

## Running an event

1. Create the activity in the admin panel. You land on the **Access** tab.
2. Give each judge their code, or have them scan their QR code. Judges can also open `/judge` and type the code.
3. Open the public results link on the venue screen, or share it with the audience.
4. For the LED wall, open the LED wall link full screen on the computer that feeds the wall or video switcher, and key out the green. Pick the entry on air from the **LED wall** tab: **Next** steps through the running order, **Clear screen** leaves only green.
5. Use **Developer > Reset scores** after a rehearsal to start clean.

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
- Sessions are signed, http-only cookies (`SESSION_SECRET`). Admin sessions last 12 hours and judge sessions 3 days.
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
