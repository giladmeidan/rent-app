import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';

import { hasStatus } from '../applications/api';
import { clearSession } from '../auth/useLogout';
import { CONVERSATIONS_KEY } from '../chat/useConversations';
import { threadKey } from '../chat/useThread';
import {
  fetchMyPeopleLikes,
  fetchPeopleBrowse,
  likePersonCard,
  removeMatch,
  unlikePersonCard,
  type MyPeopleLikesOut,
  type PeopleBrowseOut,
  type PersonCardOut,
  type PersonLikeOut,
} from './api';

/** People browse in שוק השותפים (0010h). Not under `['me', …]`: logout resets it (`clearSession`). It
 * is never invalidated: the API counts every page a refetch loads against the browse limit, so a
 * like or an unlike edits the loaded pages in place (`setQueryData`). */
export const MARKET_PEOPLE_KEY = ['market-people'] as const;
/** Under `['me', …]`: per-user data, removed from the cache on logout. */
export const PEOPLE_LIKES_KEY = ['me', 'people-likes'] as const;

type Browse = InfiniteData<PeopleBrowseOut>;

/** Neither query refetches by itself: a stale page costs at most a minute, and a refetch of N
 * loaded pages is N browse calls. */
const QUIET = { staleTime: 60_000, refetchOnWindowFocus: false } as const;

/** The cards of every loaded page, a repeated card (an offset shifted by a change) dropped. */
export function flattenCards(data: Browse): PersonCardOut[] {
  const seen = new Set<string>();
  const cards: PersonCardOut[] = [];
  for (const page of data.pages) {
    for (const card of page.items) {
      if (seen.has(card.card_id)) continue;
      seen.add(card.card_id);
      cards.push(card);
    }
  }
  return cards;
}

/** The people the caller may like, 20 a page. */
export function useMarketPeople() {
  const queryClient = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: MARKET_PEOPLE_KEY,
    queryFn: ({ pageParam }) => fetchPeopleBrowse(pageParam),
    initialPageParam: 0,
    // As `usePeople`: the next offset counts the cards loaded, so paging never stalls.
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return last.items.length > 0 && loaded < last.total ? loaded : undefined;
    },
    ...QUIET,
  });
  const expired = hasStatus(query.error, 401);
  useEffect(() => {
    if (expired) clearSession(queryClient);
  }, [expired, queryClient]);
  return query;
}

/** The caller's people likes (the card nudge on 403 `card_required` is the page's). */
export function useMyPeopleLikes() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: PEOPLE_LIKES_KEY, queryFn: fetchMyPeopleLikes, ...QUIET });
  const expired = hasStatus(query.error, 401);
  useEffect(() => {
    if (expired) clearSession(queryClient);
  }, [expired, queryClient]);
  return query;
}

/** What a like or unlike did to one card. `gone`: the card is no longer there (404). */
type Change = { kind: 'like'; result: PersonLikeOut } | { kind: 'unlike' } | { kind: 'gone' };

/** Browse: flips `liked_by_me`; a mutual pair (now a match) and a gone card leave the pages. */
function browseAfter(old: Browse | undefined, card: PersonCardOut, change: Change) {
  if (old === undefined) return old;
  const leaves =
    change.kind === 'gone' || (change.kind === 'like' && change.result.conversation_id !== null);
  const liked = change.kind === 'like';
  return {
    ...old,
    pages: old.pages.map((page) => {
      const present = page.items.some((c) => c.card_id === card.card_id);
      return {
        ...page,
        // The total counts every candidate, so it drops with the card (on every page: the last
        // one is read).
        total: leaves ? Math.max(0, page.total - 1) : page.total,
        items: leaves
          ? page.items.filter((c) => c.card_id !== card.card_id)
          : present
            ? page.items.map((c) => (c.card_id === card.card_id ? { ...c, liked_by_me: liked } : c))
            : page.items,
      };
    }),
  };
}

/** People likes: the same change, in the lists (a new match goes first in "matches"). */
function likesAfter(old: MyPeopleLikesOut | undefined, card: PersonCardOut, change: Change) {
  if (old === undefined) return old;
  const without = (list: PersonCardOut[]) => list.filter((c) => c.card_id !== card.card_id);
  if (change.kind === 'gone') {
    return { ...old, liked_me: without(old.liked_me), mine: without(old.mine) };
  }
  if (change.kind === 'like' && change.result.conversation_id !== null) {
    const conversationId = change.result.conversation_id;
    return {
      liked_me: without(old.liked_me),
      mine: without(old.mine),
      matches: [
        {
          conversation_id: conversationId,
          display_name: card.display_name,
          photo_url: card.photo_url,
          matched_at: new Date().toISOString(),
        },
        ...old.matches.filter((m) => m.conversation_id !== conversationId),
      ],
    };
  }
  const liked = change.kind === 'like';
  const flip = (list: PersonCardOut[]) =>
    list.map((c) => (c.card_id === card.card_id ? { ...c, liked_by_me: liked } : c));
  const known =
    old.liked_me.some((c) => c.card_id === card.card_id) ||
    old.mine.some((c) => c.card_id === card.card_id);
  return {
    ...old,
    liked_me: flip(old.liked_me),
    // A like on a card of the browse page joins "mine".
    mine: liked && !known ? [{ ...card, liked_by_me: true }, ...old.mine] : flip(old.mine),
  };
}

function apply(queryClient: QueryClient, card: PersonCardOut, change: Change) {
  queryClient.setQueriesData<Browse>({ queryKey: MARKET_PEOPLE_KEY }, (old) =>
    browseAfter(old, card, change),
  );
  queryClient.setQueryData<MyPeopleLikesOut>(PEOPLE_LIKES_KEY, (old) =>
    likesAfter(old, card, change),
  );
  // Marked stale, not refetched: the likes page (mounted or not) shows the edit now and loads
  // the server's lists the next time it opens.
  void queryClient.invalidateQueries({ queryKey: PEOPLE_LIKES_KEY, refetchType: 'none' });
}

function useFailure() {
  const queryClient = useQueryClient();
  return (error: unknown, card: PersonCardOut) => {
    if (hasStatus(error, 401)) clearSession(queryClient);
    else if (hasStatus(error, 404)) apply(queryClient, card, { kind: 'gone' });
  };
}

/** Likes a card. A mutual result (a `conversation_id`) opens the direct chat: the chat list is
 * refetched. */
export function useLikeCard() {
  const queryClient = useQueryClient();
  const failed = useFailure();
  return useMutation({
    mutationFn: (card: PersonCardOut) => likePersonCard(card.card_id),
    onSuccess: (result, card) => {
      apply(queryClient, card, { kind: 'like', result });
      if (result.conversation_id !== null) {
        void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
      }
    },
    onError: failed,
  });
}

/** Takes a like back. No confirm: it is reversible. */
export function useUnlikeCard() {
  const queryClient = useQueryClient();
  const failed = useFailure();
  return useMutation({
    mutationFn: (card: PersonCardOut) => unlikePersonCard(card.card_id),
    onSuccess: (_void, card) => apply(queryClient, card, { kind: 'unlike' }),
    onError: failed,
  });
}

/** Removes a match from its direct chat: the thread, the chat list and the likes lists refetch. */
export function useRemoveMatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => removeMatch(conversationId),
    onSuccess: async (_void, conversationId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: threadKey(conversationId), exact: true }),
        queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY, exact: true }),
        queryClient.invalidateQueries({ queryKey: PEOPLE_LIKES_KEY, exact: true }),
      ]);
    },
    onError: (error) => {
      if (hasStatus(error, 401)) clearSession(queryClient);
    },
  });
}
