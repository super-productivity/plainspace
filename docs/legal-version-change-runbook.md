# Legal version change runbook

Use before changing Terms, Privacy Policy, or material data-processing behavior.

## Classify the change

- **Minor:** typo, broken link, formatting, clarification with no rights/data impact.
- **Material:** liability, content license, fees, deletion, subprocessors with new transfer risk, new data categories, analytics/tracking, AI processing, or privacy-rights handling.

## Minor changes

1. Update the page.
2. Do not bump `TOS_VERSION` unless users need to re-accept.
3. Record the change in the commit message.

## Material changes

1. Draft a notice explaining what changed, old/new effective date, and user options.
2. Give reasonable advance notice where required.
3. Bump `TOS_VERSION` in `packages/shared/src/constants.ts`.
4. Deploy the new pages and notice.
5. Verify the re-acceptance modal blocks normal use until acceptance.
6. Keep evidence: notice text, deploy date, effective date, and acceptance check.

## Emergency changes

For security, abuse, or legal-risk emergencies, deploy immediately if needed, then send notice as soon as practical and document why advance notice was not possible.
