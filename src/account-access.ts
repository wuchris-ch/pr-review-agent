export interface AccountActor {
  id: string;
  isAdmin: boolean;
}

export function canDeleteAccount(
  actor: AccountActor,
  targetAccountId: string,
): boolean {
  return actor.id === targetAccountId || !actor.isAdmin;
}
