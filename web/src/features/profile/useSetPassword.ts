import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api, type UserOut } from '../../api/client';
import { ME_KEY } from '../auth/useMe';
import { ApiError } from '../listings/api';

/** `PUT /me/password` (spec 0016a). 204 resolves; every failure throws an `ApiError` (403
 * `reauth_required` and 401 are `isReauthRequired`; a 429 carries its `retryAfter`). */
async function setPassword(password: string): Promise<void> {
  const { error, response } = await api.PUT('/me/password', { body: { password } });
  if (response.status !== 204) {
    throw new ApiError('PUT', '/me/password', response.status, error, response.headers);
  }
}

/** Sets or changes the caller's password; on 204 the cached person `has_password`. */
export function useSetPassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setPassword,
    onSuccess: () => {
      queryClient.setQueryData<UserOut | null>(ME_KEY, (me) =>
        me ? { ...me, has_password: true } : me,
      );
    },
  });
}
