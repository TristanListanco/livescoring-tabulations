import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What personal information Tabulous handles, why, who sees it, how long it's kept, and your rights.",
};

/**
 * The privacy policy, under the Philippines' Data Privacy Act of 2012. Every statement here describes what the app does:
 * change it together with the code it describes (cookies, logs, what the public pages show, what deleting removes).
 */
export default function PrivacyPolicy() {
  const mail = <a href={`mailto:${LEGAL.contact}`}>{LEGAL.contact}</a>;
  return (
    <article>
      <h1 className="text-[clamp(2rem,5vw,2.75rem)] leading-tight font-bold tracking-tight">Privacy policy</h1>
      <p className="hint mt-2">Effective {LEGAL.effective}</p>

      <p>
        Tabulous is a tabulation service for judged events and pageants, run by {LEGAL.operator} (“we”). This policy says what personal
        information Tabulous handles, why, who can see it, how long it’s kept, and your rights under the Data Privacy Act of 2012 (Republic
        Act No. 10173).
      </p>

      <h2>Who is responsible for what</h2>
      <ul>
        <li>
          <strong>Organizer accounts.</strong> We decide how this information is used, so we’re its personal information controller.
        </li>
        <li>
          <strong>Everything in an activity.</strong> Judges, entries and candidates, scores, notes, signatures and signatories are put
          there by the activity’s organizer, who decides what’s collected and why. The organizer is the controller of that information, and
          we handle it for them as a personal information processor. Questions about an event are best sent to its organizer first; we’ll
          help them answer.
        </li>
      </ul>

      <h2>What we collect</h2>
      <h3>Organizers</h3>
      <p>
        We create organizer accounts; there’s no self sign-up. An account holds a name, an email address, a password (kept only as a
        scrypt hash, which can’t be turned back into the password) and an optional photo, which heads the organizer’s live results
        pages as their logo. For each browser signed in to the account, we keep a short device label (such as “iPhone · Safari”) and when
        it signed in, so the organizer can see and sign out their devices.
      </p>
      <h3>Judges</h3>
      <p>
        An organizer adds each judge’s first and last name, and optionally a photo. Each judge gets a six-character access code. For every
        device that signs in with the code, we keep a device label, a pairing code and whether the organizer approved it. Then we keep
        what the judge does: each score (and the points for each criterion), corrections and their reasons, notes on entries, the chair’s
        reasons for breaking ties, and the judge’s signature (drawn on a touchscreen, or “(Sgd.)”).
      </p>
      <h3>Entries and candidates</h3>
      <p>Names and optional photos, added by the organizer, with their scores and results.</p>
      <h3>Signatories</h3>
      <p>Names and designations an organizer adds to an activity, printed as signature lines on its results PDFs.</p>
      <h3>The audience</h3>
      <p>
        Nothing. The live results page and the LED wall need no account and set no cookies. To stay up to date, they connect directly to
        our database provider, Supabase, which sees the connection’s network address.
      </p>
      <h3>Everyone, for security</h3>
      <p>
        Failed sign-in attempts are recorded with the network address and, for organizer sign-in, the email address tried, to stop
        anyone guessing passwords or judge codes. Records older than a day are deleted. Our logs record which action ran, when, how long it
        took and whether it failed, with its error message (which can include a name, such as a judge who hasn’t signed yet). When a
        screen reports a problem, the log records the page and a device label. Logs never record passwords, judge codes or session
        cookies. Opening an activity’s private tally is logged with who opened it and on what kind of device.
      </p>

      <h2>How it’s used</h2>
      <ul>
        <li>To run the event: show each judge the entry to score, add up the scores, show results on the live results page and LED wall,
          and produce the results PDFs.</li>
        <li>To keep it secure: sign-in, approving judges’ devices, limiting sign-in attempts, and finding and fixing problems.</li>
      </ul>
      <p>
        We don’t sell personal information, use it for advertising, or profile anyone. Tabulous has no analytics or tracking. Its pages
        load only from Tabulous itself and from Supabase, for photos and live updates.
      </p>

      <h2>What’s public</h2>
      <ul>
        <li>
          An activity’s live results page and LED wall, to anyone with the link: the activity’s name, entries’ and candidates’ names and
          photos, scores and ranks, judges’ first names with a last initial and their photos (or just “Judge 1”, “Judge 2” when the
          organizer keeps judges anonymous), and the organizer’s logo. When an event doesn’t score live, its scores appear only once the
          judges have signed them.
        </li>
        <li>Photos are stored at web addresses that anyone who has the address can open.</li>
        <li>
          Results PDFs carry judges’ names and signatures, signatories, scores, corrections and their reasons, and how ties were broken.
          Organizers download them and may share them.
        </li>
      </ul>
      <p>Judges’ notes, access codes, the private tally and organizer accounts are never public.</p>

      <h2>Who it’s shared with</h2>
      <ul>
        <li>The activity’s organizer, who sees everything in their activity, including judges’ notes.</li>
        <li>
          The services that host Tabulous: Supabase (database, file storage and live updates) and Vercel (the website). They store and
          process data in South Korea (Seoul) on our behalf, under their own data protection terms.
        </li>
        <li>Authorities, when the law requires it.</li>
      </ul>
      <p>No one else.</p>

      <h2>Cookies and storage on your device</h2>
      <p>Tabulous uses only these cookies, all its own:</p>
      <ul>
        <li>
          <code>ls_admin</code> keeps an organizer signed in, for 12 hours.
        </li>
        <li>
          <code>ls_judge</code> keeps a judge’s device signed in, for 3 days.
        </li>
        <li>
          <code>ls_tally</code> keeps the private tally open for 10 minutes after the organizer’s password.
        </li>
        <li>
          <code>ls_theme</code> remembers the light or dark theme of the organizer’s panel, for a year.
        </li>
      </ul>
      <p>
        Your browser also remembers whether a judge’s notes panel is open, and for that tab only, the LED wall’s display and when a page
        last reloaded itself after an update. There are no analytics, advertising or third-party cookies.
      </p>

      <h2>How long it’s kept</h2>
      <ul>
        <li>
          An activity and everything in it stay until the organizer deletes the activity, archived or not. Deleting it removes its judges,
          entries, scores, notes, signatures and photos.
        </li>
        <li>Judges’ devices are signed out and deleted when the activity is archived.</li>
        <li>An organizer account stays until we delete it, which also deletes all of that organizer’s activities.</li>
        <li>An organizer’s sign-in lasts until they sign out, or 12 hours.</li>
        <li>Failed sign-in records: a day. Logs: as long as our hosting providers keep them.</li>
        <li>Results PDFs, once downloaded, are outside Tabulous: deleting the activity doesn’t delete copies.</li>
      </ul>

      <h2>Children</h2>
      <p>
        Competitions and pageants can include people under 18. An organizer must have a parent’s or guardian’s consent before adding a
        minor’s name or photo, or showing their scores.
      </p>

      <h2>Security</h2>
      <p>
        Passwords are hashed, sessions are signed cookies that scripts on the page can’t read, and only a device the organizer approved
        can score. Browsers never read results from the database directly: every request goes through our server, which checks who’s
        asking. The website is served over encrypted connections. When an organizer runs Tabulous on their own computer at a venue, the
        venue’s Wi-Fi isn’t encrypted by Tabulous, and that network is the organizer’s responsibility.
      </p>

      <h2>Your rights</h2>
      <p>
        Under the Data Privacy Act you have the right to be informed, to access your information, to object, to have it corrected, to have
        it erased or blocked, to data portability, to claim damages, and to file a complaint. To use any of them, email {mail}. For
        information in an event, you can also ask the event’s organizer. If you’re not satisfied with our answer, you can complain to the
        National Privacy Commission (<a href="https://privacy.gov.ph">privacy.gov.ph</a>).
      </p>

      <h2>Changes</h2>
      <p>
        We’ll post any change here with a new effective date, and tell organizers directly about significant ones. Our{" "}
        <Link href="/terms">terms of service</Link> cover the rest of using Tabulous.
      </p>

      <h2>Contact</h2>
      <p>
        {LEGAL.operator}, {mail}.
      </p>
    </article>
  );
}
