# DSA Art. 17 — Statement of Reasons templates

**Status:** active. **Last reviewed:** 2026-05-20.

DSA Art. 17 requires that we deliver a clear, specific Statement of
Reasons (SoR) to the affected user any time we take a moderation action:
content removal, restriction, visibility reduction, account suspension,
account termination, or monetisation impact. The SoR must include:

- (a) the action taken (and its territorial / temporal scope);
- (b) the facts and circumstances on which the decision is based, including
  whether the decision followed a notice (Art. 16) or proactive detection;
- (c) whether the decision was made by automated means;
- (d) the legal or contractual ground (Plainspace Terms § 7 acceptable-use,
  or the specific law);
- (e) information about redress: in-app or written objection to us, and
  the right to bring a court action.

Plainspace is exempt from the Art. 24 Transparency Database submission
duty under the Art. 19 micro-enterprise carve-out — we do not submit SoRs
to the EU Commission's database. But the **user-facing statement itself is
required regardless of size**.

Templates below cover the common cases. Adjust placeholders, then send via
email to the affected user (preferred) or in-app message. Always retain a
copy in the incident file.

---

## Conventions

- `${MEMBER_NAME}` — the affected member's display name
- `${ITEM_REF}` — the URL or anchor of the content (task ID, attachment
  filename, scratchpad reference)
- `${PROJECT_NAME}` — the Space name
- `${DATE}` — ISO date of the action
- `${SUMMARY}` — one-sentence factual description of the content
- `${POLICY_REF}` — citation to Terms § 7 or the specific paragraph

Each template provides a **German** and an **English** version. Send the
language the user signed up in; default to English if unknown.

---

## Template A — content removal after a third-party notice (Art. 16)

### English

> Subject: Notice of content removal in your Plainspace Space
>
> Hello ${MEMBER_NAME},
>
> We received a notice under Article 16 of the EU Digital Services Act
> alleging that the following item in your Plainspace Space
> "${PROJECT_NAME}" is illegal:
>
> - Reference: ${ITEM_REF}
> - Brief description: ${SUMMARY}
>
> After review, we have removed the item from the Space on ${DATE}. Our
> decision was made by a human reviewer; no automated decision-making was
> involved.
>
> Legal basis: ${POLICY_REF} (Plainspace Terms of Service § 7 —
> Acceptable Use). Additional legal basis under national or EU law where
> applicable: [optional — fill in if a specific statute was cited].
>
> If you believe the decision is incorrect, you may object by replying to
> this email within 30 days, providing your reasons and any additional
> context. You also have the right to bring this matter before a German
> court. We are not obliged to participate in dispute-resolution
> proceedings before a Verbraucherschlichtungsstelle (§ 36 VSBG).
>
> Plainspace
> hello@plainspace.org

### Deutsch

> Betreff: Mitteilung zur Entfernung von Inhalten in Ihrem
> Plainspace-Space
>
> Hallo ${MEMBER_NAME},
>
> wir haben eine Meldung nach Artikel 16 der EU-Verordnung über digitale
> Dienste (DSA) erhalten, in der vorgebracht wird, dass der folgende
> Inhalt in Ihrem Plainspace-Space "${PROJECT_NAME}" rechtswidrig ist:
>
> - Referenz: ${ITEM_REF}
> - Kurzbeschreibung: ${SUMMARY}
>
> Nach Prüfung haben wir den Inhalt am ${DATE} aus dem Space entfernt.
> Die Entscheidung wurde von einer menschlichen Person getroffen; eine
> automatisierte Entscheidungsfindung lag nicht vor.
>
> Rechtsgrundlage: ${POLICY_REF} (Plainspace Nutzungsbedingungen § 7 —
> Zulässige Nutzung). Zusätzliche gesetzliche Grundlage, soweit
> einschlägig: [optional — bei Bezug auf eine konkrete Norm hier ergänzen].
>
> Wenn Sie die Entscheidung für unzutreffend halten, können Sie binnen
> 30 Tagen per Antwort auf diese E-Mail Widerspruch einlegen und Gründe
> bzw. weiteren Kontext angeben. Es steht Ihnen ferner frei, den Rechtsweg
> vor einem deutschen Gericht zu beschreiten. Wir sind weder verpflichtet
> noch bereit, an einem Streitbeilegungsverfahren vor einer
> Verbraucherschlichtungsstelle teilzunehmen (§ 36 VSBG).
>
> Plainspace
> hello@plainspace.org

---

## Template B — content removal after proactive review

Use when our own moderation detected a Terms violation (CSAM, malware,
illegal content) without an external notice.

