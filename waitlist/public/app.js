// The waitlist page (spec 0017): tabs, the two forms, the counter, the video and the small motion.
// No framework; the field rules are validate.js's, the same module the server runs.
import { CITIES } from './cities.js';
import { validateSignup } from './validate.js';

const TEXT = {
  sending: 'בשליחה…',
  error: 'משהו השתבש. אפשר לנסות שוב בעוד רגע.',
  offline: 'אין חיבור לאינטרנט',
  videoError: 'הסרטון לא נטען. אפשר לנסות שוב מאוחר יותר.',
  counter: (n) => ['כבר ', n, ' נרשמו לרשימה'],
  success: (email) => ['נעדכן ב-', email, ' ברגע שהומי עולה לאוויר. לאט לאט? ממש לא.'],
  fields: {
    email: 'צריך אימייל תקין, למשל name@example.com',
    phone: 'מספר הטלפון לא נראה תקין. אפשר גם להשאיר ריק.',
    kind: { seeker: 'צריך לבחור מה מחפשים', lister: 'צריך לבחור מה מפרסמים' },
    city: 'צריך לבחור עיר',
    units: 'צריך לבחור כמה נכסים',
    available: 'צריך לבחור מתי הנכס מתפנה',
    consent: 'כדי להירשם צריך לסמן את האישור',
  },
};

const SIDES = ['seeker', 'lister'];
const SVG_NS = 'http://www.w3.org/2000/svg';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** The alert icon in front of error text: an outline circle with "!", like the interface icons. */
function alertIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ['M12 7.5v5.5', 'M12 16.5h.01']) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '9');
  svg.prepend(circle);
  return svg;
}

function setMessage(element, text) {
  const span = document.createElement('span');
  span.textContent = text;
  element.replaceChildren(alertIcon(), span);
}

// ---------------------------------------------------------------------------------------------
// Tabs (WAI-ARIA tabs; arrows follow the visual order, so in RTL the right arrow goes back).

const tablist = document.querySelector('[role="tablist"]');
const tabs = [...tablist.querySelectorAll('[role="tab"]')];

function selectSide(side, { focus = false } = {}) {
  for (const tab of tabs) {
    const selected = tab.dataset.side === side;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
    if (selected && focus) tab.focus({ preventScroll: true });
  }
}

tablist.addEventListener('click', (event) => {
  const tab = event.target.closest('[role="tab"]');
  if (tab) selectSide(tab.dataset.side, { focus: true });
});

tablist.addEventListener('keydown', (event) => {
  const index = tabs.indexOf(document.activeElement);
  if (index === -1) return;
  const rtl = getComputedStyle(tablist).direction === 'rtl';
  const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
  const back = rtl ? 'ArrowRight' : 'ArrowLeft';
  let next;
  if (event.key === forward) next = Math.min(index + 1, tabs.length - 1);
  else if (event.key === back) next = Math.max(index - 1, 0);
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = tabs.length - 1;
  else return;
  event.preventDefault();
  selectSide(tabs[next].dataset.side, { focus: true });
});

/** The hero buttons and the door links: scroll to #join with their side's tab selected. */
for (const link of document.querySelectorAll('a[data-side]')) {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    const side = link.dataset.side;
    selectSide(side);
    document.getElementById('join').scrollIntoView({
      behavior: reducedMotion.matches ? 'auto' : 'smooth',
      block: 'start',
    });
    tabs.find((tab) => tab.dataset.side === side).focus({ preventScroll: true });
  });
}

const requested = new URLSearchParams(window.location.search).get('side');
selectSide(SIDES.includes(requested) ? requested : 'seeker');
// A deep link (?side=lister) opens on the form; a hash of its own is left to the browser.
if (SIDES.includes(requested) && window.location.hash === '') {
  document.getElementById('join').scrollIntoView({ block: 'start' });
}

// ---------------------------------------------------------------------------------------------
// Forms

for (const select of document.querySelectorAll('select[data-cities]')) {
  for (const [key, label] of CITIES) select.append(new Option(label, key));
}

