# Policy publication review — 27 September 2026

Internal draft notes moved out of customer-facing pages. This cleanup is not a legal sign-off. No identity, retention operation, legal deadline, refund rule or liability term is newly approved by this change.

## Concrete facts still requiring owner/operational closure

- Owner decision, September 27 at 16:34 EDT: use **Posy** in the public Terms and Privacy Policy for now. The owner states the business is not yet registered and intends to register after launch. This settles the displayed-name choice; do not request a personal name again or publish one. No registered entity, LLC, corporation, or registered assumed name is asserted. The wording change does not determine applicable registration or operator-disclosure requirements. Revisit entity details when registration is confirmed.
- The published privacy policy promises retention for 12 months after last activity. No event-wide retention/deletion worker was located in the inspected server code or migrations. Confirm the actual manual/automated process and policy before Production; do not claim deletion is implemented.
- Support contact is the established hello@posyplans.com. Do not send a test message without authorization.
- Code integrates Anthropic, OpenAI/Google artwork, Resend email, Twilio SMS, Vercel hosting and Supabase storage. Naming them does not attest to signed agreements, configured SMS delivery, or any external-provider legal status.
- Analytics also supports consent-gated Google Analytics and separately consented Meta Pixel. Public disclosures now name them conditionally. Confirm actual Production configuration and the existing cross-context advertising statement before enabling marketing tags; this source inspection is not a legal conclusion about that statement.
- Preserve the user-confirmed successful annual billing/cancellation; no repeat billing test. The terms continue to offer the support email for cancellation.

## Archived drafting notes

### privacy-policy.md

> **Before you publish this:** This draft is scoped to what Posy actually collects today (event data, host email, guest contact info, optional SMS, and — once wired — payment data via a processor and AI processing via an AI provider). The brand name (Posy, posyplans.com, @posyplans) is now locked in. Two items are still genuinely open and are called out inline below: (1) the formal legal entity that will operate under the Posy brand (LLC, corporation, sole proprietorship, etc.) hasn't been named yet, and (2) the contact email, which currently points to the founder's personal inbox as an interim measure. Update both once finalized, and have a licensed attorney review this before you rely on it, especially since you expect users outside the U.S.

- **Legal entity name** — the brand (Posy, posyplans.com) is locked in, but the formal registered entity operating it (LLC, corporation, or sole proprietorship) hasn't been named yet; add it to Section 1 once formed.
- **Contact email** — currently `ajackson59@gmail.com` as an interim measure; swap for a dedicated support/privacy inbox (e.g. an @posyplans.com address) before real launch.
- **SMS/email delivery provider and hosting/infrastructure provider** — not yet selected; name them in the Section 4 table once chosen, and get their DPAs on file.
- Confirm Stripe's and Anthropic's own data-processing agreements are on file as your sub-processor terms.
- **Have a licensed attorney review this, especially the GDPR/CCPA sections, before collecting data from EU/UK or California residents at scale.**

### terms-of-service.md

> **Before you publish this:** This is a working draft built for Posy's actual product (Spark/Plus tiers, event-link access, AI-assisted planning, SMS/RSVP features). It is a solid starting point, not a substitute for review by a licensed attorney in your state before you take payment or collect personal data from the public. The brand name (Posy, posyplans.com, @posyplans) is now locked in. Two items are still genuinely open and are called out inline below: (1) the formal legal entity that will operate under the Posy brand hasn't been named yet, and (2) the contact email, which currently points to the founder's personal inbox as an interim measure. See the checklist at the bottom for the full remaining list.

- **Legal entity name and state of formation** — the brand (Posy, posyplans.com) is locked in, but the formal registered entity operating it hasn't been named yet; add both to Section 1 and Section 14 once formed, and confirm New York still governs or update accordingly.
- **Contact email** — currently `ajackson59@gmail.com` as an interim measure; swap for a dedicated support inbox (e.g. an @posyplans.com address) before real launch.
- **Self-serve cancellation** — Section 4 currently routes cancellations to email since no in-app billing/cancel flow exists yet; update once a Stripe customer portal or in-app cancel button ships.
- Liability cap in Section 11 ($100 / 12 months) is a placeholder default — revisit for your actual risk tolerance.
- **Have a licensed attorney in your state review this before it governs real transactions.**

### sms-terms.md

> **Before you publish this:** This draft is scoped to Posy's actual SMS use case — RSVP reminders and event updates sent on a host's behalf. It has not been reviewed by an attorney; TCPA carries real enforcement risk, and this section in particular should be reviewed before SMS ships to real users. See the checklist at the bottom.

- **Confirmed max message frequency per event** — currently described only as "varies by event"; add a concrete number once SMS volume patterns are known.
- **SMS delivery provider** — not yet selected; name them here and in the Privacy Policy's sub-processor table once chosen.
- **Legal entity name and contact email** — same open items as the Terms of Service and Privacy Policy.
- **Have a licensed attorney review this before SMS ships to real users — TCPA enforcement risk is real and this is the highest-risk page on the site.**

### refund-policy.md

> **Before you publish this:** This draft states Posy's actual refund terms for both Spark (one-time) and Plus (subscription), expanded into its own page so it has a direct link. Two items are still open and called out inline below: (1) the formal legal entity operating Posy hasn't been named yet, and (2) the contact email currently points to the founder's personal inbox as an interim measure. See the checklist at the bottom. This is a working draft, not a substitute for review by a licensed attorney before it governs real transactions.


- **Legal entity name** — add once the entity operating Posy is formally registered.
- **Contact email** — currently `ajackson59@gmail.com` as an interim measure; swap for a dedicated billing/support inbox before real launch.
- **Self-serve cancellation** — update Section 5 once a Stripe customer portal or in-app cancel button ships.
- **Have a licensed attorney review this alongside the Terms of Service before it governs real transactions.**
