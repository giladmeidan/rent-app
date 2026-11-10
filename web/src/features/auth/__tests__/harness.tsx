// Shared test harness for the auth feature: a routed fetch mock, a render helper and fixtures.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';

import type { UserOut } from '../../../api/client';
import { routerFuture } from '../../../app/routes';

export const noa: UserOut = {
  id: '00000000-0000-0000-0000-0000000000aa',
  email: 'noa@example.com',
  display_name: 'נועה',
  role: 'seeker',
  account_type: 'standard',
  created_at: '2026-11-10T10:00:00Z',
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const empty = (status = 204) => new Response(null, { status });

export const networkError = (): Promise<Response> =>
  Promise.reject(new TypeError('Failed to fetch'));

export function deferred() {
  let resolve: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type Reply = Response | Promise<Response> | (() => Response | Promise<Response>);
type Call = { route: string; request: Request; body: unknown };

/**
 * Stubs the global fetch. `routes` maps `"METHOD /path"` to a queue of replies, used in order; the
 * last one repeats. Unknown routes fail the test loudly with a 599.
 */
export function mockApi(routes: Record<string, Reply[]>) {
  const calls: Call[] = [];
  const used: Record<string, number> = {};
  const fetchMock = vi.fn(async (request: Request) => {
    const route = `${request.method} ${new URL(request.url).pathname}`;
    const text = request.method === 'GET' ? '' : await request.clone().text();
    calls.push({ route, request, body: text === '' ? undefined : JSON.parse(text) });
    const queue = routes[route];
    if (queue === undefined || queue.length === 0)
      return json({ detail: `unmocked ${route}` }, 599);
    const index = Math.min(used[route] ?? 0, queue.length - 1);
    used[route] = index + 1;
    const reply = queue[index] as Reply;
    return typeof reply === 'function' ? reply() : reply;
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls: (route: string) => calls.filter((c) => c.route === route),
    fetchMock,
  };
}

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

export function testQueryClient(retry: boolean | number = false) {
  return new QueryClient({ defaultOptions: { queries: { retry }, mutations: { retry: false } } });
}

/** Renders a routes tree at `path`, with a probe showing the current location. */
export function renderRoutes(path: string, routes: ReactNode, client = testQueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]} future={routerFuture}>
        {routes}
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Renders `ui` as the route at `path`, next to a bare `/` route (to observe navigation). */
export function renderAt(path: string, ui: ReactNode, client = testQueryClient()) {
  const pathname = path.split('?')[0] ?? path;
  return renderRoutes(
    path,
    <Routes>
      <Route path="/" element={<p>home</p>} />
      <Route path={pathname} element={ui} />
    </Routes>,
    client,
  );
}

export const currentPath = () => document.querySelector("[data-testid='location']")?.textContent;