/** The request body from the form, keys as the API takes them; an unanswered field is left out. */
function readForm(form) {
  const side = form.dataset.side;
  const { elements } = form;
  const body = {
    side,
    email: elements.email.value,
    consent: elements.consent.checked,
    website: elements.website.value,
  };
  const optional = (name) => {
    const value = elements[name].value;
    if (value !== '') body[name] = value;
  };
  optional('kind');
  if (elements.city.value !== '') body.city = elements.city.value;
  if (side === 'lister') {
    body.phone = elements.phone.value;
    // Control and format characters (a pasted tab, a bidi mark) become spaces here; the server still
    // refuses raw ones.
    body.neighbourhood = elements.neighbourhood.value.replace(/[\p{Cc}\p{Cf}]/gu, ' ');
    optional('units');
    optional('available');
  }
  return body;
}

/** Where each field's error goes: the element marked invalid, the one focused, the message. */
function fieldParts(form, key) {
  const side = form.dataset.side;
  const error = document.getElementById(`${side}-${key}-error`);
  if (error === null) return null;
  if (['kind', 'units', 'available'].includes(key)) {
    const group = document.getElementById(`${side}-${key}`);
    return { target: group, focus: group.querySelector('input'), error };
  }
  const control = form.elements[key];
  return { target: control, focus: control, error };
}

function messageFor(form, key) {
  const message = TEXT.fields[key];
  return typeof message === 'object' ? message[form.dataset.side] : message;
}

function describedBy(target, id, on) {
  const ids = new Set((target.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean));
  if (on) ids.add(id);
  else ids.delete(id);
  if (ids.size > 0) target.setAttribute('aria-describedby', [...ids].join(' '));
  else target.removeAttribute('aria-describedby');
}

function clearField(form, key) {
  const parts = fieldParts(form, key);
  if (parts === null) return;
  parts.error.hidden = true;
  parts.error.replaceChildren();
  parts.target.removeAttribute('aria-invalid');
  describedBy(parts.target, parts.error.id, false);
}

const FIELD_KEYS = ['email', 'phone', 'kind', 'city', 'units', 'available', 'consent'];

function clearFieldErrors(form) {
  for (const key of FIELD_KEYS) clearField(form, key);
}

/** Shows each field's message; returns false when a key has no message (the banner covers it). */
function showFieldErrors(form, keys) {
  let first = null;
  let allShown = true;
  for (const key of keys) {
    const parts = fieldParts(form, key);
    const message = messageFor(form, key);
    if (parts === null || message === undefined) {
      allShown = false;
      continue;
    }
    setMessage(parts.error, message);
    parts.error.hidden = false;
    parts.target.setAttribute('aria-invalid', 'true');
    describedBy(parts.target, parts.error.id, true);
    first ??= parts.focus;
  }
  if (first !== null) first.focus();
  return allShown && keys.length > 0;
}

function banner(form) {
  return form.querySelector('.banner');
}

function showBanner(form) {
  const element = banner(form);
  setMessage(element, navigator.onLine === false ? TEXT.offline : TEXT.error);
  element.classList.add('is-shown');
}

function hideBanner(form) {
  const element = banner(form);
  element.classList.remove('is-shown');
  element.replaceChildren();
}

function setBusy(form, busy) {
  const button = form.querySelector('.form__submit');
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = TEXT.sending;
    button.setAttribute('aria-disabled', 'true');
  } else {
    button.textContent = button.dataset.label ?? button.textContent;
    button.removeAttribute('aria-disabled');
  }
  form.dataset.busy = busy ? 'true' : '';
}

/** The address each side signed up with, normalised, for the other side's fresh form. */
const joinedEmail = new Map();

function showSuccess(form, email) {
  joinedEmail.set(form.dataset.side, email);
  // Once both sides have joined there is no other side left to offer.
  for (const other of document.querySelectorAll('.success__other')) {
    other.hidden = joinedEmail.has(other.dataset.side);
  }
  const panel = form.closest('[role="tabpanel"]');
  const success = panel.querySelector('.success');
  const line = success.querySelector('.success__line');
  const [before, , after] = TEXT.success(email);
  const address = document.createElement('bdi');
  address.textContent = email;
  line.replaceChildren(before, address, after);
  form.hidden = true;
  success.hidden = false;
  success.querySelector('.success__title').focus();
}

/** A fresh form on the other side, the email carried over. */
function joinOtherSide(side, email) {
  const panel = document.getElementById(`panel-${side}`);
  const form = panel.querySelector('form');
  form.reset();
  clearFieldErrors(form);
  hideBanner(form);
  form.hidden = false;
  panel.querySelector('.success').hidden = true;
  form.elements.email.value = email;
  selectSide(side, { focus: true });
}

