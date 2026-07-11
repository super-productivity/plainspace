import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { db } from '../db/connection.js';
import { activity } from '../db/schema.js';
import { authedMember, createProject } from '../../test/helpers.js';

const app = createApp();

async function getActivity(slug: string, token: string, query: string): Promise<Response> {
  return app.request(`/api/projects/${slug}/activity?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe('GET /api/projects/:slug/activity — stable cursor', () => {
  it('pages every entry exactly once when timestamps are identical', async () => {
    const { project } = await createProject();
    const { member, token } = await authedMember(project.id);
    const createdAt = new Date('2026-07-10T10:00:00.123Z');

    await db.insert(activity).values(
      Array.from({ length: 4 }, (_, index) => ({
        projectId: project.id,
        memberId: member.id,
        action: 'item.created',
        targetType: 'item',
        targetId: randomUUID(),
        meta: { text: `Entry ${index}` },
        createdAt,
      })),
    );

    const first = await getActivity(project.slug, token, 'limit=2');
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      entries: { id: string }[];
      hasMore: boolean;
    };
    expect(firstBody.entries).toHaveLength(2);
    expect(firstBody.hasMore).toBe(true);

    const second = await getActivity(
      project.slug,
      token,
      `limit=2&beforeId=${firstBody.entries.at(-1)!.id}`,
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      entries: { id: string }[];
      hasMore: boolean;
    };

    expect(secondBody.entries).toHaveLength(2);
    expect(secondBody.hasMore).toBe(false);
    expect(
      new Set([...firstBody.entries, ...secondBody.entries].map((entry) => entry.id)).size,
    ).toBe(4);
  });

  it('rejects a malformed activity id cursor', async () => {
    const { project } = await createProject();
    const { token } = await authedMember(project.id);

    const res = await getActivity(project.slug, token, 'beforeId=not-a-uuid');

    expect(res.status).toBe(400);
  });
});
