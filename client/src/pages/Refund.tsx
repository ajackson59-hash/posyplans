import refundPolicyMarkdown from "@/content/refund-policy.md?raw";
import { LegalDoc } from "./LegalDoc";

export default function Refund() {
  return <LegalDoc title="Refund Policy" markdown={refundPolicyMarkdown} />;
}
