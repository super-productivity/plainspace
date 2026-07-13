import { createItemViaApi, createProjectViaApi, joinProjectViaApi } from './api';

const API_BASE = `http://localhost:${process.env.E2E_API_PORT ?? '3000'}/api`;

async function createPollViaApi(slug: string, token: string, question: string, options: string[]) {
  const res = await fetch(`${API_BASE}/projects/${slug}/panels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type: 'poll', question, options }),
  });
  if (!res.ok) throw new Error(`Failed to create poll panel: ${res.status} ${await res.text()}`);
}

async function assignItemViaApi(slug: string, token: string, itemId: string, memberId: string) {
  const res = await fetch(`${API_BASE}/projects/${slug}/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ assignedTo: memberId }),
  });
  if (!res.ok) throw new Error(`Failed to assign item: ${res.status} ${await res.text()}`);
}

const ITEMS = [
  'Reserve the mountain hut (2 nights)',
  'Split the grocery list: who brings what',
  'Check the weather forecast for Friday',
  'Print the trail map for Saturday',
  'Confirm carpool: 4 seats, leave 7am',
  'Charge the headlamps + power bank',
];

// Seeds a realistic shared Space (a weekend trip) with several members, a
// populated checklist, and a poll — enough to fill the header avatars, list
// card, panel column, and activity feed for a marketing-quality screenshot.
// Returns the slug plus the creator's identity to inject into localStorage.
export async function seedDemoSpace() {
  const { project, member, token } = await createProjectViaApi('Weekend in the Alps', 'Maya');
  const slug = project.slug;

  const members = [];
  for (const name of ['Liam', 'Noah', 'Ava']) {
    members.push(await joinProjectViaApi(slug, name));
  }

  const itemIds: string[] = [];
  for (const text of ITEMS) {
    const { item } = await createItemViaApi(slug, token, text);
    itemIds.push(item.id);
  }

  // Assign a couple of tasks so the shots show the assignment feature
  // (an assignee avatar on the row).
  await assignItemViaApi(slug, token, itemIds[0], members[0].member.id); // hut → Liam
  await assignItemViaApi(slug, token, itemIds[2], members[1].member.id); // weather → Noah

  await createPollViaApi(slug, token, 'Which trail on Saturday?', [
    'Lake loop (easy, 8km)',
    'Summit ridge (hard, 14km)',
  ]);
  return { slug, identity: { token, memberId: member.id } };
}
