import { z } from 'zod';
import {
  MAX_PROJECT_NAME_LENGTH,
  MAX_PURPOSE_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_ITEM_TEXT_LENGTH,
  MAX_POLL_QUESTION_LENGTH,
  MAX_POLL_OPTION_LENGTH,
  MIN_POLL_OPTIONS,
  MAX_POLL_OPTIONS,
  MAX_TIMESLOT_TITLE_LENGTH,
  MAX_TIMESLOT_SLOT_LENGTH,
  MIN_TIMESLOT_SLOTS,
  MAX_TIMESLOT_SLOTS,
  MAX_CHECKLIST_TITLE_LENGTH,
} from './constants.js';

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(MAX_PROJECT_NAME_LENGTH),
  purpose: z.string().max(MAX_PURPOSE_LENGTH).default(''),
  displayName: z.string().min(1).max(MAX_DISPLAY_NAME_LENGTH),
  email: z.string().email().max(255),
  // 6-digit code from POST /api/auth/request-creation-code. Required in
  // production; ignored when the server is running in dev mode.
  code: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  // An existing per-Space member token from another Space. When it belongs to a
  // member whose verified email matches `email`, it stands in for the creation
  // code so a returning user creates further Spaces without one.
  proofToken: z.string().min(1).max(200).optional(),
});

// Create a Space from an integration PAT (POST /api/integration/spaces). No
// email/code fields: the PAT already proves email ownership. displayName is
// optional and defaults to the email local-part server-side when omitted.
export const CreateSpaceViaTokenSchema = z.object({
  name: z.string().min(1).max(MAX_PROJECT_NAME_LENGTH),
  purpose: z.string().max(MAX_PURPOSE_LENGTH).default(''),
  displayName: z.string().min(1).max(MAX_DISPLAY_NAME_LENGTH).optional(),
});

// Create a task in a bound Space from an integration PAT
// (POST /api/integration/tasks). `spaceId` is the Space id OR slug (SP stores
// either as `cfg.spaceId`); the server intersects it with the caller's
// membership. `title` becomes the item text on the Space's primary (hero) list.
export const CreateTaskViaTokenSchema = z.object({
  spaceId: z.string().min(1).max(255),
  title: z.string().min(1).max(MAX_ITEM_TEXT_LENGTH),
});

export const RequestCreationCodeSchema = z.object({
  email: z.string().email().max(255),
});

// Mint an integration key for a RETURNING user (existing membership) straight
// from email + a 6-digit creation code (POST /api/auth/connect). `force` opts
// into replacing an already-active key (the never-silent reconnect path).
export const ConnectRequestSchema = z.object({
  email: z.string().email().max(255),
  code: z.string().regex(/^\d{6}$/),
  force: z.boolean().optional(),
});

export const JoinProjectSchema = z.object({
  displayName: z.string().min(1).max(MAX_DISPLAY_NAME_LENGTH),
});

export const UpdateListSchema = z.object({
  columns: z
    .array(
      z.object({
        id: z.string().min(1).max(50),
        name: z.string().min(1).max(50),
      }),
    )
    .min(1)
    .max(20)
    .nullable()
    .optional(),
});

export const CreateItemSchema = z.object({
  text: z.string().min(1).max(MAX_ITEM_TEXT_LENGTH),
  columnId: z.string().min(1).max(50).optional(),
  // Target list. Omitted ⇒ the project's primary (hero) list. Set to a
  // checklist panel's list to add an item there. The server validates it
  // belongs to this project.
  listId: z.string().uuid().optional(),
});

const WEEKDAY_TOKENS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

// Reject unknown IANA zones by construction. ICU canonicalization differs
// across engines (a browser may send `Europe/Kiev` where Node 22 lists only
// `Europe/Kyiv`), so set-membership in `Intl.supportedValuesOf` would 422
// legitimate clients; the constructor accepts aliases.
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// The rule WITHOUT `anchor` — the server owns the anchor (DTSTART) and stamps
// it from the effective remindAt. Any client-sent anchor is dropped here.
export const RepeatRuleInputSchema = z
  .object({
    freq: z.enum(['daily', 'weekly', 'monthly']),
    interval: z.number().int().min(1).max(365),
    byWeekday: z.array(z.enum(WEEKDAY_TOKENS)).min(1).max(7).optional(),
    byMonthDay: z.number().int().min(1).max(31).optional(),
    tz: z.string().min(1).max(64).refine(isValidTimeZone, 'Invalid time zone'),
  })
  // Default (non-strict) object: unknown keys are stripped, not rejected — so a
  // client-sent `anchor` is silently dropped (the server owns it) rather than
  // 422ing the request.
  .superRefine((data, ctx) => {
    if (data.byWeekday !== undefined) {
      if (data.freq !== 'weekly') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['byWeekday'],
          message: 'byWeekday is only valid with freq=weekly',
        });
      } else if (new Set(data.byWeekday).size !== data.byWeekday.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['byWeekday'],
          message: 'byWeekday must not contain duplicates',
        });
      }
    }
    if (data.byMonthDay !== undefined && data.freq !== 'monthly') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['byMonthDay'],
        message: 'byMonthDay is only valid with freq=monthly',
      });
    }
  });