### English

> Subject: Notice of content removal in your Plainspace Space
>
> Hello ${MEMBER_NAME},
>
> During routine review on ${DATE}, we identified the following item in
> your Plainspace Space "${PROJECT_NAME}" as violating our Terms of
> Service:
>
> - Reference: ${ITEM_REF}
> - Brief description: ${SUMMARY}
> - Reason: ${POLICY_REF}
>
> We have removed the item. Our decision was made by a human reviewer;
> no automated decision-making was involved.
>
> If you believe the decision is incorrect, you may object by replying
> to this email within 30 days. You also have the right to bring this
> matter before a German court.
>
> Plainspace
> hello@plainspace.org

### Deutsch

> Betreff: Mitteilung zur Entfernung von Inhalten in Ihrem
> Plainspace-Space
>
> Hallo ${MEMBER_NAME},
>
> bei einer Routineprüfung am ${DATE} haben wir festgestellt, dass der
> folgende Inhalt in Ihrem Plainspace-Space "${PROJECT_NAME}" gegen
> unsere Nutzungsbedingungen verstößt:
>
> - Referenz: ${ITEM_REF}
> - Kurzbeschreibung: ${SUMMARY}
> - Begründung: ${POLICY_REF}
>
> Wir haben den Inhalt entfernt. Die Entscheidung wurde von einer
> menschlichen Person getroffen; eine automatisierte Entscheidungs-
> findung lag nicht vor.
>
> Bei abweichender Auffassung können Sie binnen 30 Tagen per Antwort auf
> diese E-Mail Widerspruch einlegen. Es steht Ihnen ferner frei, den
> Rechtsweg vor einem deutschen Gericht zu beschreiten.
>
> Plainspace
> hello@plainspace.org

---

## Template C — account suspension or termination

For DSA Art. 18 cases (credible threat to life), use Template C with
generic Terms § 7 wording. Do **not** reference the law-enforcement
notification in the SoR. (Operators: see the Art. 18 runbook in your
private ops documentation.)

### English

> Subject: Suspension of your Plainspace access
>
> Hello ${MEMBER_NAME},
>
> Your access to Plainspace has been suspended on ${DATE} due to a
> material breach of our Terms of Service, specifically:
>
> ${POLICY_REF}
>
> The suspension applies to your member record in the Space
> "${PROJECT_NAME}" [and / or all Spaces you are a member of — choose
>
> > one]. The suspension is [temporary, until ${UNTIL_DATE} / permanent].
>
> Our decision was made by a human reviewer; no automated
> decision-making was involved.
>
> If you believe the decision is incorrect, you may object by replying
> to this email within 30 days. You also have the right to bring this
> matter before a German court.
>
> Plainspace
> hello@plainspace.org

### Deutsch

> Betreff: Sperrung Ihres Plainspace-Zugangs
>
> Hallo ${MEMBER_NAME},
>
> Ihr Zugang zu Plainspace wurde am ${DATE} aufgrund eines wesentlichen
> Verstoßes gegen unsere Nutzungsbedingungen gesperrt, konkret:
>
> ${POLICY_REF}
>
> Die Sperrung betrifft Ihr Mitglieds­profil im Space "${PROJECT_NAME}"
> [bzw. sämtliche Spaces, in denen Sie Mitglied sind — bitte wählen].
> Die Sperrung ist [vorübergehend bis ${UNTIL_DATE} / dauerhaft].
>
> Die Entscheidung wurde von einer menschlichen Person getroffen; eine
> automatisierte Entscheidungsfindung lag nicht vor.
>
> Bei abweichender Auffassung können Sie binnen 30 Tagen per Antwort auf
> diese E-Mail Widerspruch einlegen. Es steht Ihnen ferner frei, den
> Rechtsweg vor einem deutschen Gericht zu beschreiten.
>
> Plainspace
> hello@plainspace.org

---

## Operator checklist (every SoR)

- [ ] Template selected matching the action (A, B, or C).
- [ ] All placeholders filled. No `${...}` left in the sent message.
- [ ] Language matches the recipient where known.
- [ ] Automated-means flag: confirm "no" (Plainspace moderation is human;
      if that ever changes, update the templates).
- [ ] Sent within 24 hours of the moderation action.
- [ ] Copy archived in the operator's private incident log, kept
      outside this repository.
- [ ] In an Art. 18 case, do **not** reference the law-enforcement
      notification in the SoR. Use Template C with Terms § 7 generic
      wording (see the Art. 18 runbook in your private ops
      documentation).
