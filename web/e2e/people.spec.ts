import { expect } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };
import { expectNoAxeViolations } from './a11y';
import { API, postListing, putProfile, signUp } from './helpers';
import { newTileContext, test } from './fixtures';

// A room lister likes (invites) someone in people browse; that seeker applies, the application is
// shortlisted at once with the chat open, and the inbox tags the match (spec 0010l). No new signup
// beyond the two (the e2e OTP budget).
test('ac10_owner_likes_seeker_applies_and_chats', async ({ page, browser }) => {
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

  // A seeker opts in to people browse with a room section.
  const seekerContext = await newTileContext(browser);
  const seekerPage = await seekerContext.newPage();
  await signUp(seekerPage, 'seeker', { name: SEEKER_NAME });
  await putProfile(seekerPage, {
    gender: 'woman',
    birth_year: new Date().getUTCFullYear() - 27,
    lifestyle: { cleanliness: 3 },
    people_visible: true,
    about_me: 'quiet and tidy',
  });

  // The market's "שלי" (a room's "my listings", spec 0010a): the people link, with no liked-me
  // chip (spec 0010l).
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/market/mine');
  const card = page.getByRole('article').filter({ hasText: street });
  const link = card.getByRole('link', { name: he.listings.mine.people, exact: true });
  await expect(link).toBeVisible();

  // The people page: the seeker's card, no "liked you" marker.
  await link.click();
  await expect(page).toHaveURL(`/me/listings/${roomId}/people`);
  await expect(page.getByRole('heading', { level: 1, name: he.people.title })).toBeVisible();
  const person = page.getByRole('article', { name: SEEKER_NAME });
  await expect(person).toBeVisible();
  await expectNoAxeViolations(page, '/me/listings/:id/people');
  await person.getByRole('button', { name: he.applicants.why }).click();
  await expect(person.getByRole('button', { name: he.applicants.why })).toHaveAttribute(
    'aria-expanded',
    'true',
  );

  // The like is an invite: the button flips, and nothing else happens on the page.
  const like = person.getByRole('button', { name: he.people.invite, exact: true });
  await like.click();
  await expect(like).toHaveAttribute('aria-pressed', 'true');

  // The seeker applies (no message): shortlisted at once, the chat open.
  const applied = await seekerPage.request.post(`${API}/listings/${roomId}/applications`, {
    data: {},
  });
  expect(applied.status()).toBe(201);
  const {
    id: applicationId,
    status,
    source,
  } = (await applied.json()) as {
    id: string;
    status: string;
    source: string;
  };
  expect([status, source]).toEqual(['shortlisted', 'like']);

  // The inbox lists the seeker with the mutual tag and no message box; the chat opens.
  await page.goto(`/me/listings/${roomId}/applicants`);
  const applicant = page.getByRole('article', { name: SEEKER_NAME });
  await expect(applicant.getByTestId('applicant-mutual')).toHaveText(he.applicants.mutual);
  await expect(applicant.getByTestId('applicant-message')).toHaveCount(0);
  await page.goto(`/chat/${applicationId}`);
  await expect(page.getByRole('heading', { level: 1, name: SEEKER_NAME })).toBeVisible();

  await seekerContext.close();
});
