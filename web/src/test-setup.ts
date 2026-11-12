import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import './app/i18n';

/**
 * jsdom has no `EventSource`. This stand-in records every instance (`instances`) and lets a test
 * drive it: `open()`, `emit(type, data)` (a named event with JSON data) and `fail(closed)` (an
 * `error`, leaving `CLOSED` when the server refused the stream, else `CONNECTING`). A closed source
 * receives nothing more. Assigned directly, not with `vi.stubGlobal`, so the tests'
 * `vi.unstubAllGlobals()` keeps it.
 */
export class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;
  readonly url: string;
  readonly withCredentials: boolean;
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string | URL, init?: EventSourceInit) {
    super();
    this.url = String(url);
    this.withCredentials = init?.withCredentials ?? false;
    FakeEventSource.instances.push(this);
  }

  /** The instances not closed yet. */
  static live(): FakeEventSource[] {
    return FakeEventSource.instances.filter((s) => s.readyState !== FakeEventSource.CLOSED);
  }

  /** The newest instance. */
  static latest(): FakeEventSource {
    const latest = FakeEventSource.instances.at(-1);
    if (latest === undefined) throw new Error('no EventSource was created');
    return latest;
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }

  open(): void {
    if (this.readyState === FakeEventSource.CLOSED) return;
    this.readyState = FakeEventSource.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  emit(type: string, data: unknown): void {
    if (this.readyState === FakeEventSource.CLOSED) return;
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
  }

  fail(closed: boolean): void {
    if (this.readyState === FakeEventSource.CLOSED) return;
    this.readyState = closed ? FakeEventSource.CLOSED : FakeEventSource.CONNECTING;
    this.dispatchEvent(new Event('error'));
  }
}

globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
// jsdom lays nothing out, so it has no scrolling either.
Element.prototype.scrollIntoView = () => {};
window.scrollTo = () => {};

/**
 * A `<dialog>` stand-in (spec 0009d §6), installed unconditionally so every jsdom version behaves
 * the same: `showModal()` sets `open` (a no-op when already open); `close()` removes it and
 * dispatches `close` synchronously (a no-op with no event when already closed). The real modal
 * (focus trap, top layer, Esc) is proven in a browser (0009d AC11).
 */
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
  if (this.hasAttribute('open')) return;
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
  if (!this.hasAttribute('open')) return;
  this.removeAttribute('open');
  this.dispatchEvent(new Event('close'));
};

afterEach(() => {
  cleanup();
  FakeEventSource.instances = [];
});
