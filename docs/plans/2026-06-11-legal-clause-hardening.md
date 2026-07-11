# Legal-clause hardening (Terms / Privacy / acceptance)

**Date:** 2026-06-11
**Status:** Wave A shipped (code); Wave B drafted, **pending Fachanwalt sign-off**.

Not legal advice. This plan came out of a two-round sub-agent review of the
three "enforceability/sufficiency" questions that were flagged as needing a
lawyer: (1) the liability cap under German AGB law, (2) sign-in-wrap
acceptance, (3) the joint-controller/workplace model + content-licence +
shared-content erasure. Round 1 raised findings; round 2 independently tried
to refute each. The net is below — two findings were genuine, two were
overstated and the docs are more defensible than first thought.

## Verified findings

| #   | Finding                                                                                           | Verified status                                                                                                                                                       | The real fix                   |
| --- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | Acceptance notice (`LegalNotice`) not rendered at the contract-concluding step                    | CONFIRMED (low-severity; create `verify` step had no notice; join + proof-token paths showed it but mis-positioned)                                                   | **Wave A** — code              |
| 2   | Privacy §13 asserts a "processor" role for org Spaces with no Art. 28 DPA in place                | CONFIRMED core gap; **joint-controller theory overstated** (per EDPB 07/2020, picking own retention/security = non-essential means, not joint control)                | **Wave B / B1** — copy         |
| 3a  | Liability cap omits liability for `gesetzliche Vertreter und Erfüllungsgehilfen` (§309 Nr. 7 BGB) | CONFIRMED but **risk downgraded** — agent fault need not be expressly named, though adding it is standard hardening                                                   | **Wave B / B2** — copy         |
| 3b  | "Any further liability is excluded" too blunt                                                     | **Largely REFUTED** — §306(2) BGB severs the overbroad part and upholds the independent carve-outs; §11 already reserves statutory warranty                           | **Wave B / B3** — optional     |
| 4   | Shared-erasure "overclaims anonymisation" / states no lawful basis                                | **Largely REFUTED** — policy never claims anonymisation; lawful basis is present (§4 Art. 6(1)(b)+(f), §14 per-item route, §8 objection right). Posture is defensible | **Wave B / B3** — clarity only |

## Wave A — shipped (no `TOS_VERSION` bump; Terms text unchanged)

Goal: the legal-acceptance notice must be visible **at and above** every action
that concludes the contract (§305(2) BGB notice-at-conclusion).

- `packages/web/src/components/ui/LegalNotice.tsx` — reworded to lead with
  assent: "By {action}, you agree to our Terms and Privacy Policy and confirm
  you are at least 16." (was "you confirm you are at least 16 and agree…").
- `packages/web/src/routes/Home.tsx` — `LegalNotice` moved **above** the
  "Continue" button on the `details` step (covers the proof-token fast path
  that concludes there) and **added above** the "Create Space" button on the
  `verify` step (the code-flow concluding action, which previously had none).
- `packages/web/src/routes/Join.tsx` — `LegalNotice` moved **above** the
  "Join Space" button (was below it).

No re-acceptance is triggered: this changes _how_ acceptance is presented, not
the Terms/Privacy content.

## Wave B — proposed redlines, hold for the Fachanwalt

All three touch Terms/Privacy **text**, so they ship together as **one
`TOS_VERSION` bump** (`packages/shared/src/constants.ts:60`, currently
`'2026-06-01'`) — existing members hit the 428 and re-accept once. Draft the
edits, get the lawyer to bless them in the same hour, then bump + deploy.

### B1 — Privacy §13 (priority): stop asserting an unbacked processor role

`packages/web/src/routes/Privacy.tsx` §"13. Workplace and team use".

CURRENT:

> …in those cases the organisation may be the controller for the content and
> we act as processor for it, while remaining controller for platform
> metadata. If you need a Data Processing Agreement for organisational use,
> please contact us.

PROPOSED:

> During the current free beta we act as the controller for the content in
> every Space, including Spaces created for an organisation. We do not act as
> a data processor for any organisation unless and until a written
> data-processing agreement under Art. 28 GDPR is in place between us and that
> organisation. If your organisation needs Plainspace to act as its processor
> under an Art. 28 agreement, contact us before using Plainspace for
> organisational purposes and we will provide one.

Why: Art. 28(3) requires the DPA to be _in place_, not merely offered.
Advertising a processor role with no executable instrument is the gap. Naming
ourselves controller during the beta closes it without a click-through DPA.

### B2 — Terms §12: attribute representatives/agents (§309 Nr. 7 BGB)

`packages/web/src/routes/Terms.tsx` §"12. Liability", first bullet.

CURRENT:

> We are liable without limitation for intent and gross negligence, for
> personal injury, death, or damage to health, and for liability under the
> German Product Liability Act (Produkthaftungsgesetz).

PROPOSED:

> We are liable without limitation for intent and gross negligence —
> including that of our legal representatives and vicarious agents
> (gesetzliche Vertreter und Erfüllungsgehilfen) — for personal injury,
> death, or damage to health, and for liability under the German Product
> Liability Act (Produkthaftungsgesetz).

⚠️ For the lawyer: §309 Nr. 7 **lit. a** (life/body/health) bites on _any_
negligence including agents, while **lit. b** (other damage) covers gross
negligence including agents. Confirm the bullet structure reflects that the
personal-injury head is not limited to _gross_ negligence.

### B3 — optional clarity (not required for compliance)

- Terms §12, last bullet — CURRENT: "Any further liability is excluded."
  PROPOSED: "Any further liability is excluded. Mandatory statutory liability
  remains unaffected." (belt-and-suspenders; §306(2) already protects this).
- Privacy §7, "Content you authored in shared Spaces" bullet — append:
  "Detaching the authorship link is not by itself erasure of that content; to
  have specific items erased, use the per-item deletion route described in
  §14." Avoids implying de-attribution discharges Art. 17 erasure.

## Fachanwalt agenda (now four precise questions)

1. Is free/gratuitous use **Leihe vs Miete**? (If Leihe, the §536a concern
   behind B3 is moot.) Does the §3 B2B carve-out shift the §307-vs-§309
   yardstick for B2? (#3)
2. Does unilateral retention-setting risk **joint control** for a multi-tenant
   host, and does "DPA on request" suffice pre-launch, or must an instrument
   exist the moment one org Space does? (#2)
3. Is sign-in-wrap sufficient for **consumers** under post-2024 e-commerce /
   fairness case law, or is an explicit checkbox needed? (#1)
4. Does free-text author-PII in _retained_ tasks need **proactive scrubbing**
   (not just on-request) to satisfy Art. 17 for that residual data? (#4)

## Acceptance criteria

- [x] Wave A: `LegalNotice` renders above the CTA on every contract-concluding
      view (create `verify`, create `details`/proof-token, join). Typecheck
      clean for the touched files.
- [ ] Wave B: redlines reviewed by the Fachanwalt, applied, `TOS_VERSION`
      bumped, re-acceptance verified once in production.
