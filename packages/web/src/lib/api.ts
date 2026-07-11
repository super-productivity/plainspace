import { getToken } from './identity';
import type {
  ActivityEntry,
  ActivityFeedResponse,
  ApiToken,
  Attachment,
  ConnectResponse,
  ContactMessageResponse,
  CreateProjectResponse,
  ErrorResponse,
  Item,
  JoinProjectResponse,
  List,
  Member,
  MySpacesResponse,
  NudgeResponse,
  PanelView,
  Project,
  ProjectLoadResponse,
  PushSubscriptionInput,
  Scratchpad,
  UpdateItemInput,
  VerifyLoginCodeResponse,
} from '@plainspace/shared';

const BASE = '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: ErrorResponse,
  ) {
    super(body.error);
  }
}

export interface ProjectInfoResponse {
  name: string;
  purpose: string;
  sharingMode: Project['sharingMode'];
}

export interface ProjectSummaryResponse {
  name: string;
  purpose: string;
  members: Member[];
}

export interface MemberResponse {
  member: Member;
}

// connect-verified either just verifies the caller's email (member only) or, on
// a collision, merges into the canonical member (member + a rotated token).
export interface ConnectVerifiedResponse {
  member: Member;
  token?: string;
}

export interface ListResponse {
  list: List;
}

export interface ItemWithActivityResponse {
  item: Item;
  // Absent on PATCHes that record no activity (reorder, move, remind).
  activity?: ActivityEntry;
}

export interface ScratchpadResponse {
  scratchpad: Scratchpad;
}

export interface ProjectResponse {
  project: Project;
}

export interface TermsStatusResponse {
  project: Project;
  terms: ProjectLoadResponse['terms'];
}

export interface AttachmentResponse {
  attachment: Attachment;
}

export interface RequestVerificationResponse {
  message: string;
  devCode?: string;
}

export interface FindSpacesResponse {
  message: string;
  // dev-only echo; `code` lets tests build the magic recovery link.
  devSpaces?: { slug: string; name: string; code?: string }[];
}

export interface CreateApiTokenResponse {
  token: string;
  apiToken: ApiToken;
}

export interface GetApiTokenResponse {
  token: ApiToken | null;
}

