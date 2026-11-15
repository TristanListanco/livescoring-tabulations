# Security

How Tabulous protects its admin panel (organizers and the super admin), the judges' screens and the public boards, mapped to the [OWASP Top 10 (2021)](https://owasp.org/Top10/) and, for the judges' phones and tablets, the [OWASP MASVS](https://mas.owasp.org/MASVS/). Each control names where it lives, so a change can keep it.

## Who can do what

| Who | Signs in with | Can reach |
|-----|---------------|-----------|
| Super admin | `ADMIN_PASSWORD` (env), compared in constant time | Organizer accounts; activities no organizer owns |
| Organizer | Email and password (scrypt) | Their own activities only (`canManageActivity`) |
| Judge | A 6-character code, then the organizer approves the device | Their own seat: the entry on screen, their own scores, corrections and notes (`seat()` in `src/app/judge/actions.ts`) |
| Audience | Nothing | An activity's public link (`/live`, `/led`): what's released, nothing more |

## OWASP Top 10

| Risk | Controls |
|------|----------|
| **A01 Broken access control** | Every server action and route checks the session first (`manage`, `managedPageant`, `requireAdmin`, `requireSuperAdmin`, judges' `seat`), then ownership; pages check again rather than trusting the proxy's redirect. Row level security is on for every table and the publishable key reads only `activity_changes` (confirmed on live). The functions callable through the API are revoked from `anon` and `authenticated`. Judges act only as the judge their signed cookie names, on their own approved device. |
| **A02 Cryptographic failures** | HTTPS with HSTS (two years). Cookies are signed (HMAC-SHA256), `httpOnly`, `SameSite=Lax`, `Secure` over HTTPS. Passwords: scrypt N = 2^17, r = 8, p = 1, random salt, constant-time compare; older hashes are upgraded at sign-in. Judges' codes sealed at rest: HMAC-SHA256 lookup + AES-256-GCM bound to the judge, keys from `DATA_KEY` (`src/lib/code-vault.ts`, migration 044). Codes, ids and pairing codes come from `crypto.randomInt`/`randomUUID`. Sign-in limit keys (addresses, emails) are stored as HMACs. |
| **A03 Injection** | The database is reached only through supabase-js (PostgREST, parameters URL-encoded) and three SQL functions with typed parameters; no filter string is built from input. React escapes everything it renders; the only raw HTML is a QR code's SVG drawn by the library. CSV cells a spreadsheet would run as formulas are written as text. Logs are JSON lines. |
| **A04 Insecure design** | State machines with a guard in the server action and again in a database trigger (`docs/state-machines.md`): scores only while judging is live, final once submitted, corrections by rule, the panel and rules locked once judging starts. Withdrawn entries are refused new scores by the database. |
| **A05 Security misconfiguration** | Content Security Policy with a per-request nonce and `strict-dynamic` (`src/proxy.ts`), `frame-ancestors 'none'`/`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, HSTS (`next.config.ts`). No `X-Powered-By`. No browser source maps in production. Test tools (reset, delete mid-session) are off in production builds. |
| **A06 Vulnerable components** | `npm audit` in review; Next.js kept on patched releases (16.4.6 fixes the image optimizer and Server Actions advisories). New packages are pinned to releases at least two weeks old. Known: the lint tooling's `minimatch` advisory (dev only, never shipped). |
| **A07 Identification and authentication failures** | Sign-in limits per network address and per account (`src/lib/sign-in-limits.ts`); Vercel BotID on both sign-ins in Vercel builds (`src/lib/bot-check.ts`); a decoy hash so a missing account takes as long as a wrong password. Admin sessions are rows that can be ended (sign out, password change, account deletion) and expire after 12 hours; judge devices need the organizer's approval and are signed out when another is approved or the activity is archived. Destructive actions ask for the password again, counted against its own limit. |
| **A08 Software and data integrity failures** | Score sheets and results carry a report ID that changes with any score; CSVs carry a SHA-256 fingerprint of their rows. Migrations reach the live database only through the release pipeline with the owner's approval. Uploads are typed by their bytes, not the browser's word. |
| **A09 Logging and monitoring failures** | Every action is logged with its outcome, timing and request id (`src/lib/observe.ts`); refused sign-ins, bot refusals, tally openings, needed migrations and screens' own problems (`/client-events`, rate-limited) go to the log. Secrets and codes never do. |
| **A10 Server-side request forgery** | The server fetches only Supabase and Vercel's BotID service, at fixed addresses; no URL comes from input. |

## Input

Every server action treats its arguments as untrusted: ids must be UUIDs, names and reasons are trimmed and capped, scores are parsed against the rules on the server (and the database checks range and decimal places again), JSON from the setup forms is parsed and checked field by field (`checkPageant`, `checkScoring`), and drafts are capped in size. No action writes a client's object to the database as it is: each builds its own columns. Uploads: JPEG, PNG or WebP by their first bytes, at most 2 MB, stored under names the server makes, in buckets that refuse anything else (migration 037).

## Responses

The public pages carry only what they show: judges' first names and a last initial (none when anonymous), no scores until they're released, no deductions, no withdrawal reasons, no owner. The desk and judges get only what their role sees; the private tally, behind the password, is the only page with scores before release. Database errors go to the log; screens get a plain sentence.

## Pagination and idempotency

- Lists that grow are paged or capped: an organizer's activities (50 at a time), scores read in pages, judges' calls for help and waiting devices (capped), alert ids (100). Everything else is bounded by one activity's size.
- A repeated request does nothing twice: a new activity takes the form's request id as its own; a score sent again is recognised as the same one (one per judge, entry and sub-activity, enforced by unique indexes); deductions carry their own id; confirming a cut, approving a device, withdrawing or reinstating an entry, signing and ending all check the state they were decided on and change nothing the second time.

## MASVS (judges' phones and tablets)

Judges use the web app in a browser, so the platform items (WebViews, IPC, binary protections) don't apply. What does:

| Category | How it's met |
|----------|--------------|
| **STORAGE** | Nothing sensitive on the device: the session is an `httpOnly` cookie scripts can't read; `localStorage`/`sessionStorage` hold only display preferences and whether a prompt was seen. Scores, notes and signatures live on the server. |
| **CRYPTO** | Platform TLS; signing and hashing on the server (see A02). |
| **AUTH** | A code, then the organizer's approval of the device; one approved device per judge; sessions ended from the panel. |
| **NETWORK** | HTTPS with HSTS; the CSP lets a page talk only to this site and the Supabase project. |
| **PLATFORM** | No other site can frame the screens; the privacy screen hides scores when a device is tilted away. |
| **CODE** | Dependencies scanned and patched; every input checked on the server. |
| **RESILIENCE** | BotID on sign-in; the server decides everything, so a tampered page can't score for another judge or outside the rules. |
| **PRIVACY** | Judges' and entries' details are shown only where needed; withdrawal reasons and deductions stay with the organizer; consent is confirmed when people are named. |

## Running it safely

- Set `SESSION_SECRET`, `ADMIN_PASSWORD` and `DATA_KEY` per environment (Production apart from Preview; Preview and `.env.local` share the testing database, so they share a `DATA_KEY`). Never change `DATA_KEY` once codes are sealed with it.
- The live database changes only through the release pipeline, approved in the `live` GitHub environment.
- BotID works on Vercel builds; Deep Analysis can be turned on in the Vercel project's Firewall settings.
- On a laptop at the venue (`npm start`) there's no platform in front: put it behind nginx as the README describes so the per-address limits see real addresses.

## Known and accepted

- The publishable key can read `activity_changes` (activity ids and when they last changed, never what), which live updates need.
- Judges' codes kept in the clear before `DATA_KEY` was set are sealed when their activity's codes are next read, not all at once.
- The lint tooling's `minimatch` advisory, until a fix that doesn't mean going back to Next.js 15's lint config.
