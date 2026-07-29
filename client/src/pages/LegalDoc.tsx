import { Link } from "wouter";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Wordmark } from "@/components/Logo";

interface LegalDocProps {
  title: string;
  markdown: string;
}

// Renders the drafted Privacy Policy / Terms of Service markdown as real,
// linkable pages so the cookie-consent banner and footer links have
// somewhere real to point instead of a placeholder. These are still DRAFTS
// (see the "Still open before publishing" section at the bottom of each .md
// file) — a couple of items (legal entity name, contact email) are pending
// real values, and a licensed attorney should review both before this app
// is publicly launched.
export function LegalDoc({ title, markdown }: LegalDocProps) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <Link href="/">
            <Wordmark />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-14">
        <div
          className="mb-8 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
          data-testid="notice-draft-legal-doc"
        >
          <strong>Draft — not yet reviewed.</strong> This {title.toLowerCase()} still has a couple of
          open items (see the note near the top and the checklist at the bottom) and has not been
          reviewed by an attorney. It's published here only so links elsewhere in the app (like the
          cookie banner) have a real page to point to.
        </div>

        <article className="prose prose-neutral dark:prose-invert max-w-none" data-testid="content-legal-doc">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </article>
      </main>
    </div>
  );
}
