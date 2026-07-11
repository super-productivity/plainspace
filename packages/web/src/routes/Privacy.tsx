import { A } from '@solidjs/router';
import { TOS_VERSION } from '@plainspace/shared';
import { LegalPage } from '../components/ui';

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy" meta={`Version ${TOS_VERSION}`}>
      <p>
        This policy explains how we handle personal data in Plainspace. Where this policy says "we"
        we mean the controller named below.
      </p>

      <h2>1. Controller</h2>
      <p>
        Johannes Millan, Hauptstraße 4H, 10317 Berlin, Germany. Contact:{' '}
        <a href="mailto:hello@plainspace.org">hello@plainspace.org</a>. See the{' '}
        <A href="/impressum">Impressum</A> for full details.
      </p>

      <h2>2. Data protection officer</h2>
      <p>
        We are not currently required to appoint a data protection officer under § 38 BDSG (we do
        not regularly employ at least 20 persons processing personal data) or under Art. 37 GDPR.
      </p>

      <h2>3. What data we process</h2>
      <p>
        <strong>Member data:</strong> your email address, display name, colour, avatar index,
        joined-at timestamp, and a per-Space join token. API token metadata (label, expiry,
        last-used timestamp) if you create API tokens.
      </p>
      <p>
        <strong>Content you create:</strong> task text, scratchpad edits, and activity-log entries
        describing actions you took.
      </p>
      <p>
        <strong>Technical data:</strong> IP address and user-agent when access is used (for security
        and abuse prevention), server access logs, Space-creation, open-by-email, and in-Space
        email-verification codes and timestamps (for verification and rate-limiting).
      </p>
      <p>
        <strong>Contact data:</strong> if you contact us by email or contact form, we process your
        email address, name if provided, message content, and related delivery metadata to answer
        your request.
      </p>
      <p>
        <strong>Illegal-content notices:</strong> if you report content through the{' '}
        <A href="/dsa-notice">DSA Art. 16 notice form</A>, we process the content location and
        reason you give, your name (optional) and email address (required unless you are reporting
        CSAM, which may be reported anonymously), and the status of our handling decision.
      </p>
      <p>
        We do not intentionally process special categories of personal data under Art. 9 GDPR.
        Plainspace is not designed for sensitive data; please do not store it in your Space.
      </p>

      <h2>4. Why we process it (legal bases)</h2>
      <table>
        <thead>
          <tr>
            <th>Purpose</th>
            <th>Legal basis (Art. 6 GDPR)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              Creating your Space membership, sending verification codes, hosting your Space content
            </td>
            <td>6(1)(b) — performance of a contract with you</td>
          </tr>
          <tr>
            <td>Showing your display name, colour, and masked email to co-members</td>
            <td>6(1)(b) — performance of a contract with you</td>
          </tr>
          <tr>
            <td>Security logging, abuse prevention, rate limiting</td>
            <td>6(1)(f) — our legitimate interest in operating a safe service</td>
          </tr>
          <tr>
            <td>Transactional emails (verification codes, ToS changes)</td>
            <td>6(1)(b) and 6(1)(f)</td>
          </tr>
          <tr>
            <td>Answering contact, support, legal, abuse, and privacy requests</td>
            <td>6(1)(b), 6(1)(c), and 6(1)(f), depending on the request</td>
          </tr>
          <tr>
            <td>Marketing emails (not currently sent)</td>
            <td>6(1)(a) — your consent, via a separate opt-in</td>
          </tr>
          <tr>
            <td>Complying with legal obligations</td>
            <td>6(1)(c)</td>
          </tr>
        </tbody>
      </table>

      <h2>5. Who we share it with (subprocessors)</h2>
      <p>
        We use a small number of third-party providers to operate the service. We process real user
        data with a processor only where we require a Data Processing Agreement under Art. 28 GDPR.
        See the current list at <A href="/subprocessors">/subprocessors</A>. Transactional email is
        sent through the mail server configured for Plainspace; any external mail processor must be
        listed on the subprocessors page before it is used for real user data.
      </p>
      <p>
        If you set a reminder on a task and grant your browser permission to receive push
        notifications, the reminder is delivered through the push service operated by your browser
        vendor (Google FCM for Chromium, Mozilla autopush for Firefox, Apple Push Notification
        service for Safari). The payload is end-to-end encrypted between our server and your browser
        using keys your browser generates; the push service only ever sees ciphertext plus the
        technical metadata needed to deliver it (endpoint, timestamps, payload length). The
        decrypted payload contains the task text (truncated) so the notification can show what the
        reminder is about. You can revoke push permission in your browser at any time.
      </p>

      <h2>6. International transfers</h2>
      <p>
        Our hosting takes place within the European Economic Area (Germany). The browser-vendor push
        services described in §5 are operated by Google, Mozilla, and Apple, whose servers may be
        located outside the EEA; we rely on the European Commission's 2021 Standard Contractual
        Clauses (and, where applicable, the EU-US Data Privacy Framework adequacy decision) as the
        transfer safeguard. If we add other processors outside the EEA in the future, we will
        disclose them on the subprocessors page on the same basis.
      </p>

      <h2>7. How long we keep it</h2>
      <ul>
        <li>
          <strong>Member-identifying data</strong> (email, display name, avatar): deleted from the
          relevant Space when your member record is deleted. Non-creator members can do this in the
          product; Space creators must request deletion of the whole Space.
        </li>
        <li>
          <strong>Content you authored in shared Spaces</strong>: treated as Space-operational data;
          when your member record is deleted, your authorship link is removed and the content is no
          longer attributed to you, but the content itself may remain visible to other members.
        </li>
        <li>
          <strong>Backups</strong>: deletion is honoured by placing data beyond use; backup
          snapshots cycle out within approximately 30 days.
        </li>
        <li>
          <strong>Activity log</strong>: up to 365 days, then deleted. Entries recording an
          enforcement action (removal of a member by a Space admin) are kept for up to 3 years as
          the record of the decision, or until the Space is deleted.
        </li>
        <li>
          <strong>Server access logs</strong> (IP, user-agent): up to 30 days.
        </li>
        <li>
          <strong>Email verification codes</strong>: expire after 10 minutes; expired or used
          verification rows for Space creation, opening by email, and in-Space email verification
          are purged automatically and opportunistically when new verification codes are requested.
        </li>
        <li>
          <strong>API tokens</strong>: until you revoke them, or 1 year from creation; expired and
          revoked token rows are purged automatically.
        </li>
        <li>
          <strong>Contact messages</strong>: retained only as long as needed to answer and document
          the request, unless a longer legal retention period applies.
        </li>
        <li>
          <strong>Illegal-content notices</strong> (DSA Art. 16): retained for 3 years from
          submission as the record of our handling decision, then deleted automatically.
        </li>
      </ul>

      <h2>8. Your rights</h2>
      <p>
        Under the GDPR you have the right to: access your data (Art. 15), correct it (Art. 16),
        erase it (Art. 17), restrict its processing (Art. 18), receive it in a portable format (Art.
        20), object to processing (Art. 21), and withdraw any consent you have given. To exercise
        any of these, write to{' '}
        <a href="mailto:hello@plainspace.org?subject=Privacy%20request">hello@plainspace.org</a>{' '}
        with the subject "Privacy request". We respond within one month (Art. 12(3) GDPR).
      </p>
      <p>
        You also have the right to lodge a complaint with a supervisory authority. Our competent
        authority is the{' '}
        <a href="https://www.datenschutz-berlin.de/" target="_blank" rel="noopener noreferrer">
          Berliner Beauftragte für Datenschutz und Informationsfreiheit
        </a>
        .
      </p>

      <h2>9. Whether you have to provide this data</h2>
      <p>
        Creating a new Space requires an email address. Joining an open Space only requires a
        display name; no email is needed. If you verify an email later, we send a 6-digit
        verification code to it; verification unlocks advanced features such as turning link joining
        off and API tokens, but verification itself is optional after joining. All other data is
        optional in the sense that you only provide it if you choose to use the relevant feature
        (e.g. verifying your email to turn link joining off or create API tokens).
      </p>

      <h2>10. Automated decision-making</h2>
      <p>
        We do not engage in automated decision-making producing legal or similarly significant
        effects under Art. 22 GDPR.
      </p>

      <h2>11. What other members see</h2>
      <p>
        Other members of your Space can see your display name, colour, avatar, and joined-at
        timestamp. They see only a masked form of your email (for example,{' '}
        <code>j***s@example.com</code>); they cannot see your full email address. Admins of a Space
        with link joining off do not see the full email addresses of other already-joined members.
        Plainspace operators can access full member email addresses where necessary to operate,
        secure, or support the service.
      </p>

      <h2>12. Space links and sharing with others</h2>
      <p>
        For Spaces with link joining on, anyone with the join link can view the Space name and
        purpose before they join, then join by choosing a display name. For Spaces with link joining
        off, unauthenticated visitors see only that joining is off; the Space name and purpose are
        not shown on the join page.
      </p>
      <p>
        Plainspace does not currently send per-recipient sharing emails or store pending recipient
        records on your behalf. Sharing a Space means sending an open Space link by your own means
        (for example by email or messenger). We do not store any data about people you intend to
        share with until they themselves join a Space or contact us.
      </p>

      <h2>13. Workplace and team use</h2>
      <p>
        When you use Plainspace for personal or household coordination (friends, family, hobby
        groups), we act as the controller for the platform. When you create a Space on behalf of an
        organisation, that organisation determines the purposes and means of processing Space
        content; in those cases the organisation may be the controller for the content and we act as
        processor for it, while remaining controller for platform metadata. If you need a Data
        Processing Agreement for organisational use, please contact us.
      </p>

      <h2>14. Removing your data from a Space</h2>
      <p>
        If you are not the Space creator, you can remove your member record from a Space at any
        time. Space creators must contact us to delete the entire Space. When your member record is
        deleted, we delete your email, display name, colour, avatar, and join token for that Space.
        Content you authored in that Space (tasks, scratchpad edits) remains visible to the other
        members as operational data of the Space, but is no longer attributed to you. If you want a
        specific piece of content deleted in addition to your member record, ask us and we will
        assess and process the request unless another legal basis requires retention.
      </p>
      <p>
        Because Plainspace uses per-Space membership, removing yourself from one Space does not
        affect any other Space you are a member of.
      </p>

      <h2>15. AI and machine learning</h2>
      <p>
        We do not use your tasks or scratchpad content to train AI models, and we do not share them
        with third parties for that purpose.
      </p>

      <h2>16. Cookies and similar technologies</h2>
      <p>
        We store a per-Space join token in your browser's localStorage. This is strictly necessary
        to provide the passwordless access you requested (§ 25(2) No. 2 TDDDG): the token is the
        credential, and without it we cannot keep your Space access available. It remains in your
        browser until you sign out, clear browser storage, or leave that Space, and the server
        accepts each issued session for no more than 7 days. We also store local UI state, such as
        recent reminder choices and an email saved on this device for form prefill. You can clear
        the saved email from the People panel. We do not use third-party cookies, analytics,
        advertising, or tracking technologies. For this reason no consent banner is required.
      </p>

      <h2>17. Security</h2>
      <ul>
        <li>All connections to the service are encrypted with TLS.</li>
        <li>
          Member email addresses are encrypted at the application layer with AES-256-GCM. The
          encryption keys are held in the application's runtime environment, separate from the
          database storage; they do not appear in the database, in backups, or in snapshots.
        </li>
        <li>
          Per-Space join tokens and API tokens are stored only as SHA-256 hashes server-side; the
          plaintext token is sent only as an authentication credential over TLS and is never stored
          in plaintext server-side.
        </li>
        <li>
          The database is hosted on dedicated infrastructure in Germany on a hardened host. The
          database is not exposed to the public internet; the application server reaches it over an
          isolated internal network.
        </li>
        <li>
          We back up the database on a rolling schedule. Backups are encrypted with GPG (AES-256)
          before leaving the host and stored on separate off-host storage. The decryption passphrase
          is held outside the production host.
        </li>
        <li>Email code requests are rate-limited.</li>
        <li>Access to production systems follows the principle of least privilege.</li>
      </ul>

      <h2>18. Data breaches</h2>
      <p>
        If a personal-data breach is likely to result in a risk to your rights, we will notify the
        competent supervisory authority within 72 hours under Art. 33 GDPR, and we will notify you
        without undue delay where the risk to your rights is high (Art. 34 GDPR).
      </p>

      <h2>19. Children</h2>
      <p>
        Plainspace is not intended for users under 16. When you create or join a Space you confirm
        that you are at least 16 years old. We do not knowingly collect personal data from anyone
        under 16; if we learn that we have, we will delete the membership.
      </p>

      <h2>20. California residents</h2>
      <p>
        We do not sell or share your personal information as those terms are defined under the
        California Consumer Privacy Act (CCPA / CPRA). If you are a California resident and have a
        CCPA-related request, contact us at{' '}
        <a href="mailto:hello@plainspace.org?subject=Privacy%20request">hello@plainspace.org</a>.
      </p>

      <h2>21. Changes to this policy</h2>
      <p>
        If we change this policy in a way that materially affects how we process your data, we will
        give reasonable advance notice where required and ask you to actively accept the new version
        before you continue using a Space. Minor edits (typo fixes, broken link fixes) take effect
        on publication and we update the "Version" shown at the top of this page.
      </p>
    </LegalPage>
  );
}
