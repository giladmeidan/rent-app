import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import he from '../../locales/he.json';
import { Mascot, type MascotPose } from '../Mascot';

const FILES: Record<MascotPose, string> = {
  default: 'homie-turtle.svg',
  hello: 'homie-turtle-hello.svg',
  search: 'homie-turtle-search.svg',
  celebrate: 'homie-turtle-celebrate.svg',
  sleep: 'homie-turtle-sleep.svg',
};

const imgOf = (container: HTMLElement) => container.querySelector('img') as HTMLImageElement;

describe('Mascot', () => {
  it('ac8_mascot_pose_and_min_width', () => {
    for (const [pose, file] of Object.entries(FILES)) {
      const { container, unmount } = render(<Mascot pose={pose as MascotPose} />);
      const img = imgOf(container);
      expect((img.getAttribute('src') ?? '').split('/').pop()).toBe(file);
      unmount();
    }

    // The default: 160 × 120, decorative, not draggable, never transformed.
    const plain = render(<Mascot />);
    const img = imgOf(plain.container);
    expect((img.getAttribute('src') ?? '').split('/').pop()).toBe('homie-turtle.svg');
    expect(img).toHaveAttribute('width', '160');
    expect(img).toHaveAttribute('height', '120');
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('draggable', 'false');
    expect(img.className).not.toMatch(/scale-x|-scale|rotate/);
    plain.unmount();

    // Below the brand minimum: raised to 96 (height 72).
    const small = render(<Mascot width={60} className="mx-auto" />);
    expect(imgOf(small.container)).toHaveAttribute('width', '96');
    expect(imgOf(small.container)).toHaveAttribute('height', '72');
    expect(imgOf(small.container).className).not.toMatch(/scale-x|-scale|rotate/);
    small.unmount();

    // A caller that gives it meaning passes its alt.
    const named = render(<Mascot pose="celebrate" width={200} alt={he.applications.sent} />);
    expect(imgOf(named.container)).toHaveAttribute('alt', he.applications.sent);
    expect(imgOf(named.container)).toHaveAttribute('width', '200');
    expect(imgOf(named.container)).toHaveAttribute('height', '150');
  });
});
