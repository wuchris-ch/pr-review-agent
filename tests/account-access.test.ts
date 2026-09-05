import { describe, expect, it } from 'vitest';
import { canDeleteAccount } from '../src/account-access.js';

describe('account deletion access', () => {
  it('allows an account owner to delete their own account', () => {
    expect(canDeleteAccount({ id: 'account-1', isAdmin: false }, 'account-1'))
      .toBe(true);
  });
});
