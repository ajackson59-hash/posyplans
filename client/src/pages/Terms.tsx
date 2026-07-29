import termsOfServiceMarkdown from "@/content/terms-of-service.md?raw";
import { LegalDoc } from "./LegalDoc";

export default function Terms() {
  return <LegalDoc title="Terms of Service" markdown={termsOfServiceMarkdown} />;
}
