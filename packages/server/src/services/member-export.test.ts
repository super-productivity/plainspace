import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { activity, items, panels, pollVotes, timeslotResponses } from '../db/schema.js';
import { buildMemberExport } from './member-export.js';
import { addItem, addMember, createProject } from '../../test/helpers.js';

describe('buildMemberExport', () => {
  it('returns the member, decrypts their email, and includes only their own contributions', async () => {
    const { project, listId } = await createProject();
    const me = await addMember(project.id, { email: 'me@example.com' });
    const other = await addMember(project.id, { displayName: 'Someone Else' });

    const mine = await addItem(listId, project.id, { text: 'my task' });
    const theirs = await addItem(listId, project.id, { text: 'their task' });
    await db.update(items).set({ createdBy: me.id }).where(eq(items.id, mine.id));
    await db.update(items).set({ createdBy: other.id }).where(eq(items.id, theirs.id));

    const [panel] = await db
      .insert(panels)
      .values({ projectId: project.id, type: 'poll', createdBy: me.id })
      .returning();
    await db.insert(pollVotes).values({ panelId: panel.id, optionId: 'a', memberId: me.id });
    await db
      .insert(timeslotResponses)
      .values({ panelId: panel.id, slotId: 'mon', memberId: me.id });
    await db.insert(activity).values({
      projectId: project.id,
      memberId: me.id,
      action: 'item.created',
      targetType: 'item',
      targetId: mine.id,
    });

    const exported = await buildMemberExport(project, me);

    expect(exported.member.email).toBe('me@example.com');
    expect(exported.space.slug).toBe(project.slug);

    const itemTexts = exported.contributions.items.map((i) => i.text);
    expect(itemTexts).toEqual(['my task']);
    expect(itemTexts).not.toContain('their task');

    expect(exported.contributions.panels.map((p) => p.id)).toEqual([panel.id]);
    expect(exported.contributions.pollVotes).toHaveLength(1);
    expect(exported.contributions.timeslotResponses).toHaveLength(1);
    expect(exported.contributions.timeslotResponses[0].slotId).toBe('mon');
    expect(exported.contributions.activity).toHaveLength(1);
  });

  it('returns a null email for a display-name-only member', async () => {
    const { project } = await createProject();
    const anon = await addMember(project.id, { displayName: 'No Email' });

    const exported = await buildMemberExport(project, anon);

    expect(exported.member.email).toBeNull();
    expect(exported.contributions.items).toHaveLength(0);
  });
});