export type RepeatRuleInput = z.infer<typeof RepeatRuleInputSchema>;

export const UpdateItemSchema = z
  .object({
    text: z.string().min(1).max(MAX_ITEM_TEXT_LENGTH).optional(),
    checked: z.boolean().optional(),
    assignedTo: z.string().uuid().nullable().optional(),
    // Move the item to another list in the same project (drag-and-drop between
    // lists). Paired with `position` to place it among the target list's rows.
    // The server validates the target list belongs to this project.
    listId: z.string().uuid().optional(),
    columnId: z.string().min(1).max(50).optional(),
    position: z.number().int().positive().optional(),
    // ISO 8601 with required offset (Z or ±HH:MM). The client must convert
    // `<input type="datetime-local">` via `new Date(v).toISOString()` so the
    // server always interprets reminders in UTC.
    remindAt: z.string().datetime({ offset: true }).nullable().optional(),
    repeat: RepeatRuleInputSchema.nullable().optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'At least one item field must be provided',
  });

// Web Push subscription payload sent from the browser to PUT /push/subscription.
// Shape matches the W3C PushSubscriptionJSON.
//
// Endpoint host is allow-listed to known push services so that the server
// can't be coerced into POSTing payloads at arbitrary HTTPS hosts (any
// authenticated member could otherwise submit an attacker-controlled
// endpoint + their own keys and use the sweep as a low-volume HTTPS POST
// oracle). Suffix-matched so e.g. regional FCM hostnames are accepted.
// Modern Edge runs on Chromium and uses FCM; legacy Edge/WNS isn't covered
// — add `notify.windows.com` back if a legitimate subscription gets 422'd.
const PUSH_HOST_SUFFIXES = ['fcm.googleapis.com', 'push.services.mozilla.com', 'push.apple.com'];

function isAllowedPushEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

export const PushSubscriptionSchema = z.object({
  // No length cap: FCM endpoints can exceed 2048 chars (the DB column is
  // `text` for exactly this reason).
  endpoint: z.string().url().refine(isAllowedPushEndpoint, 'Unsupported push service'),
  keys: z.object({
    p256dh: z.string().min(1).max(255),
    auth: z.string().min(1).max(255),
  }),
});

export type PushSubscriptionInput = z.infer<typeof PushSubscriptionSchema>;

export const UpdateMemberSchema = z.object({
  displayName: z.string().min(1).max(MAX_DISPLAY_NAME_LENGTH),
});

export const MAX_SCRATCHPAD_CONTENT_LENGTH = 50000;

export const UpdateScratchpadSchema = z.object({
  content: z.string().max(MAX_SCRATCHPAD_CONTENT_LENGTH),
});

export const ScratchpadEditingSchema = z.object({
  editing: z.boolean(),
});

// Panels framework + Polls. Discriminated on `type` so adding the next panel
// type (TimeSlot) is a one-line union extension; `.strict()` rejects unknown
// keys so a buggy client can't sneak server-controlled fields through.
export const CreatePanelSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('poll'),
      question: z.string().trim().min(1).max(MAX_POLL_QUESTION_LENGTH),
      options: z
        .array(z.string().trim().min(1).max(MAX_POLL_OPTION_LENGTH))
        .min(MIN_POLL_OPTIONS)
        .max(MAX_POLL_OPTIONS),
    })
    .strict(),
  z
    .object({
      type: z.literal('timeslot'),
      title: z.string().trim().min(1).max(MAX_TIMESLOT_TITLE_LENGTH),
      slots: z
        .array(z.string().trim().min(1).max(MAX_TIMESLOT_SLOT_LENGTH))
        .min(MIN_TIMESLOT_SLOTS)
        .max(MAX_TIMESLOT_SLOTS),
    })
    .strict(),
  // Checklist created empty -- only a title. Items are added afterward as real
  // `items` rows in the backing list (see `POST /items` with `listId`), exactly
  // like the hero list, so there are no options/slots to collect up front.
  z
    .object({
      type: z.literal('checklist'),
      title: z.string().trim().min(1).max(MAX_CHECKLIST_TITLE_LENGTH),
    })
    .strict(),
]);

