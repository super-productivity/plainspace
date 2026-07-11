import { describe, expect, it } from 'vitest';

import { apiTokens, items, members } from '../db/schema.js';
import { encryptedEmailFields } from './email-crypto.js';
import { serializeApiToken, serializeItem, serializeMember } from './serialize.js';

type MemberRow = typeof members.$inferSelect;
type ApiTokenRow = typeof apiTokens.$inferSelect;
type ItemRow = typeof items.$inferSelect;

function itemRow(overrides: Partial<ItemRow> = {}): ItemRow {
  return {
    id: '66666666-6666-6666-6666-666666666666',
    listId: '77777777-7777-7777-7777-777777777777',
    projectId: '88888888-8888-8888-8888-888888888888',
    text: 'Take meds',
    checked: false,
    checkedBy: null,
    assignedTo: null,
    columnId: 'todo',
    position: 1000,
    createdBy: null,
    createdAt: new Date('2026-01-02T03:04:05.000Z'),
    updatedAt: new Date('2026-01-02T03:04:05.000Z'),
    remindAt: new Date('2026-06-01T07:00:00.000Z'),
    repeat: null,
    notifiedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function memberRow(): MemberRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    projectId: '22222222-2222-2222-2222-222222222222',
    displayName: 'Alice',
    color: '#000000',
    avatarIndex: 0,
    ...encryptedEmailFields('alice@example.com'),
    emailVerified: true,
    isCreator: false,
    role: 'member',
    tosVersion: '2026-01',
    tosAcceptedAt: new Date('2026-01-02T03:04:05.000Z'),
    joinedAt: new Date('2026-01-02T03:04:05.000Z'),
  };
}

describe('serializeMember', () => {
  it('keeps plaintext email and TOS fields out of public members', () => {
    const row = memberRow();

    const current = serializeMember(row, row.id);
    expect(current.email).toBe('alice@example.com');
    expect(current.tosVersion).toBe('2026-01');
    expect(current.tosAcceptedAt).toBe('2026-01-02T03:04:05.000Z');

    const publicMember = serializeMember(row);
    expect(publicMember.email).toBe('a***e@example.com');
    expect(publicMember.tosVersion).toBeNull();
    expect(publicMember.tosAcceptedAt).toBeNull();

    expect(serializeMember(row, '33333333-3333-3333-3333-333333333333')).toEqual(publicMember);
  });
});

describe('serializeItem', () => {
  it('passes repeat through and exposes the exact client-facing key set', () => {
    const repeat = {
      freq: 'daily' as const,
      interval: 1,
      tz: 'Europe/Berlin',
      anchor: '2026-06-01T07:00:00.000Z',
    };
    const serialized = serializeItem(itemRow({ repeat }));

    expect(serialized.repeat).toEqual(repeat);
    expect(serialized.remindAt).toBe('2026-06-01T07:00:00.000Z');

    // Defence-in-depth: enumerate the keys so future schema additions (e.g.
    // deletedAt) don't silently start leaking through the API.
    expect(Object.keys(serialized).sort()).toEqual(
      [
        'assignedTo',
        'checked',
        'checkedBy',
        'columnId',
        'createdAt',
        'createdBy',
        'id',
        'listId',
        'position',
        'projectId',
        'remindAt',
        'repeat',
        'text',
      ].sort(),
    );
  });

  it('serializes repeat as null for a non-recurring item', () => {
    expect(serializeItem(itemRow({ repeat: null })).repeat).toBeNull();
  });
});

describe('serializeApiToken', () => {
  it('omits sensitive fields', () => {
    const row: ApiTokenRow = {
      id: '44444444-4444-4444-4444-444444444444',
      emailCiphertext: Buffer.from('ciphertext'),
      emailIv: Buffer.from('iv'),
      emailLookup: Buffer.from('lookup'),
      tokenHash: 'secret-token-hash',
      lastUsedAt: new Date('2026-02-03T04:05:06.000Z'),
      expiresAt: new Date('2026-03-04T05:06:07.000Z'),
      createdAt: new Date('2026-01-02T03:04:05.000Z'),
      revokedAt: null,
    };

    const serialized = serializeApiToken(row);

    expect(serialized).toEqual({
      id: row.id,
      lastUsedAt: '2026-02-03T04:05:06.000Z',
      expiresAt: '2026-03-04T05:06:07.000Z',
      createdAt: '2026-01-02T03:04:05.000Z',
    });

    // Defence-in-depth: enumerate keys so future schema additions don't
    // silently start leaking through.
    expect(Object.keys(serialized).sort()).toEqual(
      ['createdAt', 'expiresAt', 'id', 'lastUsedAt'].sort(),
    );
  });

  it('serializes lastUsedAt as null when never used', () => {
    const row: ApiTokenRow = {
      id: '55555555-5555-5555-5555-555555555555',
      emailCiphertext: Buffer.from('ciphertext'),
      emailIv: Buffer.from('iv'),
      emailLookup: Buffer.from('lookup'),
      tokenHash: 'hash',
      lastUsedAt: null,
      expiresAt: new Date('2026-03-04T05:06:07.000Z'),
      createdAt: new Date('2026-01-02T03:04:05.000Z'),
      revokedAt: null,
    };

    expect(serializeApiToken(row).lastUsedAt).toBeNull();
  });
});
