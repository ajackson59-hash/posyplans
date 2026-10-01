# Checkout settlement and approved artwork

Checkout completion alone does not establish payment. The browser confirmation
and signed checkout webhooks now use the same fulfillment path, retrieve the
current Stripe session, require `paid` (or a legitimate zero-total
`no_payment_required` session), and validate the Posy product and event.

Plus access additionally requires a currently active subscription or an unexpired
legacy trial. Subscription notifications retrieve current state, require a paid
latest invoice before granting paid access, and preserve a newer subscription
when an older one is canceled. New subscriptions retain the originating event in
metadata, so a browser return is not required to bind its checkout email.

Storage failures return a retryable webhook error. Repeated Spark fulfillment
preserves the first unlock timestamp/session with an atomic SQL predicate.
Concurrent initial email-entitlement inserts use `ON CONFLICT`.
This is not an exactly-once guarantee for analytics or email delivery.

## Automated regression checks

Run `npm run check` and:

```sh
npx vitest run tests/checkoutSettlement.test.ts tests/checkoutSuccess.test.tsx tests/checkoutEmailCapture.test.ts tests/checkoutCurrency.test.ts tests/checkoutHandoff.test.ts tests/paywallEntitlementGate.test.ts tests/initialPreviewRoute.test.ts
```

The settlement suite uses the real Stripe signature verifier and Express routes
with synthetic Stripe responses and in-memory storage. It exercises pending and
settled payments, delayed settlement, duplicate notifications, inactive/expired
Plus access, stale subscription notifications, persistence retry, confirmed
entitlements, and byte-preserving reuse/reload of approved artwork. The return
screen suite checks retry without a second checkout, honest success/trial labels,
and navigation to the event recorded on the verified Stripe session.

These checks do not establish a real Stripe transaction, webhook delivery,
database concurrency under load, or browser visual quality.

## Deployed payment acceptance gate

1. On the exact passing Preview commit, read `/api/checkout/config` and require
   `mode: "test"`, `configured: true`, and `webhookConfigured: true`. These
   non-secret booleans establish configuration presence, not validity/delivery.
2. Verify test-mode prices and the Stripe webhook destination for that Preview.
   Subscribe to checkout completed and async-payment-succeeded, plus subscription
   created/updated/deleted events. Do not point test events at Production.
3. Use an explicitly authorized synthetic event and approved fixture artwork.
   Complete one Spark and one Plus purchase with Stripe test payment details;
   do not use live credentials or incur real charges. Use an authorized test
   mailbox/sink for recovery email.
4. Capture settled Stripe session/invoice state, signed webhook delivery, the
   persisted entitlement, and a fresh browser reload. Prove access still unlocks
   when the customer does not visit the checkout return page.
5. Reuse the already-approved artwork and compare its downloaded bytes/hash
   after owner reload and guest viewing. No new image-provider generation is
   needed for this payment gate. Avoid auto-generation routes unless separately
   authorized; an entitlement can otherwise start paid planner work.
6. Check desktop/mobile presentation and delayed/canceled-payment recovery.
   Keep the release gate open until the actual deployed flow is evidenced.

References: [Stripe fulfillment](https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted),
[Stripe webhook delivery](https://docs.stripe.com/webhooks), and
[PostgreSQL ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html).
