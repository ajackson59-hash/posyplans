import { useLocation, Link } from "wouter";
import { CheckCircle2, Sparkles } from "lucide-react";
import { SiInstagram, SiTiktok, SiFacebook, SiX } from "react-icons/si";
import { Wordmark, Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { useSeo } from "@/hooks/use-seo";
import { EVENT_LANDING_CONTENT, type EventLandingKey } from "@/data/eventLandingContent";

const heroTablescape = "/brand/photography/posy_hero_tablescape.png";

export default function EventLanding({ contentKey }: { contentKey: EventLandingKey }) {
  const [, navigate] = useLocation();
  const content = EVENT_LANDING_CONTENT[contentKey];

  useSeo({
    title: content.metaTitle,
    description: content.metaDescription,
    path: `/${content.slug}`,
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link href="/" data-testid="link-logo-home">
            <Wordmark />
          </Link>
          <nav className="hidden items-center gap-8 md:flex" data-testid="nav-primary">
            <Link
              href="/"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              data-testid="link-nav-home"
            >
              Home
            </Link>
            <Link
              href="/pricing"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              data-testid="link-nav-pricing"
            >
              Pricing
            </Link>
          </nav>
          <Button data-testid="button-nav-start-planning" onClick={() => navigate("/intake")}>
            Start planning
          </Button>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="px-6 py-16 md:py-24">
          <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-2">
            <div>
              <p
                className="mb-4 text-xs font-bold uppercase tracking-[0.14em] text-primary"
                data-testid="text-hero-eyebrow"
              >
                {content.eyebrow}
              </p>
              <h1
                className="mb-6 font-serif text-4xl font-medium leading-[1.12] tracking-tight md:text-5xl"
                data-testid="text-hero-headline"
              >
                {content.headline}
              </h1>
              <p className="mb-8 max-w-lg text-lg text-muted-foreground" data-testid="text-hero-subhead">
                {content.subhead}
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <Button size="lg" data-testid="button-hero-start-planning" onClick={() => navigate("/intake")}>
                  Start planning free
                </Button>
                <Link
                  href="/pricing"
                  className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
                  data-testid="link-hero-pricing"
                >
                  See pricing
                </Link>
              </div>
              <p className="mt-6 text-sm text-muted-foreground" data-testid="text-hero-reassurance">
                ✓ Free to begin · No pressure, no clutter
              </p>
            </div>
            <div className="relative">
              <img
                src={heroTablescape}
                alt={`A styled tablescape, representing calm ${content.eventName.toLowerCase()} planning`}
                className="aspect-[4/3] w-full rounded-2xl object-cover shadow-lg"
                data-testid="img-hero"
              />
              <div className="absolute -bottom-6 left-6 flex h-16 w-16 items-center justify-center rounded-full bg-card shadow-md">
                <Logo className="h-8 w-8" />
              </div>
            </div>
          </div>
        </section>

        {/* Checklist */}
        <section className="border-t border-border bg-card px-6 py-16 md:py-20">
          <div className="mx-auto max-w-4xl">
            <h2 className="mb-8 text-center font-serif text-2xl font-medium md:text-3xl" data-testid="text-checklist-title">
              {content.checklistTitle}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {content.checklist.map((item, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-xl border border-border bg-background p-4"
                  data-testid={`row-checklist-${i}`}
                >
                  <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-primary" />
                  <span className="text-sm text-foreground">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Timeline */}
        <section className="px-6 py-16 md:py-20">
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-10 text-center font-serif text-2xl font-medium md:text-3xl" data-testid="text-timeline-title">
              {content.timelineTitle}
            </h2>
            <div className="space-y-6">
              {content.timeline.map((step, i) => (
                <div key={i} className="flex gap-5" data-testid={`row-timeline-${i}`}>
                  <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-primary/10 font-serif text-sm font-medium text-primary">
                    {i + 1}
                  </div>
                  <div>
                    <p className="mb-1 text-sm font-bold uppercase tracking-wide text-primary">{step.label}</p>
                    <p className="text-sm text-muted-foreground">{step.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="border-t border-border bg-card px-6 py-16 md:py-20">
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-10 text-center font-serif text-2xl font-medium md:text-3xl" data-testid="text-faq-title">
              {content.faqTitle}
            </h2>
            <div className="space-y-8">
              {content.faq.map((item, i) => (
                <div key={i} data-testid={`row-faq-${i}`}>
                  <p className="mb-2 font-medium text-foreground">{item.q}</p>
                  <p className="text-sm text-muted-foreground">{item.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Closing CTA band */}
        <section className="bg-primary px-6 py-16 text-primary-foreground md:py-20">
          <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary-foreground/15">
              <Sparkles className="h-6 w-6 text-primary-foreground" />
            </div>
            <h2 className="mb-4 font-serif text-2xl font-medium md:text-3xl" data-testid="text-closing-headline">
              {content.ctaHeadline}
            </h2>
            <p className="mb-8 text-primary-foreground/80" data-testid="text-closing-subhead">
              {content.ctaSubhead}
            </p>
            <Button
              size="lg"
              variant="secondary"
              data-testid="button-closing-start-planning"
              onClick={() => navigate("/intake")}
            >
              Start planning free
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-6 py-10">
        <div className="mx-auto max-w-6xl">
          <div
            className="flex flex-col items-center gap-3 border-b border-border pb-6 text-center sm:flex-row sm:justify-center sm:gap-6 sm:text-left"
            data-testid="row-footer-planning-guides"
          >
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Planning guides
            </span>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
              <Link
                href="/baby-shower-planning"
                className="text-sm text-muted-foreground hover:text-foreground"
                data-testid="link-footer-guide-baby-shower"
              >
                Baby Shower
              </Link>
              <Link
                href="/birthday-party-planning"
                className="text-sm text-muted-foreground hover:text-foreground"
                data-testid="link-footer-guide-birthday"
              >
                Birthday Party
              </Link>
              <Link
                href="/graduation-party-planning"
                className="text-sm text-muted-foreground hover:text-foreground"
                data-testid="link-footer-guide-graduation"
              >
                Graduation Party
              </Link>
              <Link
                href="/family-reunion-planning"
                className="text-sm text-muted-foreground hover:text-foreground"
                data-testid="link-footer-guide-family-reunion"
              >
                Family Reunion
              </Link>
              <Link
                href="/holiday-party-planning"
                className="text-sm text-muted-foreground hover:text-foreground"
                data-testid="link-footer-guide-holiday"
              >
                Holiday Party
              </Link>
            </div>
          </div>
        </div>
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-5 pt-6 sm:flex-row">
          <p className="text-sm text-muted-foreground" data-testid="text-footer-tagline">
            Your planning concierge. Celebrations, handled with a little more calm.
          </p>
          <div className="flex items-center gap-4" data-testid="row-footer-social">
            <a
              href="https://instagram.com/posyplans"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Posy on Instagram"
              className="text-muted-foreground transition-colors hover:text-primary"
              data-testid="link-social-instagram"
            >
              <SiInstagram className="h-4 w-4" />
            </a>
            <a
              href="https://tiktok.com/@posyplans"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Posy on TikTok"
              className="text-muted-foreground transition-colors hover:text-primary"
              data-testid="link-social-tiktok"
            >
              <SiTiktok className="h-4 w-4" />
            </a>
            <a
              href="https://facebook.com/posyplans"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Posy on Facebook"
              className="text-muted-foreground transition-colors hover:text-primary"
              data-testid="link-social-facebook"
            >
              <SiFacebook className="h-4 w-4" />
            </a>
            <a
              href="https://x.com/posyplans"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Posy on X"
              className="text-muted-foreground transition-colors hover:text-primary"
              data-testid="link-social-x"
            >
              <SiX className="h-4 w-4" />
            </a>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/privacy" className="text-sm text-muted-foreground hover:text-foreground" data-testid="link-footer-privacy">
              Privacy
            </Link>
            <Link href="/terms" className="text-sm text-muted-foreground hover:text-foreground" data-testid="link-footer-terms">
              Terms
            </Link>
            <Link href="/refund-policy" className="text-sm text-muted-foreground hover:text-foreground" data-testid="link-footer-refund">
              Refund Policy
            </Link>
            <Link href="/sms-terms" className="text-sm text-muted-foreground hover:text-foreground" data-testid="link-footer-sms-terms">
              SMS Terms
            </Link>
            <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground" data-testid="link-footer-pricing">
              Pricing
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
