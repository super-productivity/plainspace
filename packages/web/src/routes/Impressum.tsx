import { A } from '@solidjs/router';
import { LegalPage } from '../components/ui';

export default function Impressum() {
  return (
    <LegalPage title="Impressum" meta="Angaben gemäß § 5 DDG">
      <p>
        Johannes Millan
        <br />
        Hauptstraße 4H
        <br />
        10317 Berlin
        <br />
        Deutschland
      </p>

      <h2>Kontakt</h2>
      <p>
        E-Mail: <a href="mailto:hello@plainspace.org">hello@plainspace.org</a>
        <br />
        Kontaktformular: <A href="/contact">plainspace.org/contact</A>
      </p>

      <h2>Umsatzsteuer-ID</h2>
      <p>
        Umsatzsteuer-Identifikationsnummer gemäß § 27a Umsatzsteuergesetz:
        <br />
        DE283361001
      </p>

      <h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
      <p>
        Johannes Millan
        <br />
        Hauptstraße 4H, 10317 Berlin
      </p>

      <h2>Streitschlichtung</h2>
      <p>
        Wir sind nicht verpflichtet und nicht bereit, an einem Streitbeilegungsverfahren vor einer
        Verbraucherschlichtungsstelle teilzunehmen (§ 36 VSBG).
      </p>

      <h2>Haftung für Inhalte</h2>
      <p>
        Als Diensteanbieter sind wir gemäß § 7 Abs. 1 DDG und Art. 4–6 der Verordnung (EU) 2022/2065
        (Digital Services Act) für eigene Inhalte verantwortlich. Wir sind jedoch nicht
        verpflichtet, von Nutzern übermittelte oder gespeicherte fremde Informationen zu überwachen
        oder nach Umständen zu forschen, die auf eine rechtswidrige Tätigkeit hinweisen (Art. 8
        DSA). Kontaktstellen nach Art. 11 und 12 DSA sowie Meldungen nach Art. 16 DSA erreichen uns
        unter <a href="mailto:hello@plainspace.org?subject=DSA%20notice">hello@plainspace.org</a>.
        Wir akzeptieren Deutsch und Englisch.
      </p>
    </LegalPage>
  );
}
