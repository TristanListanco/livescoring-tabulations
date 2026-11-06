import { LegalDialog } from "@/components/legal-dialog";
import CookiePolicy from "../../(legal)/cookies/page";

/** The cookie policy opened from a link in the app: over the page it was opened from, rather than in its place. */
export default function CookiesDialog() {
  return (
    <LegalDialog label="Cookie policy">
      <CookiePolicy />
    </LegalDialog>
  );
}
