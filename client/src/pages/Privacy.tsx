import privacyPolicyMarkdown from "@/content/privacy-policy.md?raw";
import { LegalDoc } from "./LegalDoc";

export default function Privacy() {
  return <LegalDoc title="Privacy Policy" markdown={privacyPolicyMarkdown} />;
}
