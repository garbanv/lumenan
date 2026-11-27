import { randomUUID } from 'node:crypto';
import { slugify } from './slug';

// 8 hex chars of a random UUID, appended to the readable slug so IDs aren't guessable
// ("my-blog-3f9a1c7e" instead of just "my-blog"). Total length stays <= 48.
export function generateSiteId(name: string, domain: string): string {
  const base = (slugify(name) || slugify(domain) || 'site').slice(0, 39).replace(/-+$/, '');
  return `${base}-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}
