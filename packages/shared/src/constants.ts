import type { KanbanColumn } from './types.js';

// Warm, desaturated hues that sit inside the parchment/terracotta palette
// (avatars render these mixed toward the surface color, so mid-saturation
// tones keep enough identity without going neon). Warmest first so small
// Spaces stay warmest.
export const MEMBER_COLORS = [
  '#C0584A', // clay
  '#D08A3E', // ochre
  '#7E8B4F', // olive
  '#3F7473', // teal
  '#9A6AA0', // plum
  '#58879E', // dusty blue
  '#C97B62', // copper
  '#5F8F5C', // moss
  '#B0688A', // rose
  '#BFA431', // mustard
  '#6E6A9E', // indigo
  '#8C6D5A', // umber
] as const;

export const MAX_PROJECT_NAME_LENGTH = 100;
export const MAX_PURPOSE_LENGTH = 280;
export const MAX_DISPLAY_NAME_LENGTH = 40;
export const MAX_ITEM_TEXT_LENGTH = 500;
export const MAX_MEMBERS_PER_PROJECT = 100;
// Project bootstrap returns active items as one snapshot. Keep that response
// bounded until the product introduces incremental item loading.
export const MAX_ITEMS_PER_PROJECT = 500;

export const SSE_KEEPALIVE_MS = 30_000;

export const POSITION_GAP = 1000;

export const SLUG_LENGTH = 22;
export const TOKEN_LENGTH = 21;

export const AVATAR_COUNT = MEMBER_COLORS.length;

export const ACTIVITY_PAGE_SIZE = 30;

export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const ALLOWED_ATTACHMENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
] as const;
export const MAX_ATTACHMENTS_PER_ITEM = 5;

// Panels framework + Polls
export const MAX_POLL_QUESTION_LENGTH = 280;
export const MAX_POLL_OPTION_LENGTH = 200;
export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 10;
export const MAX_PANELS_PER_PROJECT = 20;

// TimeSlot (availability poll). MAX_PANELS_PER_PROJECT is shared across types.
export const MAX_TIMESLOT_TITLE_LENGTH = 280;
export const MAX_TIMESLOT_SLOT_LENGTH = 80;
export const MIN_TIMESLOT_SLOTS = 2;
export const MAX_TIMESLOT_SLOTS = 15;

// Checklist: a lightweight secondary task list rendered as a side panel. Its
// items are real `items` rows in a per-panel list, so they reuse
// MAX_ITEM_TEXT_LENGTH; only the title is checklist-specific. The shared
// MAX_ITEMS_PER_PROJECT ceiling covers the primary list and all checklists.
export const MAX_CHECKLIST_TITLE_LENGTH = 280;

export const API_TOKEN_PREFIX = 'pat_';
export const API_TOKEN_LENGTH = 40;
export const API_TOKEN_EXPIRY_DAYS = 365;

// Emailed 6-digit code timings, shared so web countdowns/expiry checks stay in
// lockstep with the server that mints and rate-limits the codes (login recovery,
// email verification, Space creation, connect). Single source — don't re-declare.
export const CODE_EXPIRY_MS = 10 * 60 * 1000; // code valid for 10 minutes
export const CODE_REQUEST_WINDOW_MS = 2 * 60 * 1000; // 1 code per 2 min per email

// Bump when Terms or Privacy Policy change materially.
// Stored on each member at signup; used to detect when re-acceptance is needed.
export const TOS_VERSION = '2026-06-01';

export const DEFAULT_KANBAN_COLUMNS: KanbanColumn[] = [
  { id: 'todo', name: 'To Do' },
  { id: 'in_progress', name: 'In Progress' },
  { id: 'done', name: 'Done' },
];
