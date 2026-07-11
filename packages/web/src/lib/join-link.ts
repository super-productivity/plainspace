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

export async function shareJoinLink(slug: string, projectName: string): Promise<void> {
  const url = `${window.location.origin}/${slug}/join`;
  if (navigator.share) {
    try {
      await navigator.share({
        title: `Join ${projectName} on Plainspace`,
        text: `Join me in “${projectName}” on Plainspace.`,
        url,
      });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  await copyJoinLink(slug);
}
