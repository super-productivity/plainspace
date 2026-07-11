import { describe, expect, it } from 'vitest';
import { MAX_MEMBERS_PER_PROJECT, MEMBER_COLORS } from '@plainspace/shared';
import { createApp } from '../app.js';
import { db } from '../db/connection.js';
import { members } from '../db/schema.js';
import { createProject } from '../../test/helpers.js';

const app = createApp();
const connEnv = {
  incoming: { socket: { remoteAddress: '198.51.100.50', remotePort: 1234, remoteFamily: 'IPv4' } },
} as unknown as Parameters<typeof app.request>[2];

describe('POST /api/projects/:slug/members/join — project size bound', () => {
  it('rejects an anonymous join once the member snapshot reaches its ceiling', async () => {
    const { project } = await createProject();
    await db.insert(members).values(
      Array.from({ length: MAX_MEMBERS_PER_PROJECT }, (_, index) => ({
        projectId: project.id,
        displayName: `Member ${index}`,
        color: MEMBER_COLORS[index % MEMBER_COLORS.length],
        avatarIndex: index % MEMBER_COLORS.length,
      })),
    );

    const res = await app.request(
      `/api/projects/${project.slug}/members/join`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'One too many' }),
      },
      connEnv,
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: `A Space can have at most ${MAX_MEMBERS_PER_PROJECT} members`,
    });
  });

  it('allows only one concurrent join to claim the final member slot', async () => {
    const { project } = await createProject();
    await db.insert(members).values(
      Array.from({ length: MAX_MEMBERS_PER_PROJECT - 1 }, (_, index) => ({
        projectId: project.id,
        displayName: `Member ${index}`,
        color: MEMBER_COLORS[index % MEMBER_COLORS.length],
        avatarIndex: index % MEMBER_COLORS.length,
      })),
    );

    const join = (displayName: string) =>
      app.request(
        `/api/projects/${project.slug}/members/join`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName }),
        },
        connEnv,
      );
    const responses = await Promise.all([join('Final member A'), join('Final member B')]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 422]);
    const persisted = await db.query.members.findMany({
      where: (member, { eq }) => eq(member.projectId, project.id),
    });
    expect(persisted).toHaveLength(MAX_MEMBERS_PER_PROJECT);
  });
});
