import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import he from '../../locales/he.json';
import { Button, buttonClasses } from '../Button';

const label = he.profile.save;

const classesOf = (element: Element) => element.className.split(' ');

describe('Button', () => {
  it('ac2_button', () => {
    // A <button type="button"> by default; primary is ink.
    const { unmount } = render(<Button>{label}</Button>);
    const plain = screen.getByRole('button', { name: label });
    expect(plain.tagName).toBe('BUTTON');
    expect(plain).toHaveAttribute('type', 'button');
    expect(classesOf(plain)).toEqual(expect.arrayContaining(['bg-ink', 'text-on-ink']));
    expect(classesOf(plain)).toEqual(
      expect.arrayContaining(['min-h-tap', 'px-4', 'text-body', 'font-medium', 'rounded-md']),
    );
    unmount();

    // Each variant adds its classes, and every variant carries the accent focus ring.
    const variants = {
      primary: ['bg-ink', 'text-on-ink', 'hover:bg-ink/85'],
      secondary: ['border', 'border-border-strong', 'bg-surface', 'text-ink'],
      soft: ['border', 'border-accent', 'bg-accent-soft', 'text-accent-strong'],
      ghost: ['bg-transparent', 'text-accent', 'hover:bg-accent-soft', 'hover:text-accent-strong'],
      danger: ['bg-danger', 'text-on-ink', 'hover:bg-danger/90'],
    } as const;
    for (const [variant, classes] of Object.entries(variants)) {
      const { unmount: done } = render(
        <Button variant={variant as keyof typeof variants}>{label}</Button>,
      );
      const button = screen.getByRole('button');
      expect(classesOf(button)).toEqual(expect.arrayContaining([...classes]));
      expect(classesOf(button)).toEqual(
        expect.arrayContaining([
          'focus-visible:outline',
          'focus-visible:outline-2',
          'focus-visible:outline-offset-2',
          'focus-visible:outline-accent',
        ]),
      );
      done();
    }

    // Each size and shape.
    const sizes = {
      sm: ['min-h-tap', 'px-3', 'text-label'],
      md: ['min-h-tap', 'px-4', 'text-body', 'font-medium'],
      lg: ['min-h-13', 'px-5', 'text-body', 'font-medium'],
    } as const;
    for (const [size, classes] of Object.entries(sizes)) {
      const { unmount: done } = render(
        <Button size={size as keyof typeof sizes} shape="pill">
          {label}
        </Button>,
      );
      const button = screen.getByRole('button');
      expect(classesOf(button)).toEqual(expect.arrayContaining([...classes, 'rounded-full']));
      expect(classesOf(button)).not.toContain('rounded-md');
      done();
    }

    // `to` renders a link; fullWidth adds w-full.
    const linked = render(
      <MemoryRouter>
        <Button to="/search" fullWidth>
          {he.header.search}
        </Button>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: he.header.search });
    expect(link).toHaveAttribute('href', '/search');
    expect(classesOf(link)).toContain('w-full');
    linked.unmount();

    // Busy: aria-busy / aria-disabled, no onClick, still enabled and focusable, never submits.
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const busyForm = render(
      <form onSubmit={onSubmit}>
        <Button busy onClick={onClick}>
          {label}
        </Button>
        <Button busy type="submit">
          {he.listings.publish}
        </Button>
      </form>,
    );
    const busy = screen.getByRole('button', { name: label });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(busy).toBeEnabled();
    fireEvent.click(busy);
    expect(onClick).not.toHaveBeenCalled();
    busy.focus();
    expect(busy).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: he.listings.publish }));
    expect(onSubmit).not.toHaveBeenCalled();
    busyForm.unmount();

    // A non-busy click calls onClick and carries no aria-busy; disabled disables it.
    const clicked = render(
      <>
        <Button onClick={onClick}>{label}</Button>
        <Button disabled>{he.listings.publish}</Button>
      </>,
    );
    const idle = screen.getByRole('button', { name: label });
    expect(idle).not.toHaveAttribute('aria-busy');
    fireEvent.click(idle);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: he.listings.publish })).toBeDisabled();
    clicked.unmount();

    // Icon-only: square, w-tap px-0 and no px-4, named by aria-label; the icon is aria-hidden.
    const iconOnly = render(
      <Button aria-label={he.search.filters} icon={<svg data-testid="icon" />} />,
    );
    const square = screen.getByRole('button', { name: he.search.filters });
    expect(classesOf(square)).toEqual(expect.arrayContaining(['w-tap', 'px-0']));
    expect(classesOf(square)).not.toContain('px-4');
    expect(screen.getByTestId('icon').parentElement).toHaveAttribute('aria-hidden', 'true');
    iconOnly.unmount();
    const large = render(<Button size="lg" aria-label={he.search.filters} />);
    expect(classesOf(screen.getByRole('button'))).toEqual(expect.arrayContaining(['w-13', 'px-0']));
    expect(classesOf(screen.getByRole('button'))).not.toContain('px-5');
    large.unmount();

    // The ref reaches the element, and buttonClasses equals the rendered classes.
    const ref = createRef<HTMLButtonElement | HTMLAnchorElement>();
    render(
      <Button ref={ref} variant="soft" size="sm" shape="pill" fullWidth>
        {label}
      </Button>,
    );
    const rendered = screen.getByRole('button');
    expect(ref.current).toBe(rendered);
    expect(rendered.className).toBe(
      buttonClasses({ variant: 'soft', size: 'sm', shape: 'pill', fullWidth: true }),
    );
  });
});
