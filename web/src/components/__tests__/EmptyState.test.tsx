import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import he from '../../locales/he.json';
import { EmptyState } from '../EmptyState';

const message = he.areas.empty;
const classesOf = (element: Element | null) => (element?.className ?? '').split(' ');

describe('EmptyState', () => {
  it('ac5_message_and_pose', () => {
    // Without a pose: the message, muted, in a Card; no mascot.
    const plain = render(<EmptyState message={message} />);
    const text = screen.getByText(message);
    expect(classesOf(text)).toEqual(expect.arrayContaining(['text-body', 'text-ink-muted']));
    const card = text.parentElement;
    expect(classesOf(card)).toEqual(
      expect.arrayContaining(['rounded-lg', 'border', 'border-border', 'bg-surface', 'p-4']),
    );
    expect(plain.container.querySelector('img')).toBeNull();
    plain.unmount();

    // With a pose: the mascot (120px, decorative) above the message, centred.
    const posed = render(<EmptyState message={message} pose="sleep" />);
    const img = posed.container.querySelector('img');
    expect(img).not.toBeNull();
    expect((img?.getAttribute('src') ?? '').split('/').pop()).toBe('homie-turtle-sleep.svg');
    expect(img).toHaveAttribute('width', '120');
    expect(img).toHaveAttribute('alt', '');
    const box = img?.parentElement ?? null;
    expect(box?.firstElementChild).toBe(img);
    expect(box?.lastElementChild).toBe(screen.getByText(message));
    expect(classesOf(box)).toEqual(
      expect.arrayContaining(['flex', 'flex-col', 'items-center', 'py-8', 'text-center']),
    );
  });
});
