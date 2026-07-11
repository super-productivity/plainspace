const API_BASE = `http://localhost:${process.env.E2E_API_PORT ?? '3000'}/api`;

type ProjectFixture = { slug: string };
type MemberFixture = { id: string };
type ProjectApiResult = { project: ProjectFixture; member: MemberFixture; token: string };
type JoinApiResult = { member: MemberFixture; token: string };
type ItemApiResult = { item: { id: string } };

export async function expectOkJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  const body = text ? parseResponseBody(text) : undefined;

  if (!res.ok) {
    const bodyText = typeof body === 'string' ? body : JSON.stringify(body);
    throw new Error(
      `API request failed with ${res.status} ${res.statusText}${bodyText ? `: ${bodyText}` : ''}`,
    );
  }

  return body as T;
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  return expectOkJson<T>(res);
}

function parseResponseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function createProjectViaApi(name: string, displayName: string, email?: string) {
  return apiRequest<ProjectApiResult>('/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      purpose: '',
      displayName,
      email: email ?? `${displayName.toLowerCase().replace(/\s+/g, '')}-${Date.now()}@test.local`,
    }),
  });
}

export async function joinProjectViaApi(slug: string, displayName: string) {
  return apiRequest<JoinApiResult>(`/projects/${slug}/members/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName }),
  });
}

export async function createItemViaApi(slug: string, token: string, text: string) {
  return apiRequest<ItemApiResult>(`/projects/${slug}/items`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ text }),
  });
}

export async function uploadAttachmentViaApi(
  slug: string,
  token: string,
  itemId: string,
  filename: string,
  content: string,
  mimeType = 'text/plain',
) {
  const blob = new Blob([content], { type: mimeType });
  const formData = new FormData();
  formData.append('file', blob, filename);
  return apiRequest<unknown>(`/projects/${slug}/items/${itemId}/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
}

export async function verifyMemberViaApi(slug: string, token: string, email: string) {
  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const { devCode } = await apiRequest<{ devCode?: string }>(
    `/projects/${slug}/auth/request-verification`,
    {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ email }),
    },
  );

  if (!devCode) {
    throw new Error(`Verification request for ${email} in ${slug} did not return a devCode`);
  }

  await apiRequest<unknown>(`/projects/${slug}/auth/verify`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ code: devCode }),
  });
}
