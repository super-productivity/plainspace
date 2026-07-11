import { addToast } from './toast';

export async function copyJoinLink(slug: string): Promise<void> {
  const link = `${window.location.origin}/${slug}/join`;
  try {
    await navigator.clipboard.writeText(link);
    addToast('Join link copied. Anyone with this link can join this Space.');
  } catch {
    addToast('Could not copy link');
  }
}
