import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Cookie policy",
  description: "The cookies Tabulous sets, what each one does and how long it lasts, and what else your browser keeps for it.",
};

/**
 * The cookie policy. Like the privacy policy, every statement here describes what the app does: change it together with
 * the cookies and the browser storage it lists (session.ts, tally-access.ts, theme.ts, and the keys named below).
 */
export default function CookiePolicy() {
  const mail = <a href={`mailto:${LEGAL.contact}`}>{LEGAL.contact}</a>;
  return (
    <article>
      <h1 className="title">Cookie policy</h1>
      <p className="hint mt-2">Effective {LEGAL.effective}</p>

      <p>
        A cookie is a small piece of information a website asks your browser to keep and send back. Tabulous uses only its own cookies,
        and only to do what you ask of it: keep you signed in, and remember a setting you chose. There are no analytics, advertising or
        third-party cookies, and nothing that follows you to other websites.
      </p>

      <h2>The cookies Tabulous sets</h2>
      <ul>
        <li>
          <code>ls_admin</code> keeps an organizer signed in, for 12 hours.
        </li>
        <li>
          <code>ls_judge</code> keeps a judge’s approved device signed in, for 3 days.
        </li>
        <li>
          <code>ls_tally</code> keeps an activity’s private tally open for 10 minutes after the organizer enters their password, on that
          tally’s page only.
        </li>
        <li>
          <code>ls_theme</code> remembers the light or dark theme the organizer picked for their panel, for a year.
        </li>
        <li>
          <code>ls_sidebar</code> remembers whether the organizer collapsed the panel’s sidebar, for a year.
        </li>
      </ul>
      <p>
        The sign-in cookies can’t be read by scripts on the page. The live results page and the LED wall need no account and set no
        cookies.
      </p>

      <h2>What else your browser keeps</h2>
      <p>
        Some settings are kept in your browser’s own storage rather than in cookies, and are never sent to us: whether a judge’s notes
        panel is open or minimized, that a judge’s device has asked for help before (so Assist me asks once, then calls straight away),
        whether an organizer has answered the offer of alerts for judges’ calls for help, and that you’ve seen the notice about cookies. For one browser tab only, it also keeps the LED wall’s display and when a page last reloaded
        itself after an update.
      </p>

      <h2>Why we don’t ask first</h2>
      <p>
        Each of these is needed for something you asked Tabulous to do, so they’re set without asking. Your browser’s settings can clear
        or block them at any time. Without the sign-in cookies you can’t sign in; without the others, the panel forgets your choices.
      </p>

      <h2>Changes and questions</h2>
      <p>
        We’ll post any change here with a new effective date. Questions go to {mail}. Our{" "}
        <Link href="/privacy" replace>
          privacy policy
        </Link>{" "}
        covers the rest of how Tabulous handles personal information.
      </p>
    </article>
  );
}
