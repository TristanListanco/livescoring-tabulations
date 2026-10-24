import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "The agreement for using Tabulous, as an organizer, a judge or someone watching the results.",
};

/**
 * The terms of service, under Philippine law. Nothing here sets a price or a plan: how organizers come to use Tabulous
 * isn't decided (see PRODUCT.md), so the terms stay silent on it.
 */
export default function TermsOfService() {
  const mail = <a href={`mailto:${LEGAL.contact}`}>{LEGAL.contact}</a>;
  return (
    <article>
      <h1 className="text-[clamp(2rem,5vw,2.75rem)] leading-tight font-bold tracking-tight">Terms of service</h1>
      <p className="hint mt-2">Effective {LEGAL.effective}</p>

      <p>
        These terms are an agreement between you and {LEGAL.operator} (“we”), who runs Tabulous. They apply whenever you use it: as an
        organizer, as a judge, or watching the results. By using Tabulous you agree to them. Our{" "}
        <Link href="/privacy">privacy policy</Link> says how we handle personal information.
      </p>

      <h2>What Tabulous does</h2>
      <p>
        Tabulous runs the scoring for judged events and pageants. Judges score from their own phones and tablets, results show on the live
        results page and the LED wall, and organizers download the official results as PDFs.
      </p>

      <h2>Accounts</h2>
      <ul>
        <li>
          We create organizer accounts; there’s no self sign-up. Keep your password to yourself. You’re responsible for what’s done with
          your account, so tell us at once if you think someone else has used it.
        </li>
        <li>
          Judges sign in with the code their organizer gives them, on a device the organizer approves. Don’t share your code: scores count
          only from your approved device.
        </li>
      </ul>

      <h2>If you’re an organizer</h2>
      <ul>
        <li>
          You decide what goes into your activities, so you must have the right to use it. Tell judges, contestants and signatories how their
          names, photos and scores will be shown (on the live results page, the LED wall, any broadcast, and the results PDFs), and get their
          consent where the law requires it. For anyone under 18, that means a parent’s or guardian’s consent.
        </li>
        <li>
          You run your event: its rules, its judges, and any dispute about its results. Tabulous records every score, correction and
          signature, but it doesn’t decide disputes.
        </li>
        <li>Check the results before you sign them or make them public, and keep the private tally private.</li>
        <li>
          When you run Tabulous on your own computer at a venue, you’re responsible for that computer and the network the judges use.
        </li>
      </ul>

      <h2>If you’re a judge</h2>
      <p>
        Score honestly, only from your approved device, and only the entry on your screen. Correct a score only for a true reason, and sign
        only once you’ve checked your scores.
      </p>

      <h2>What you mustn’t do</h2>
      <ul>
        <li>Get into, or try to get into, accounts, activities or information that aren’t yours, including by guessing codes or passwords.</li>
        <li>Interfere with Tabulous, overload it, or get around its limits or security.</li>
        <li>Upload anything unlawful, or anything you don’t have the right to use.</li>
        <li>Use Tabulous to mislead anyone about an event’s results.</li>
      </ul>

      <h2>Your content</h2>
      <p>
        What you put into Tabulous stays yours. You let us store, process and show it only as needed to run Tabulous for you: on the pages
        your activity publishes and in its PDFs. We may remove content that breaks these terms.
      </p>

      <h2>Availability</h2>
      <p>
        We work to keep Tabulous running, but we can’t promise it will never be interrupted or never make a mistake. An event also depends
        on things we don’t control, such as the venue’s Wi-Fi, the judges’ devices, and the services that host Tabulous. Plan for that:
        download your results PDFs after each event, and don’t rely on Tabulous as the only record. We may change Tabulous, or suspend or
        stop it.
      </p>

      <h2>Suspending and ending</h2>
      <p>
        We may suspend or delete an account that breaks these terms. An organizer can ask us to delete their account at any time; deleting
        it deletes all of their activities, as our privacy policy describes.
      </p>

      <h2>Liability</h2>
      <p>
        Tabulous is provided as it is. As far as the law allows, we aren’t liable for indirect or consequential losses, for decisions made
        about an event’s results, or for an event disrupted by an interruption. Nothing in these terms limits a liability that the law
        doesn’t allow to be limited.
      </p>

      <h2>The law that applies</h2>
      <p>These terms are governed by the laws of the Philippines, and disputes about them go to the proper courts of the Philippines.</p>

      <h2>Changes</h2>
      <p>
        We’ll post any change here with a new effective date, and tell organizers directly about significant ones. Using Tabulous after a
        change means you accept it.
      </p>

      <h2>Contact</h2>
      <p>
        {LEGAL.operator}, {mail}.
      </p>
    </article>
  );
}
