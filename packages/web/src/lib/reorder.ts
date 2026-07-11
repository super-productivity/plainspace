import { POSITION_GAP, type Item } from '@plainspace/shared';

// Concurrent reorders can compute the same midpoint for two different items
// (the server stores client-supplied positions verbatim), so ties are real.
// The id tie-break keeps the order deterministic and identical on every
// client; without it, tied items render in arrival order, which differs per
// browser and never reconverges. Code-unit comparison, not localeCompare:
// the latter follows the host locale, which would defeat the cross-client
// guarantee.
export function byPosition(a: Item, b: Item): number {
  return a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Compute the new `position` for an item dropped between two neighbors.
 *
 * Positions are gap-based integers (server validates `> 0`). The common case
 * is a single midpoint write; only when the gap between neighbors is exhausted
 * (or a top-drop would land at 0) do we fall back to renumbering every open
 * item — rare, since a fresh gap of 1000 survives ~10 repeated bisections at
 * the same spot.
 *
 * @param sorted   open items in their NEW visual order (dragged row already moved)
 * @param prevId   id of the row now above the dragged row, or null if it's first
 * @param nextId   id of the row now below the dragged row, or null if it's last
 */
export function computeReorderPosition(
  sorted: Item[],
  prevId: string | null,
  nextId: string | null,
): { kind: 'single'; position: number } | { kind: 'renumber'; positions: Map<string, number> } {
  const prev = prevId ? sorted.find((i) => i.id === prevId) : null;
  const next = nextId ? sorted.find((i) => i.id === nextId) : null;

  if (prev && next) {
    const position = Math.floor((prev.position + next.position) / 2);
    if (position === prev.position || position === next.position) return renumber(sorted);
    return { kind: 'single', position };
  }
  if (next) {
    // Dropped at the top. Server requires a positive integer, so a midpoint
    // that floors to 0 means the gap above the first row is exhausted.
    const position = Math.floor(next.position / 2);
    if (position < 1) return renumber(sorted);
    return { kind: 'single', position };
  }
  if (prev) {
    // Dropped at the bottom: always room for one more gap.
    return { kind: 'single', position: prev.position + POSITION_GAP };
  }
  // Empty list around the drop (shouldn't happen for a real move) — renumber.
  return renumber(sorted);
}

function renumber(sorted: Item[]): { kind: 'renumber'; positions: Map<string, number> } {
  const positions = new Map<string, number>();
  sorted.forEach((item, index) => positions.set(item.id, (index + 1) * POSITION_GAP));
  return { kind: 'renumber', positions };
}
