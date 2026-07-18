import { createResource, createSignal, Show } from 'solid-js';
import QRCode from 'qrcode';
import { buildClaimUrl, getToken } from '../../lib/identity';
import { copyText } from '../../lib/clipboard';
import { Button } from '../ui';
import styles from './DeviceLink.module.css';

interface DeviceLinkProps {
  slug: string;
  myId: string;
}

export default function DeviceLink(props: DeviceLinkProps) {
  const [shown, setShown] = createSignal(false);
  const [copied, setCopied] = createSignal(false);

  const claimUrl = () => {
    const token = getToken(props.slug);
    if (!token) return null;
    return buildClaimUrl(props.slug, token, props.myId);
  };

  // Only generate the QR after the user clicks "Show" so the image isn't
  // rendered into the DOM for any onlooker.
  const [qrDataUrl] = createResource(
    () => (shown() ? claimUrl() : null),
    async (url) => QRCode.toDataURL(url, { margin: 1, width: 400 }),
  );

  async function copyLink() {
    const url = claimUrl();
    if (!url) return;
    // On failure the QR stays available to scan, so we just leave the label as-is.
    if (await copyText(url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div class={styles.section} data-testid="device-link-section">
      <h4 class={styles.heading}>Open on another device</h4>
      <p class={styles.hint}>
        Scan this QR on your phone, or copy the link, to open this Space as you.
      </p>

      <Show
        when={shown()}
        fallback={
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setShown(true)}
            data-testid="device-link-reveal-button"
          >
            Show QR code
          </Button>
        }
      >
        <div class={styles.reveal}>
          <div class={styles.qr}>
            <Show when={qrDataUrl()}>
              <img src={qrDataUrl()} alt="Device link QR code" data-testid="device-link-qr" />
            </Show>
          </div>
          <p class={styles.warning}>Anyone with this code can use your access. Don't share it.</p>
          <div class={styles.actions}>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={copyLink}
              data-testid="device-link-copy-button"
            >
              {copied() ? 'Copied' : 'Copy link'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setShown(false)}>
              Hide
            </Button>
          </div>
        </div>
      </Show>
    </div>
  );
}