async function submit(form) {
  if (form.dataset.busy === 'true') return;
  // The banner stays until the answer comes, so the button does not move under a second click.
  clearFieldErrors(form);
  const body = readForm(form);
  const result = validateSignup(body);
  if (!result.ok) {
    hideBanner(form);
    if (!showFieldErrors(form, result.fields)) showBanner(form);
    return;
  }
  setBusy(form, true);
  try {
    const response = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(15000) : undefined,
    });
    if (response.ok) {
      hideBanner(form);
      showSuccess(form, result.value.email);
      return;
    }
    if (response.status === 400) {
      const data = await response.json().catch(() => null);
      const fields = Array.isArray(data?.fields)
        ? data.fields.filter((key) => typeof key === 'string')
        : [];
      hideBanner(form);
      if (showFieldErrors(form, fields)) return;
    }
    showBanner(form);
  } catch {
    showBanner(form);
  } finally {
    setBusy(form, false);
  }
}

for (const form of document.querySelectorAll('form[data-side]')) {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit(form);
  });
  // A field's message goes as soon as that field is edited (on input, not on blur: a message
  // vanishing on blur would move the submit button under the pointer).
  form.addEventListener('input', (event) => {
    const key = event.target.name;
    if (FIELD_KEYS.includes(key)) clearField(form, key);
  });
}

for (const button of document.querySelectorAll('.success__other')) {
  button.addEventListener('click', () => {
    const from = button.closest('[role="tabpanel"]').dataset.side;
    joinOtherSide(button.dataset.side, joinedEmail.get(from) ?? '');
  });
}

// ---------------------------------------------------------------------------------------------
// Counter: shown only when the API returns a number; hidden on null, on failure and while loading.

async function loadCounter() {
  const counter = document.getElementById('counter');
  try {
    const response = await fetch('/api/count', { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const { total } = await response.json();
    if (typeof total !== 'number' || !Number.isFinite(total)) return;
    const number = document.createElement('strong');
    number.textContent = total.toLocaleString('he-IL');
    const [before, , after] = TEXT.counter(total);
    counter.replaceChildren(before, number, after);
    counter.classList.add('is-visible');
  } catch {
    // No counter is better than a wrong one.
  }
}

loadCounter();

// ---------------------------------------------------------------------------------------------
// Video: plays only on click, then the native controls take over.

const frame = document.getElementById('video-frame');
const video = document.getElementById('promo');
const play = document.getElementById('video-play');

function showVideoError() {
  const line = document.getElementById('video-error');
  const hadFocus = frame.contains(document.activeElement);
  frame.classList.add('has-error');
  play.hidden = true;
  line.textContent = TEXT.videoError;
  // The video is hidden now; focus the line (it is announced) rather than leave focus on nothing.
  if (hadFocus) line.focus({ preventScroll: true });
}

video.addEventListener('error', showVideoError);
// The native controls wait under the play button (without JS they are there from the start).
video.controls = false;

play.addEventListener('click', () => {
  play.hidden = true;
  video.controls = true;
  video.focus({ preventScroll: true });
  const started = video.play();
  if (started && typeof started.catch === 'function') {
    started.catch(() => {
      if (video.error) {
        showVideoError();
      } else {
        video.controls = false;
        play.hidden = false;
      }
    });
  }
});

// ---------------------------------------------------------------------------------------------
// Motion and the header border.

const header = document.querySelector('.site-header');
const sentinel = document.querySelector('.scroll-sentinel');
const reveals = [...document.querySelectorAll('.reveal')];

if ('IntersectionObserver' in window) {
  new IntersectionObserver(([entry]) => {
    header.classList.toggle('is-scrolled', !entry.isIntersecting);
  }).observe(sentinel);

  // Sections already on screen are shown at once; the rest fade up the first time they scroll in.
  for (const section of reveals) {
    if (section.getBoundingClientRect().top < window.innerHeight) section.classList.add('is-revealed');
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-revealed');
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -10% 0px' },
  );
  for (const section of reveals) if (!section.classList.contains('is-revealed')) observer.observe(section);
} else {
  for (const section of reveals) section.classList.add('is-revealed');
}
document.documentElement.classList.add('js');
