import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Skeleton } from '../Skeleton';

const classesOf = (element: Element) => element.getAttribute('class')?.split(' ') ?? [];
const BAR = ['bg-border', 'animate-pulse', 'motion-reduce:animate-none'];

describe('Skeleton', () => {
  it('ac5_one_hidden_skeleton', () => {
    // The default block: one hidden card-shaped placeholder with one bar.
    const block = render(<Skeleton />);
    const found = block.container.querySelectorAll('[data-testid="skeleton"]');
    expect(found).toHaveLength(1);
    const outer = found[0] as Element;
    expect(outer).toBe(block.container.firstElementChild);
    expect(outer).toHaveAttribute('aria-hidden', 'true');
    expect(classesOf(outer)).toEqual(
      expect.arrayContaining(['rounded-lg', 'border-border', 'px-4', 'py-3.5']),
    );
    const bars = outer.querySelectorAll('.animate-pulse');
    expect(bars).toHaveLength(1);
    expect(classesOf(bars[0] as Element)).toEqual(expect.arrayContaining(BAR));
    block.unmount();

    // With size classes: a plain bar.
    const inline = render(<Skeleton className="h-5 w-24" />);
    const plain = inline.container.querySelectorAll('[data-testid="skeleton"]');
    expect(plain).toHaveLength(1);
    expect(plain[0]).toHaveAttribute('aria-hidden', 'true');
    expect(classesOf(plain[0] as Element)).toEqual(expect.arrayContaining([...BAR, 'h-5', 'w-24']));
  });
});
