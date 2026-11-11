import { expect, test } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };
import { likeRoom, postListing, putProfile, signUp } from './helpers';

const withName = (text: string, name: string) => text.replace('{{name}}', name);

// A room lister likes back someone who liked the room: the like turns mutual, the chat opens, and
// the inbox tags the match. No new signup beyond the two (the e2e OTP budget).
test('ac10_owner_likes_back_and_chats', async ({ page, browser }) => {
  // Unique per run, so a rerun against the same database finds exactly one card.
  const SEEKER_NAME = `\u05de\u05d9\u05db\u05dc ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const street = `e2e ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  // An owner posts a room.
  await signUp(page, 'owner');
  const roomId = await postListing(page, street, {
    listing_type: 'room',
    gender_preference: 'any',
    flatmates_count: 2,
    flatmate_ages: [27, 30],
    lifestyle: { cleanliness: 3 },
  });

  // A seeker opts in to people browse with a room section, and likes the room through the API.
  const seekerContext = await browser.newContext();
  const seekerPage = await seekerContext.newPage();
  await signUp(seekerPage, 'seeker', { name: SEEKER_NAME });
  await putProfile(seekerPage, {
    gender: 'woman',
    birth_year: new Date().getUTCFullYear() - 27,
    lifestyle: { cleanliness: 3 },
    people_visible: true,
    about_me: 'quiet and tidy',
  });
  await likeRoom(seekerPage, roomId);

  // "My listings": the room's people link carries the badge.
  await page.goto('/me/listings');
  const card = page.getByRole('article').filter({ hasText: street });
  const link = card.getByRole('link', { name: new RegExp(he.listings.mine.people) });
  await expect(link.getByText(he.listings.mine.peopleLikedOne)).toBeVisible();

  // The people page: the seeker's card says she liked the room.
  await link.click();
  await expect(page).toHaveURL(`/me/listings/${roomId}/people`);
  await expect(page.getByRole('heading', { level: 1, name: he.people.title })).toBeVisible();
  const person = page.getByRole('article', { name: SEEKER_NAME });
  await expect(person.getByText(he.people.likedMe)).toBeVisible();

  // Liking back: the mutual banner, and its link opens the thread.
  await person.getByRole('button', { name: he.people.like, exact: true }).click();
  const banner = page
    .getByRole('status')
    .filter({ hasText: withName(he.people.mutual, SEEKER_NAME) });
  await expect(banner).toBeVisible();
  await banner.getByRole('link', { name: he.people.toChat }).click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { level: 1, name: SEEKER_NAME })).toBeVisible();

  // The inbox lists the seeker with the mutual tag.
  await page.goto(`/me/listings/${roomId}/applicants`);
  const applicant = page.getByRole('article', { name: SEEKER_NAME });
  await expect(applicant.getByTestId('applicant-mutual')).toHaveText(he.applicants.mutual);
  await expect(applicant.getByTestId('applicant-message')).toHaveCount(0);

  await seekerContext.close();
});
