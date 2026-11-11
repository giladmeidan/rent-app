// The chat pages inside the real `Layout` (its header and its `ChatStreamProvider`), with a probe
// showing `useChatStreamConnected()`. The fetch mock and `renderRoutes` are the auth harness's.
import { act, screen } from '@testing-library/react';
import { Outlet, Route, Routes } from 'react-router';

import { Layout } from '../../../app/Layout';
import type { FakeEventSource } from '../../../test-setup';
import { RequireUser } from '../../auth/RequireUser';
import { ChatListPage } from '../ChatListPage';
import { useChatStreamConnected } from '../ChatStreamProvider';
import { ChatThreadPage } from '../ChatThreadPage';

/** The `EventSource` stand-in `test-setup.ts` installs. */
export const ES = globalThis.EventSource as unknown as typeof FakeEventSource;

function Probe() {
  return <span data-testid="connected">{String(useChatStreamConnected())}</span>;
}

export const chatRoutes = (
  <Routes>
    <Route element={<Layout />}>
      <Route
        element={
          <>
            <Probe />
            <Outlet />
          </>
        }
      >
        <Route index element={<p>home</p>} />
        <Route path="login" element={<p>login</p>} />
        <Route path="listings/:id" element={<p>listing</p>} />
        <Route element={<RequireUser />}>
          <Route path="chat" element={<ChatListPage />} />
          <Route path="chat/:id" element={<ChatThreadPage />} />
        </Route>
      </Route>
    </Route>
  </Routes>
);

export const connected = () => screen.getByTestId('connected').textContent;

/** Opens this tab's event stream (the newest instance). */
export function openStream(): FakeEventSource {
  const source = ES.latest();
  act(() => {
    source.open();
  });
  return source;
}

/** Lets pending fetches and their renders settle (with fake timers that advance on their own). */
export async function settle(ms = 50): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}
