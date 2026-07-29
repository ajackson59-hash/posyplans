import smsTermsMarkdown from "@/content/sms-terms.md?raw";
import { LegalDoc } from "./LegalDoc";

export default function SmsTerms() {
  return <LegalDoc title="SMS Terms" markdown={smsTermsMarkdown} />;
}
