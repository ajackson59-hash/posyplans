import { Link } from "wouter";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Wordmark } from "@/components/Logo";

interface LegalDocProps {
  title: string;
  markdown: string;
}

// Internal publication review belongs in docs/legal-publication-review.md,
// not in the policy presented to customers. Rendering is not legal sign-off.
export function LegalDoc({ title, markdown }: LegalDocProps) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <Link href="/" data-testid="link-logo-home">
            <Wordmark />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-14">
        <article aria-label={title} className="prose prose-neutral dark:prose-invert max-w-none" data-testid="content-legal-doc">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </article>
      </main>
    </div>
  );
}
