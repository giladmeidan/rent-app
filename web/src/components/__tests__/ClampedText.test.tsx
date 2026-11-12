import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import he from '../../locales/he.json';
import { ClampedText } from '../ClampedText';

// jsdom lays nothing out: the heights are stubbed on the prototype, as a browser would report them.
function stubHeights(scroll: number, client: number) {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => scroll,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => client,
  });
}

afterEach(() => {
  // Back to jsdom's own (always 0).
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
});

const TEXT = 'line one\nline two <b>not html</b> https://example.com';

describe('ClampedText', () => {
  it('ac7_toggle_only_when_overflowing', () => {
    stubHeights(120, 80);
    const { unmount } = render(
      <div>
        <h2 id="who">who</h2>
        <ClampedText
          lines={4}
          id="msg"
          describedBy="who"
          textProps={{ dir: 'auto', 'data-testid': 'the-text', className: 'self-stretch' }}
        >
          {TEXT}
        </ClampedText>
      </div>,
    );
    const text = screen.getByTestId('the-text');
    expect(text.id).toBe('msg');
    expect(text.tagName).toBe('P');
    expect(text).toHaveAttribute('dir', 'auto');
    expect(text).toHaveClass('self-stretch');
    // The clamp is on the inner block (so the paragraph's padding never shows a cut line).
    const block = text.firstElementChild as HTMLElement;
    expect(block).toHaveClass('line-clamp-4');
    // The whole text is there, as text: never HTML or a link.
    expect(text.textContent).toBe(TEXT);
    expect(block.children).toHaveLength(0);

    // Overflowing: the toggle shows, collapsed, naming the text.
    const toggle = screen.getByRole('button', { name: he.common.showMore });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'msg');
    expect(toggle).toHaveAccessibleDescription('who');

    // A click removes the clamp, expands and flips the label.
    fireEvent.click(toggle);
    expect(block).not.toHaveClass('line-clamp-4');
    const less = screen.getByRole('button', { name: he.common.showLess });
    expect(less).toHaveAttribute('aria-expanded', 'true');
    expect(text.textContent).toBe(TEXT);

    // And back.
    fireEvent.click(less);
    expect(block).toHaveClass('line-clamp-4');
    expect(screen.getByRole('button', { name: he.common.showMore })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    unmount();

    // Two lines use their own class.
    const two = render(
      <ClampedText lines={2} id="m2">
        {TEXT}
      </ClampedText>,
    );
    expect(two.container.querySelector('#m2')?.firstElementChild).toHaveClass('line-clamp-2');
    two.unmount();

    // Equal heights: it fits, so no button.
    stubHeights(80, 80);
    render(
      <ClampedText lines={4} id="m3">
        {'short'}
      </ClampedText>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('clamps_and_toggles', () => {
    // The chat's member line (spec 0009s): two lines, its role and name on the paragraph.
    stubHeights(60, 32);
    const { unmount } = render(
      <ClampedText
        lines={2}
        id="members"
        textProps={{ role: 'group', 'aria-label': 'members', className: 'text-caption' }}
      >
        {'a · b · c · d · e · f'}
      </ClampedText>,
    );
    const line = screen.getByRole('group', { name: 'members' });
    expect(line.tagName).toBe('P');
    expect(line.id).toBe('members');
    expect(line).toHaveClass('text-caption');
    expect(line.textContent).toBe('a · b · c · d · e · f');
    const block = line.firstElementChild as HTMLElement;
    expect(block).toHaveClass('line-clamp-2');
    const toggle = screen.getByRole('button', { name: he.common.showMore });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'members');
    expect(line.contains(toggle)).toBe(false);
    fireEvent.click(toggle);
    expect(block).not.toHaveClass('line-clamp-2');
    expect(screen.getByRole('button', { name: he.common.showLess })).toBe(toggle);
    unmount();

    // Equal heights: no button.
    stubHeights(32, 32);
    render(
      <ClampedText lines={2} id="fits" textProps={{ role: 'group', 'aria-label': 'members' }}>
        {'a · b'}
      </ClampedText>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