export const PollVoteSchema = z.object({ optionId: z.string().min(1).max(64).nullable() }).strict();

// available=true marks the slot available (idempotent insert); false retracts.
export const TimeSlotRespondSchema = z
  .object({ slotId: z.string().min(1).max(64), available: z.boolean() })
  .strict();

export type CreatePanelInput = z.infer<typeof CreatePanelSchema>;
export type PollVoteInput = z.infer<typeof PollVoteSchema>;
export type TimeSlotRespondInput = z.infer<typeof TimeSlotRespondSchema>;

// Rename a panel. Only the display title is mutable: a checklist's backing list
// title, a poll's question, or a time slot's title. All three share the same
// 280-char bound, so one constant covers every panel type.
export const UpdatePanelSchema = z
  .object({ title: z.string().trim().min(1).max(MAX_CHECKLIST_TITLE_LENGTH) })
  .strict();
export type UpdatePanelInput = z.infer<typeof UpdatePanelSchema>;

export const CONTACT_CATEGORIES = ['general', 'bug', 'privacy', 'legal', 'dsa-notice'] as const;
export type ContactCategory = (typeof CONTACT_CATEGORIES)[number];

export const ContactMessageSchema = z.object({
  name: z.string().trim().max(100).optional(),
  email: z.string().email().max(255),
  category: z.enum(CONTACT_CATEGORIES).default('general'),
  message: z.string().trim().min(1).max(4000),
});

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type RequestCreationCodeInput = z.infer<typeof RequestCreationCodeSchema>;
export type ConnectRequestInput = z.infer<typeof ConnectRequestSchema>;
export type JoinProjectInput = z.infer<typeof JoinProjectSchema>;
export type UpdateListInput = z.infer<typeof UpdateListSchema>;
export type CreateItemInput = z.infer<typeof CreateItemSchema>;
export type CreateTaskViaTokenInput = z.infer<typeof CreateTaskViaTokenSchema>;
export type UpdateItemInput = z.infer<typeof UpdateItemSchema>;
export type UpdateMemberInput = z.infer<typeof UpdateMemberSchema>;
export type UpdateScratchpadInput = z.infer<typeof UpdateScratchpadSchema>;
export type ScratchpadEditingInput = z.infer<typeof ScratchpadEditingSchema>;
export type ContactMessageInput = z.infer<typeof ContactMessageSchema>;

// DSA Art. 16 notice categories. CSAM is structurally special: Art. 16(2)(c)
// allows the submitter to omit name and email to permit anonymous reporting.
export const DSA_NOTICE_CATEGORIES = [
  'copyright',
  'defamation',
  'hate-speech',
  'csam',
  'illegal-product',
  'other',
] as const;
export type DsaNoticeCategory = (typeof DSA_NOTICE_CATEGORIES)[number];

export const DsaNoticeSchema = z
  .object({
    // Where the content is. Free text rather than a structured FK so the
    // notice survives content/space deletion -- required for the audit trail.
    contentLocation: z.string().trim().min(1).max(500),
    // Optional structured pointers if the submitter is logged in or copied
    // the URL from inside the app. Kept for the operator to triage faster.
    projectSlug: z.string().trim().max(22).optional(),
    itemId: z.string().uuid().optional(),
    attachmentId: z.string().uuid().optional(),
    category: z.enum(DSA_NOTICE_CATEGORIES),
    reason: z.string().trim().min(20).max(4000),
    submitterName: z.string().trim().max(100).optional(),
    submitterEmail: z.string().email().max(255).optional(),
    goodFaithConfirmed: z.literal(true),
  })
  .superRefine((data, ctx) => {
    // Art. 16(2)(c): submitter contact is mandatory EXCEPT when the report
    // concerns content "involving one of the offences referred to in
    // Articles 3 to 7 of Directive 2011/93/EU" -- i.e. CSAM. Mirror that.
    if (data.category !== 'csam') {
      if (!data.submitterEmail) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['submitterEmail'],
          message: 'submitterEmail is required unless category is csam',
        });
      }
    }
  });

export type DsaNoticeInput = z.infer<typeof DsaNoticeSchema>;
