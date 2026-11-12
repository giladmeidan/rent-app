// The visual check for login and signup (spec 0009m, AC7): one screenshot per state at each
// project's size, in web/screens/0009m/. Every API request is answered here, so it needs only the
// vite server: no sign-up, no OTP. An unmatched request fails the run.
import { expect, test, type Page, type Route } from '@playwright/test';

import he from '../../src/locales/he.json' with { type: 'json' };
import { API } from '../helpers';
import {
  ANONYMOUS,
  CODE,
  EMAIL,
  INVALID_EMAIL,
  NAME,
  NETWORK_DOWN,
  PROFILE_REQUIRED,
  SENT,
  SHORT_NAME,
  TOO_MANY,
  WRONG_CODE,
  type Answer,
} from './fixtures-auth';
import { WEB_ORIGIN } from './origin';

type Setup = {
  /** `POST /auth/otp/request`'s answers in order; the last one repeats. */
  request?: Answer[];
  /** `POST /auth/otp/verify`'s answers in order; the last one repeats. */
  verify?: Answer[];
};

const CORS = {
  'Access-Control-Allow-Origin': WEB_ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
};

function answer(route: Route, a: Answer) {
  if (a === 'abort') return route.abort('failed');
  if (a.body === undefined) return route.fulfill({ status: a.status, headers: CORS });
  return route.fulfill({
    status: a.status,
    contentType: 'application/json',
    headers: CORS,
    body: JSON.stringify(a.body),
  });
}

/** The next answer in `queue`, keeping the last one once the queue is spent. */
const next = (queue: Answer[]): Answer => (queue.length > 1 ? queue.shift() : queue[0]) ?? SENT;

async function mockApi(page: Page, setup: Setup): Promise<string[]> {
  const unmatched: string[] = [];
  const requests = [...(setup.request ?? [SENT])];
  const verifies = [...(setup.verify ?? [WRONG_CODE])];
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    const key = `${method} ${pathname}`;
    if (method === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          ...CORS,
          'Access-Control-Allow-Methods': 'GET, POST',
          'Access-Control-Allow-Headers': 'content-type',
        },
      });
    }
    if (key === 'GET /me') return answer(route, ANONYMOUS);
    if (key === 'POST /auth/otp/request') return answer(route, next(requests));
    if (key === 'POST /auth/otp/verify') return answer(route, next(verifies));
    unmatched.push(key);
    return route.fulfill({ status: 500, headers: CORS, body: `unmatched ${key}` });
  });
  return unmatched;
}

type State = {
  name: string;
  setup: Setup;
  path: string;
  /** What to do, and wait for, before the shot. */
  act: (page: Page) => Promise<void>;
};

const sendCode = (page: Page) => page.getByRole('button', { name: he.auth.sendCode }).click();
const codeInput = (page: Page) => page.getByLabel(he.auth.code.label);

/** Login: an email, sent, and step 2 open. */
async function loginStep2(page: Page) {
  await page.getByLabel(he.auth.email.label).fill(EMAIL);
  await sendCode(page);
  await expect(codeInput(page)).toBeFocused();
}

/** Signup: a role, a name and an email (step 1 filled). */
async function signupFilled(page: Page, name = NAME) {
  await page.getByText(he.auth.role.owner, { exact: true }).click();
  await page.getByLabel(he.auth.name.label).fill(name);
  await page.getByLabel(he.auth.email.label).fill(EMAIL);
}

async function verifyCode(page: Page) {
  await codeInput(page).fill(CODE);
  await page.getByRole('button', { name: he.auth.verify }).click();
}

const STATES: State[] = [
  {
    name: 'a1-login-step1',
    setup: {},
    path: '/login',
    act: async (page) => {
      await expect(page.getByLabel(he.auth.email.label)).toBeVisible();
    },
  },
  {
    name: 'a2-login-invalid-email',
    setup: { request: [INVALID_EMAIL] },
    path: '/login',
    act: async (page) => {
      await page.getByLabel(he.auth.email.label).fill(EMAIL);
      await sendCode(page);
      await expect(page.getByRole('alert')).toHaveText(he.auth.errors.invalidEmail);
    },
  },
  {
    name: 'a3-login-too-many',
    setup: { request: [TOO_MANY] },
    path: '/login',
    act: async (page) => {
      await page.getByLabel(he.auth.email.label).fill(EMAIL);
      await sendCode(page);
      await expect(page.getByRole('alert')).toHaveText(he.auth.errors.tooMany);
    },
  },
  {
    name: 'a4-login-step2-cooldown',
    setup: {},
    path: '/login',
    act: async (page) => {
      await loginStep2(page);
      await expect(page.getByRole('button', { name: he.auth.resend })).toBeDisabled();
    },
  },
  {
    name: 'a5-login-invalid-code',
    setup: { verify: [WRONG_CODE] },
    path: '/login',
    act: async (page) => {
      await loginStep2(page);
      await verifyCode(page);
      await expect(page.getByRole('alert')).toHaveText(he.auth.errors.invalidCode);
    },
  },
  {
    name: 'a6-login-no-account-reveal',
    setup: { verify: [PROFILE_REQUIRED] },
    path: '/login',
    act: async (page) => {
      await loginStep2(page);
      await verifyCode(page);
      await expect(page.getByRole('radio', { name: he.auth.role.owner })).toBeFocused();
      await expect(page.getByRole('button', { name: he.auth.verify })).toBeDisabled();
      // The focus ring is not part of this state.
      await page.locator('body').click({ position: { x: 1, y: 1 } });
    },
  },
  {
    name: 'a7-signup-role-owner',
    setup: {},
    path: '/signup?role=owner',
    act: async (page) => {
      await expect(page.getByRole('radio', { name: he.auth.role.owner })).toBeChecked();
    },
  },
  {
    name: 'a8-signup-name-error',
    setup: {},
    path: '/signup',
    act: async (page) => {
      await signupFilled(page, SHORT_NAME);
      await sendCode(page);
      await expect(page.getByRole('alert')).toHaveText(he.auth.errors.nameLength);
    },
  },
  {
    name: 'a9-signup-network-failure',
    setup: { request: [NETWORK_DOWN] },
    path: '/signup',
    act: async (page) => {
      await signupFilled(page);
      await sendCode(page);
      await expect(page.getByRole('button', { name: he.common.retry })).toBeVisible();
    },
  },
  {
    name: 'a10-signup-step2-resend-too-many',
    setup: { request: [SENT, TOO_MANY] },
    path: '/signup',
    act: async (page) => {
      await signupFilled(page);
      await sendCode(page);
      await expect(codeInput(page)).toBeFocused();
      // The 30 s cooldown, run on the page's clock.
      await page.clock.fastForward(31_000);
      await page.getByRole('button', { name: he.auth.resend }).click();
      await expect(page.getByRole('alert')).toHaveText(he.auth.errors.tooMany);
    },
  },
];

for (const state of STATES) {
  test(state.name, async ({ page }, testInfo) => {
    await page.clock.install();
    const unmatched = await mockApi(page, state.setup);
    await page.goto(state.path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await state.act(page);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      fullPage: true,
      animations: 'disabled',
      path: `screens/0009m/${state.name}-${testInfo.project.name}.png`,
    });
    expect(unmatched, 'unmatched API requests').toEqual([]);
  });
}
