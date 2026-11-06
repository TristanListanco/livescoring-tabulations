import { LegalDialog } from "@/components/legal-dialog";
import TermsOfService from "../../(legal)/terms/page";

/** The terms of service opened from a link in the app: over the page it was opened from, rather than in its place. */
export default function TermsDialog() {
  return (
    <LegalDialog label="Terms of service">
      <TermsOfService />
    </LegalDialog>
  );
}
