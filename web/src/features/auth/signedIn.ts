import type { QueryClient } from '@tanstack/react-query';
import type { NavigateFunction } from 'react-router';

import type { UserOut } from '../../api/client';
import { clearDraftsExcept } from '../../app/drafts';
import { safeNext } from './next';
import { clearSession } from './useLogout';
import { ME_KEY } from './useMe';

/** After a successful login (code or password, spec 0016a): forget the previous person in this
 * tab, remember this one, and go to `next`. */
export function signedIn(
  queryClient: QueryClient,
  navigate: NavigateFunction,
  user: UserOut,
  next: string,
): void {
  // Drop whatever the previous person in this tab left under ['me', …] first. A stashed invite
  // token stays: it is this login's way back to the join page (0008e A1).
  clearSession(queryClient, { keepInviteToken: true });
  // Another person's unsent text in this tab is never theirs (spec 0009g).
  clearDraftsExcept(user.id);
  queryClient.setQueryData<UserOut | null>(ME_KEY, user);
  // `replace`: Back does not return to /login. `safeNext` again, as defence in depth.
  void navigate(safeNext(next), { replace: true });
}
