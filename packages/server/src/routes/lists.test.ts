import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { authedMember, createProject } from '../../test/helpers.js';

const app = createApp();

async function patchList(
  slug: string,
  listId: string,
  token: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.request(`/api/projects/${slug}/lists/${listId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/projects/:slug/lists/:listId', () => {
  it('returns the current list for an empty body instead of 500ing on .set({})', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);

    const res = await patchList(project.slug, listId, token, {});

    expect(res.status).toBe(200);
    const { list } = await res.json();
    expect(list.id).toBe(listId);
    expect(list.columns).toEqual([{ id: 'todo', name: 'To do' }]);
  });

  it('updates columns', async () => {
    const { project, listId } = await createProject();
    const { token } = await authedMember(project.id);
    const columns = [{ id: 'doing', name: 'Doing' }];

    const res = await patchList(project.slug, listId, token, { columns });

    expect(res.status).toBe(200);
    expect((await res.json()).list.columns).toEqual(columns);
  });
});
