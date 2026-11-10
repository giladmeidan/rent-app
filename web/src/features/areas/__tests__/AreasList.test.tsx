import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import he from '../../../locales/he.json';
import { AreasList } from '../AreasList';

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AreasList />
    </QueryClientProvider>,
  );
}

function stubFetch(impl: () => Promise<Response>) {
  const fetchMock = vi.fn<(request: Request) => Promise<Response>>(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AreasList', () => {
  it('ac1_renders_areas_from_api', async () => {
    const fetchMock = stubFetch(() =>
      json([
        { id: '00000000-0000-0000-0000-000000000001', slug: 'gush-dan', name_he: 'גוש דן' },
        { id: '00000000-0000-0000-0000-000000000002', slug: 'sharon', name_he: 'השרון' },
      ]),
    );
    renderList();

    expect(await screen.findByText('גוש דן')).toBeVisible();
    expect(screen.getByText('השרון')).toBeVisible();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(he.areas.heading);
    expect(fetchMock.mock.calls[0]?.[0].url).toBe('http://api.test/areas');
  });

  it('ac2_error_state_with_retry', async () => {
    const fetchMock = stubFetch(() => json({ detail: 'database unavailable' }, 503));
    renderList();

    expect(await screen.findByRole('alert')).toHaveTextContent(he.common.error);
    const retry = screen.getByRole('button', { name: he.common.retry });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    retry.click();
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it('ac3_empty_state', async () => {
    stubFetch(() => json([]));
    renderList();

    expect(await screen.findByText(he.areas.empty)).toBeVisible();
  });

  it('ac4_loading_skeletons', () => {
    stubFetch(() => new Promise<Response>(() => undefined));
    renderList();

    const list = screen.getByRole('list', { name: he.common.loading });
    expect(list).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByTestId('skeleton')).toHaveLength(3);
  });
});