async function request<T>(path: string, options: RequestInit = {}, slug?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (slug) {
    const token = getToken(slug);
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body: ErrorResponse = await res
      .json()
      .catch(() => ({ error: 'Request failed' }) satisfies ErrorResponse);
    throw new ApiError(res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  // Public auth (gates project creation)
  requestCreationCode: (data: { email: string }) =>
    request<RequestVerificationResponse>('/auth/request-creation-code', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Recovery: email the address owner the list of Spaces they belong to.
  findSpaces: (data: { email: string }) =>
    request<FindSpacesResponse>('/auth/find-spaces', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Returning-user integration mint: email + code → a key for an existing
  // membership (no duplicate Space). A 404 with body.code 'no-account' means the
  // web should fall back to createProject with the same code.
  connect: (data: { email: string; code: string; force?: boolean }) =>
    request<ConnectResponse>('/auth/connect', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  contact: (data: {
    name?: string;
    email: string;
    category: 'general' | 'bug' | 'privacy' | 'legal' | 'dsa-notice';
    message: string;
  }) =>
    request<ContactMessageResponse>('/contact', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  submitDsaNotice: (data: {
    contentLocation: string;
    projectSlug?: string;
    itemId?: string;
    attachmentId?: string;
    category: 'copyright' | 'defamation' | 'hate-speech' | 'csam' | 'illegal-product' | 'other';
    reason: string;
    submitterName?: string;
    submitterEmail?: string;
    goodFaithConfirmed: true;
  }) =>
    request<{ noticeId: string }>('/dsa/notice', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Projects
  createProject: (data: {
    name: string;
    purpose?: string;
    displayName: string;
    email: string;
    code?: string;
    proofToken?: string;
  }) => request<CreateProjectResponse>('/projects', { method: 'POST', body: JSON.stringify(data) }),

  getProject: (slug: string, signal?: AbortSignal) =>
    request<ProjectLoadResponse>(`/projects/${slug}`, { signal }, slug),

  // Members
  joinProject: (slug: string, data: { displayName: string }) =>
    request<JoinProjectResponse>(`/projects/${slug}/members/join`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateMember: (slug: string, data: { displayName: string }) =>
    request<MemberResponse>(
      `/projects/${slug}/members/me`,
      { method: 'PATCH', body: JSON.stringify(data) },
      slug,
    ),

  deleteSelf: (slug: string) =>
    request<void>(`/projects/${slug}/members/me`, { method: 'DELETE' }, slug),

  // GDPR Art. 15/20 export. Returns the raw JSON blob so the caller can offer
  // it as a file download; uses fetch directly because `request` parses JSON.
  exportSelf: async (slug: string): Promise<Blob> => {
    const token = getToken(slug);
    const res = await fetch(`${BASE}/projects/${slug}/members/me/export`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const body: ErrorResponse = await res
        .json()
        .catch(() => ({ error: 'Export failed' }) satisfies ErrorResponse);
      throw new ApiError(res.status, body);
    }
    return res.blob();
  },

  // List (single per project)
  updateList: (
    slug: string,
    listId: string,
    data: { columns?: Array<{ id: string; name: string }> | null },
  ) =>
    request<ListResponse>(
      `/projects/${slug}/lists/${listId}`,
      { method: 'PATCH', body: JSON.stringify(data) },
      slug,
    ),

  // Items. `listId` targets a checklist panel's list; omit it for the hero list.
  createItem: (slug: string, data: { text: string; listId?: string }) =>
    request<ItemWithActivityResponse>(
      `/projects/${slug}/items`,
      { method: 'POST', body: JSON.stringify(data) },
      slug,
    ),

  updateItem: (slug: string, itemId: string, data: UpdateItemInput) =>
    request<ItemWithActivityResponse>(
      `/projects/${slug}/items/${itemId}`,
      { method: 'PATCH', body: JSON.stringify(data) },
      slug,
    ),

  deleteItem: (slug: string, itemId: string) =>
    request<void>(`/projects/${slug}/items/${itemId}`, { method: 'DELETE' }, slug),

  restoreItem: (slug: string, itemId: string) =>
    request<ItemWithActivityResponse>(
      `/projects/${slug}/items/${itemId}/restore`,
      { method: 'POST' },
      slug,
    ),

  // Activity
  getActivity: (slug: string, beforeId?: string, signal?: AbortSignal) =>
    request<ActivityFeedResponse>(
      `/projects/${slug}/activity${beforeId ? `?beforeId=${encodeURIComponent(beforeId)}` : ''}`,
      { signal },
      slug,
    ),

  // Nudge
  getNudge: (slug: string) => request<NudgeResponse>(`/projects/${slug}/nudge`, {}, slug),

  // Scratchpad (single per project)
  updateScratchpad: (slug: string, padId: string, data: { content: string }) =>
    request<ScratchpadResponse>(
      `/projects/${slug}/scratchpads/${padId}`,
      { method: 'PATCH', body: JSON.stringify(data) },
      slug,
    ),

  setScratchpadEditing: (slug: string, padId: string, editing: boolean) =>
    request<void>(
      `/projects/${slug}/scratchpads/${padId}/editing`,
      {
        method: 'POST',
        body: JSON.stringify({ editing }),
      },
      slug,
    ),

  // Panels + Polls. All non-optimistic; the server's SSE echo updates the
  // store. `request<void>` for the 204 endpoints; `slug` is passed so the
  // Authorization header is attached.
  createPanel: (
    slug: string,
    data:
      | { type: 'poll'; question: string; options: string[] }
      | { type: 'timeslot'; title: string; slots: string[] }
      | { type: 'checklist'; title: string },
  ) =>
    request<{ panel: PanelView }>(
      `/projects/${slug}/panels`,
      { method: 'POST', body: JSON.stringify(data) },
      slug,
    ),

  updatePanel: (slug: string, panelId: string, data: { title: string }) =>
    request<{ panel: PanelView }>(
      `/projects/${slug}/panels/${panelId}`,
      { method: 'PATCH', body: JSON.stringify(data) },
      slug,
    ),

  deletePanel: (slug: string, panelId: string) =>
    request<void>(`/projects/${slug}/panels/${panelId}`, { method: 'DELETE' }, slug),

  votePoll: (slug: string, panelId: string, optionId: string | null) =>
    request<void>(
      `/projects/${slug}/panels/${panelId}/vote`,
      { method: 'POST', body: JSON.stringify({ optionId }) },
      slug,
    ),

  respondTimeSlot: (slug: string, panelId: string, slotId: string, available: boolean) =>
    request<void>(
      `/projects/${slug}/panels/${panelId}/respond`,
      { method: 'POST', body: JSON.stringify({ slotId, available }) },
      slug,
    ),

  // Attachments
  uploadAttachment: async (
    slug: string,
    itemId: string,
    file: File,
  ): Promise<AttachmentResponse> => {
    const token = getToken(slug);
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`/api/projects/${slug}/items/${itemId}/attachments`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    if (!res.ok) {
      const body: ErrorResponse = await res
        .json()
        .catch(() => ({ error: 'Request failed' }) satisfies ErrorResponse);
      throw new ApiError(res.status, body);
    }
    return res.json() as Promise<AttachmentResponse>;
  },

  deleteAttachment: (slug: string, attachmentId: string) =>
    request<void>(`/projects/${slug}/attachments/${attachmentId}`, { method: 'DELETE' }, slug),

  // Project info (unauthenticated)
  getProjectInfo: (slug: string) => request<ProjectInfoResponse>(`/projects/${slug}/info`, {}),

  // Lightweight summary for landing page (authenticated)
  getProjectSummary: (slug: string) =>
    request<ProjectSummaryResponse>(`/projects/${slug}/summary`, {}, slug),

  // Web Push
  getPushPublicKey: () => request<{ key: string | null }>('/push/public-key', {}),

  updatePushSubscription: (slug: string, body: PushSubscriptionInput) =>
    request<void>(
      `/projects/${slug}/push/subscription`,
      { method: 'PUT', body: JSON.stringify(body) },
      slug,
    ),

  // Auth & Verification
  requestVerification: (slug: string, data: { email: string }) =>
    request<RequestVerificationResponse>(
      `/projects/${slug}/auth/request-verification`,
      { method: 'POST', body: JSON.stringify(data) },
      slug,
    ),

  verifyCode: (slug: string, data: { code: string }) =>
    request<MemberResponse>(
      `/projects/${slug}/auth/verify`,
      { method: 'POST', body: JSON.stringify(data) },
      slug,
    ),

  // Confirm the merge surfaced by verifyCode (ApiError code 'merge-available').
  // Returns the canonical member + a fresh token; the browser then re-saves its
  // identity as that member.
  verifyMerge: (slug: string, data: { code: string }) =>
    request<JoinProjectResponse>(
      `/projects/${slug}/auth/verify-merge`,
      { method: 'POST', body: JSON.stringify(data) },
      slug,
    ),

  // Connect the caller's email to this Space using a proof token (a member token
  // from another verified Space) instead of an emailed code.
  connectVerified: (slug: string, data: { proofToken: string }) =>
    request<ConnectVerifiedResponse>(
      `/projects/${slug}/auth/connect-verified`,
      { method: 'POST', body: JSON.stringify(data) },
      slug,
    ),

  // Recovery / returning-user login
  requestLoginCode: (slug: string, data: { email: string }) =>
    request<RequestVerificationResponse>(`/projects/${slug}/auth/request-login-code`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  verifyLoginCode: (slug: string, data: { email: string; code: string }) =>
    request<VerifyLoginCodeResponse>(`/projects/${slug}/auth/verify-login-code`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Every Space the caller's verified email belongs to (authenticated).
  mySpaces: (slug: string) =>
    request<MySpacesResponse>(`/projects/${slug}/auth/my-spaces`, {}, slug),

  logoutSession: (slug: string) =>
    request<void>(`/projects/${slug}/auth/session`, { method: 'DELETE' }, slug),

  getTermsStatus: (slug: string, signal?: AbortSignal) =>
    request<TermsStatusResponse>(`/projects/${slug}/auth/terms-status`, { signal }, slug),

  acceptTerms: (slug: string, signal?: AbortSignal) =>
    request<MemberResponse>(
      `/projects/${slug}/auth/accept-terms`,
      { method: 'POST', signal },
      slug,
    ),

  // Project settings
  updateSettings: (slug: string, data: { sharingMode?: Project['sharingMode'] }) =>
    request<ProjectResponse>(
      `/projects/${slug}/auth/settings`,
      { method: 'PATCH', body: JSON.stringify(data) },
      slug,
    ),

  // Permanently delete the whole Space (creator only).
  deleteSpace: (slug: string) =>
    request<void>(`/projects/${slug}/auth/space`, { method: 'DELETE' }, slug),

  // Member management
  removeMember: (
    slug: string,
    memberId: string,
    options?: { reason?: string; language?: 'en' | 'de' },
  ) =>
    request<void>(
      `/projects/${slug}/auth/members/${memberId}`,
      {
        method: 'DELETE',
        ...(options?.reason
          ? { body: JSON.stringify({ reason: options.reason, language: options.language ?? 'en' }) }
          : {}),
      },
      slug,
    ),

  updateMemberRole: (slug: string, memberId: string, data: { role: Member['role'] }) =>
    request<MemberResponse>(
      `/projects/${slug}/auth/members/${memberId}/role`,
      { method: 'POST', body: JSON.stringify(data) },
      slug,
    ),

  // API Token (external integrations — one active token per email)
  createApiToken: (slug: string) =>
    request<CreateApiTokenResponse>(`/projects/${slug}/auth/api-tokens`, { method: 'POST' }, slug),

  getApiToken: (slug: string) =>
    request<GetApiTokenResponse>(`/projects/${slug}/auth/api-tokens`, {}, slug),

  revokeApiToken: (slug: string) =>
    request<void>(`/projects/${slug}/auth/api-tokens`, { method: 'DELETE' }, slug),
};
