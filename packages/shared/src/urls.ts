export function projectUrl(origin: string, slug: string): string {
  return `${origin}/${slug}`;
}

export function itemUrl(origin: string, slug: string, itemId: string): string {
  return `${origin}/${slug}/item/${itemId}`;
}
