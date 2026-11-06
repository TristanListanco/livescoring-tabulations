import { LegalDialog } from "@/components/legal-dialog";
import PrivacyPolicy from "../../(legal)/privacy/page";

/** The privacy policy opened from a link in the app: over the page it was opened from, rather than in its place. */
export default function PrivacyDialog() {
  return (
    <LegalDialog label="Privacy policy">
      <PrivacyPolicy />
    </LegalDialog>
  );
}
