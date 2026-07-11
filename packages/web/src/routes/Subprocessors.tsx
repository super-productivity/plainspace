import { LegalPage } from '../components/ui';

const LAST_UPDATED = '2026-06-11';

export default function Subprocessors() {
  return (
    <LegalPage title="Subprocessors" meta={`Last updated: ${LAST_UPDATED}`}>
      <p>
        This page lists the third-party processors we use to operate Plainspace. For providers that
        process personal data on our behalf, we require a Data Processing Agreement (Art. 28 GDPR).
        Changes to this list do not require a Terms version bump unless they introduce a new
        category of personal data or a new international transfer.
      </p>

      <h2>Hosting & data storage</h2>
      <p>
        <strong>Alfahosting GmbH</strong>
        <br />
        Ankerstraße 3b, 06108 Halle (Saale), Germany
        <br />
        Role: hosting our application server and Postgres database.
        <br />
        Data location: Germany.
        <br />
        DPA: Art. 28 GDPR Auftragsverarbeitungsvertrag concluded via the Alfahosting Kundencenter
        (v2.0, signed 2026-02-02).
      </p>

      <h2>Transactional email</h2>
      <p>
        We send verification and contact-form emails through the mail server configured for
        Plainspace. If we use an external transactional-email provider, it must be added here before
        it processes real user data.
      </p>

      <h2>Web push notifications</h2>
      <p>
        When you set a reminder on a task and grant your browser permission to receive push
        notifications, the browser registers a subscription with its operating system's push
        service. Our server then delivers the reminder through that service. The payload is
        end-to-end encrypted between our server and your browser, so the push service only ever sees
        ciphertext. The decrypted payload contains the Space identifier, the task identifier, and
        the task text (truncated) so the notification can show what the reminder is about. When push
        isn't available (iOS Safari outside a home-screen install, denied permission, or no
        subscription registered), we fall back to email delivered through the transactional-email
        path above.
      </p>
      <p>The push services your browser may use are operated by:</p>
      <ul>
        <li>
          <strong>Google LLC</strong> (Firebase Cloud Messaging) — for Chrome, Edge, Opera, Brave,
          and other Chromium-based browsers. Data location: worldwide (Standard Contractual
          Clauses).
        </li>
        <li>
          <strong>Mozilla Foundation</strong> (autopush) — for Firefox. Data location: United States
          (Standard Contractual Clauses).
        </li>
        <li>
          <strong>Apple Inc.</strong> (Apple Push Notification service) — for Safari and iOS Safari
          installed to the home screen. Data location: worldwide (Standard Contractual Clauses).
        </li>
      </ul>
      <p>
        Which service your browser uses is determined by your browser and operating system, not by
        us. You can revoke push notification permission at any time in your browser settings; doing
        so stops us from contacting your device through that service.
      </p>

      <h2>Other</h2>
      <p>
        We do not use third-party analytics, advertising, error monitoring, or AI processing
        services. Your tasks and scratchpad content stay on infrastructure we operate directly.
      </p>
    </LegalPage>
  );
}
