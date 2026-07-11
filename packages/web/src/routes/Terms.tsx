import { A } from '@solidjs/router';
import { TOS_VERSION } from '@plainspace/shared';
import { LegalPage } from '../components/ui';

export default function Terms() {
  return (
    <LegalPage title="Terms of Service" meta={`Version ${TOS_VERSION}`}>
      <p>
        These Terms govern your use of Plainspace. Statutory consumer rights under German law remain
        unaffected by anything stated below.
      </p>

      <h2>1. Provider</h2>
      <p>
        Plainspace is operated by Johannes Millan, Hauptstraße 4H, 10317 Berlin, Germany. See the{' '}
        <A href="/impressum">Impressum</A> for full contact details.
      </p>

      <h2>2. Eligibility</h2>
      <p>
        You must be at least 16 years old to create or join a Space. If you create a Space on behalf
        of an organisation, you confirm that you have authority to bind that organisation.
      </p>

      <h2>3. Consumer vs business use</h2>
      <p>
        If you use Plainspace for personal, non-commercial purposes you are a consumer under § 13
        BGB. If you use Plainspace for business or professional purposes (including coordinating
        work for an organisation), you are not a consumer within the meaning of § 13 BGB, and the
        business-user jurisdiction clause in section 13 may apply.
      </p>

      <h2>4. The service</h2>
      <p>
        Plainspace lets small groups coordinate on a shared Space with a single task list and a
        shared scratchpad. Plainspace is <strong>not</strong> a backup service, is{' '}
        <strong>not</strong> intended for storing regulated or sensitive data (health data, payment
        cards, government IDs), and is <strong>not</strong> intended for production-critical
        workflows.
      </p>

      <h2>5. Membership and access tokens</h2>
      <p>
        Plainspace uses passwordless authentication. When you create or join a Space, your browser
        stores a per-Space access token that acts as your credential. Each browser session expires
        after 7 days and can be revoked earlier by signing out on that device or leaving the Space.
        Anyone with access to that token, or to an email inbox you added to that Space, can access
        the Space as you. You are responsible for the security of the device and inbox you use. An
        API token (one per email, valid for 1 year) follows the same rule and may be revoked by us
        if abused.
      </p>
      <p>
        By creating or joining a Space, you confirm that you are at least 16 years old. We do not
        knowingly accept registrations from anyone under 16. See the{' '}
        <A href="/privacy">Privacy Policy</A> for what happens if we learn a membership belongs to
        someone below that age.
      </p>

      <h2>6. Your content and licence</h2>
      <p>
        You keep ownership of the content you contribute (tasks, scratchpad edits). You grant us a
        non-exclusive, worldwide, royalty-free licence solely to host, store, transmit, display, and
        process that content (a) to other members of the same Space, and (b) as needed to operate,
        secure, and back up the service. When you delete a task, we remove it from the active Space
        view and purge it from live systems after the applicable undo or cleanup period. This
        licence terminates when the content is purged from live systems, subject to short technical
        retention in backups as described in our <A href="/privacy">Privacy Policy</A>.
      </p>
      <p>
        We do not use your content to train AI models and do not share it with third parties for
        that purpose.
      </p>

      <h2>7. Acceptable use</h2>
      <p>You must not use Plainspace to:</p>
      <ul>
        <li>store or share illegal content (including CSAM or terrorist content);</li>
        <li>submit links or content intended to deliver malware or harm other members;</li>
        <li>harass other members of a Space;</li>
        <li>scrape, automate against, or abuse the service;</li>
        <li>use someone else's email verification code or join token;</li>
        <li>circumvent technical limits such as rate limits or the per-email API-token limit.</li>
      </ul>

      <h2>8. Content moderation and notice-and-action</h2>
      <p>
        <strong>No general monitoring.</strong> We do not proactively monitor user content. We have
        no general obligation to do so under Art. 8 of Regulation (EU) 2022/2065 (Digital Services
        Act).
      </p>
      <p>
        <strong>DSA points of contact.</strong> For communication under DSA Arts. 11 and 12,
        authorities and users can write to{' '}
        <a href="mailto:hello@plainspace.org?subject=DSA%20contact">hello@plainspace.org</a>. We
        accept German and English.
      </p>
      <p>
        <strong>Notices of illegal content (DSA Art. 16).</strong> Anyone can report content they
        believe is illegal by emailing{' '}
        <a href="mailto:hello@plainspace.org?subject=DSA%20notice">hello@plainspace.org</a> with the
        subject "DSA notice", or via the <A href="/contact">contact form</A> using the "Illegal
        content notice" topic. Please include the URL or item identifier, an explanation of why you
        believe the content is illegal, your contact details, and a statement that you have a
        good-faith belief that the information and allegations are accurate and complete (DSA Art.
        16(2)). We acknowledge notices and act on them in a timely and non-arbitrary manner.
      </p>
      <p>
        <strong>Statement of reasons (DSA Art. 17).</strong> If we remove your Space membership, or
        remove content as an enforcement action (for example, in response to a notice of illegal
        content under this section), we will provide a statement of reasons covering what was
        affected, the factual and legal basis for our decision, and how you can object. For routine
        deletions a member performs themselves, no statement is sent.
      </p>

      <h2>9. Suspension and termination</h2>
      <p>
        If you are not the Space creator, you may leave a Space at any time from the People panel;
        doing so deletes your member record (see Privacy Policy § 14). Space creators cannot
        self-delete their own member record while the Space still exists. To delete a Space you
        created, write to <a href="mailto:hello@plainspace.org">hello@plainspace.org</a>. We may
        suspend or terminate your access if you materially breach these Terms, with notice where
        reasonable. After termination, content is handled per our{' '}
        <A href="/privacy">Privacy Policy</A>.
      </p>

      <h2>10. Fees</h2>
      <p>
        Plainspace is currently free. If we introduce paid plans, we will notify you and you may
        decline by deleting your Space before the changes take effect.
      </p>

      <h2>11. Availability and warranty</h2>
      <p>
        Plainspace is provided as a small, free coordination tool. We do not promise uninterrupted
        availability, permanent storage, or fitness for production-critical use. We may perform
        maintenance and make technical changes where reasonably necessary. Statutory consumer rights
        under German law, including warranty rights for digital services, remain unaffected.
      </p>

      <h2>12. Liability</h2>
      <p>Our liability is limited as follows, applying both to consumers and to business users:</p>
      <ul>
        <li>
          We are liable without limitation for intent and gross negligence, for personal injury,
          death, or damage to health, and for liability under the German Product Liability Act (
          <em>Produkthaftungsgesetz</em>).
        </li>
        <li>
          For breaches of essential contractual duties (<em>Kardinalpflichten</em>) by simple
          negligence, our liability is limited to damages typical and foreseeable at the time the
          contract was concluded.
        </li>
        <li>Any further liability is excluded.</li>
      </ul>
      <p>
        Statutory consumer rights under German law, including warranty rights under § 309 No. 8 BGB,
        remain unaffected.
      </p>

      <h2>13. Governing law and jurisdiction</h2>
      <p>
        These Terms are governed by German law. The exclusive place of jurisdiction for disputes
        with merchants, legal entities under public law, and special funds under public law is
        Berlin to the extent legally permitted. For consumers, the mandatory consumer-protection
        provisions of the country of your habitual residence remain applicable (Art. 6 Rome I
        Regulation), and consumers may sue in their place of residence (Brussels Ia Regulation Arts.
        17–19).
      </p>
      <p>
        We are not obliged to participate in dispute-resolution proceedings before a consumer
        arbitration body (Verbraucherschlichtungsstelle) and are not willing to do so (§ 36 VSBG).
      </p>

      <h2>14. Changes to these Terms</h2>
      <p>
        If we change these Terms in a way that materially affects your rights or obligations, we
        will give reasonable advance notice where required and ask you to actively accept the new
        version before you continue using a Space. If you decline, you can stop using Plainspace and
        request deletion of your Space or member record. Minor changes (typo fixes, clarifications)
        take effect on publication.
      </p>

      <h2>15. Severability</h2>
      <p>
        If any provision of these Terms is held to be invalid, the remaining provisions remain in
        effect.
      </p>

      <h2>16. Contact</h2>
      <p>
        For questions about these Terms, write to{' '}
        <a href="mailto:hello@plainspace.org">hello@plainspace.org</a> or use the{' '}
        <A href="/contact">contact form</A>. See the <A href="/impressum">Impressum</A> for full
        contact details.
      </p>
    </LegalPage>
  );
}
