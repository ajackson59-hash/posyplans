# RSVP continuation and invitation preservation

The guest flow must retain the host's image and confirm the RSVP actually saved
for the correct recipient. Reproduced defects covered by this change:

- Draft invitations accepted recipient reads, identification, RSVP, and text opt-in.
- A plus-one limit capped adults/children separately, permitting three or four
  people in a form that the server capped to two.
- Confirmation used the requested headcount instead of the accepted response.
- Navigating between personal invitation URLs retained the previous recipient's
  local form state.
- Lost-response reconciliation compared only the total, overlooking different
  adult/child counts with the same sum.
- Reused artwork in an invitation without a design concept used a fixed-height
  crop. It now renders at its native ratio.

The server rejects recipient reads and new responses on draft invitations with
`409 invitation_unpublished`. Withdrawal of text consent remains available.
Recipient forms remount when their link changes; switching generic recipients
clears their text choice and is disabled while a response is being saved.
Confirmation uses the saved response and offers **Update my RSVP**. Reconciliation
checks status, total, adult count, child count, and note.

## Focused checks

```sh
npm run check
npx vitest run tests/rsvpContinuation.test.tsx tests/personalizedGuestRoutes.test.ts tests/rsvpPresentation.test.tsx tests/eventArtworkDelivery.test.ts tests/inviteStudio.test.tsx tests/appSecurity.test.ts tests/checkoutSettlement.test.ts
```

These tests use rendered React DOM and actual Express handlers with synthetic
storage. They do not prove deployed persistence or browser visual quality.

## Deployed acceptance

After full CI passes, use only a new disposable synthetic event/guest on the
exact Preview deployment. Do not send email/SMS, enter checkout, or call AI routes.
Verify draft denial, publish, personal-link load, RSVP save, independent reload,
amendment, stored adult/child counts, unpublish denial, and republish.
Save wording with the displayed artwork URL and compare the downloaded bytes.
Confirm the guest is scoped to its event and that revoked tokens stop working.
Inspect the public invitation in the supported browser if accessible; report
browser or viewport limitations separately. Delete only the created fixture rows
after verification, using their recorded IDs and marker, and confirm cleanup.

Keep real Stripe settlement and the original image-quality benchmark open.
