import { describe, expect, it } from 'vitest';
import {
  clearIdentity,
  clearPendingConnect,
  getPendingConnect,
  getVerifiedWitnessSlug,
  saveIdentity,
  savePendingConnect,
  saveVerifiedWitnessSlug,
} from './identity';

describe('identity — verified witness guard (§10.8)', () => {
  it('returns the witness slug only while its token still exists', () => {
    saveIdentity('w', 'tok', 'm1', 'Witness');
    saveVerifiedWitnessSlug('w');
    expect(getVerifiedWitnessSlug()).toBe('w');
  });

  it('returns null for a witness pointer whose identity is gone (dead witness)', () => {
    saveVerifiedWitnessSlug('ghost'); // no saveIdentity → no token
    expect(getVerifiedWitnessSlug()).toBeNull();
  });

  it('clearIdentity drops the witness pointer when it matches the cleared slug', () => {
    saveIdentity('w', 'tok', 'm1', 'Witness');
    saveVerifiedWitnessSlug('w');
    clearIdentity('w');
    expect(getVerifiedWitnessSlug()).toBeNull();
  });

  it('clearIdentity leaves an unrelated witness pointer intact', () => {
    saveIdentity('w', 'tok', 'm1', 'Witness');
    saveVerifiedWitnessSlug('w');
    saveIdentity('other', 'tok2', 'm2', 'Other');
    clearIdentity('other');
    expect(getVerifiedWitnessSlug()).toBe('w');
  });
});

describe('identity — pending connect', () => {
  it('round-trips and clears a pending-connect record', () => {
    savePendingConnect({ email: 'jo@example.com', step: 'verify', requestedAt: 123 });
    expect(getPendingConnect()).toEqual({
      email: 'jo@example.com',
      step: 'verify',
      requestedAt: 123,
    });
    clearPendingConnect();
    expect(getPendingConnect()).toBeNull();
  });

  it('rejects a malformed pending-connect record', () => {
    localStorage.setItem('spaces:pendingConnect', JSON.stringify({ email: '', step: 'nope' }));
    expect(getPendingConnect()).toBeNull();
  });
});
