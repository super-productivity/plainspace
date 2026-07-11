import { createSignal, type Accessor } from 'solid-js';
import { getMemberId } from './identity';

// The saved member id for a Space, as a signal callers refresh after writing
// identity for the *same* slug — the `#claim=<token>.<memberId>` device hand-off
// does exactly that. A plain memo keyed on the slug would miss a same-slug
// localStorage write and leave the current member unresolved until a reload.
export function createMemberId(slug: string): {
  myId: Accessor<string | null>;
  refresh: (slug: string) => void;
} {
  const [myId, setMyId] = createSignal(getMemberId(slug));
  return { myId, refresh: (s) => setMyId(getMemberId(s)) };
}
