import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import i18n from '../../app/i18n';
import he from '../../locales/he.json';
import { TabPanel, Tabs, tabId } from '../Tabs';

const VALUES = ['all', 'new', 'shortlisted', 'declined'] as const;
type Value = (typeof VALUES)[number];
const labelOf = (value: Value) => i18n.t(`applicants.filter.${value}`, { count: 0 });

function Harness({
  dir,
  onChange,
  variant,
}: {
  dir: 'rtl' | 'ltr';
  onChange?: (value: Value) => void;
  variant?: 'underline' | 'pill';
}) {
  const [value, setValue] = useState<Value>('all');
  return (
    <div dir={dir}>
      <Tabs
        label={he.applicants.filter.label}
        items={VALUES.map((v) => ({ value: v, label: labelOf(v) }))}
        value={value}
        onChange={(next) => {
          onChange?.(next);
          setValue(next);
        }}
        panelId="filter-panel"
        variant={variant}
      />
      <TabPanel panelId="filter-panel" value={value}>
        {he.applicants.emptyFilter}
      </TabPanel>
    </div>
  );
}

const tab = (value: Value) => screen.getByRole('tab', { name: labelOf(value) });

describe('Tabs', () => {
  it('ac6_tabs_keyboard_rtl', () => {
    const onChange = vi.fn();
    const { unmount } = render(<Harness dir="rtl" onChange={onChange} />);

    // One labelled tablist; each tab is wired and roving.
    const list = screen.getByRole('tablist', { name: he.applicants.filter.label });
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
    expect(list).toHaveClass('flex', 'border-b', 'border-border');
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    for (const [i, el] of tabs.entries()) {
      expect(el.tagName).toBe('BUTTON');
      expect(el).toHaveAttribute('type', 'button');
      expect(el).toHaveAttribute('aria-controls', 'filter-panel');
      expect(el).toHaveAttribute('aria-selected', i === 0 ? 'true' : 'false');
      expect(el).toHaveAttribute('tabIndex', i === 0 ? '0' : '-1');
      expect(el).toHaveAttribute('id', tabId('filter-panel', VALUES[i] as Value));
      expect(el).toHaveClass('min-h-tap', 'focus-visible:outline-accent');
    }
    expect(tab('all')).toHaveClass('border-accent', 'text-accent', 'font-semibold');
    expect(tab('new')).toHaveClass('border-transparent', 'text-ink-muted');
    expect(tab('new')).not.toHaveClass('text-accent');

    // RTL: ArrowLeft on the first selects and focuses the second.
    tab('all').focus();
    fireEvent.keyDown(tab('all'), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('new');
    expect(tab('new')).toHaveAttribute('aria-selected', 'true');
    expect(tab('new')).toHaveAttribute('tabIndex', '0');
    expect(tab('all')).toHaveAttribute('tabIndex', '-1');
    expect(tab('new')).toHaveFocus();

    // ArrowRight goes back; ArrowRight on the first wraps to the last.
    fireEvent.keyDown(tab('new'), { key: 'ArrowRight' });
    expect(tab('all')).toHaveFocus();
    fireEvent.keyDown(tab('all'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('declined');
    expect(tab('declined')).toHaveFocus();
    expect(tab('declined')).toHaveAttribute('aria-selected', 'true');
    // ArrowLeft on the last wraps to the first; End goes to the last.
    fireEvent.keyDown(tab('declined'), { key: 'ArrowLeft' });
    expect(tab('all')).toHaveFocus();
    fireEvent.keyDown(tab('all'), { key: 'End' });
    expect(tab('declined')).toHaveFocus();
    expect(tab('declined')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(tab('declined'), { key: 'Home' });
    expect(tab('all')).toHaveFocus();
    expect(tab('all')).toHaveAttribute('aria-selected', 'true');

    // Home on the selected first tab does nothing.
    onChange.mockClear();
    fireEvent.keyDown(tab('all'), { key: 'Home' });
    expect(onChange).not.toHaveBeenCalled();
    expect(tab('all')).toHaveFocus();

    // Other keys are left alone.
    fireEvent.keyDown(tab('all'), { key: 'ArrowDown' });
    expect(onChange).not.toHaveBeenCalled();

    // A click calls onChange.
    fireEvent.click(tab('shortlisted'));
    expect(onChange).toHaveBeenLastCalledWith('shortlisted');
    expect(tab('shortlisted')).toHaveAttribute('aria-selected', 'true');

    // The panel is labelled by the selected tab.
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('id', 'filter-panel');
    expect(panel).toHaveAttribute('aria-labelledby', tab('shortlisted').id);
    expect(panel).toHaveAccessibleName(labelOf('shortlisted'));
    expect(panel).not.toHaveAttribute('tabIndex');
    unmount();

    // LTR: ArrowRight is next.
    const ltr = render(<Harness dir="ltr" />);
    tab('all').focus();
    fireEvent.keyDown(tab('all'), { key: 'ArrowRight' });
    expect(tab('new')).toHaveFocus();
    expect(tab('new')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(tab('new'), { key: 'ArrowLeft' });
    expect(tab('all')).toHaveFocus();
    ltr.unmount();

    // The pill variant.
    render(<Harness dir="rtl" variant="pill" />);
    expect(screen.getByRole('tablist')).toHaveClass(
      'inline-flex',
      'rounded-full',
      'bg-surface-subtle',
    );
    expect(tab('all')).toHaveClass('rounded-full', 'bg-surface', 'shadow-segment', 'min-h-tap');
    expect(tab('new')).toHaveClass('text-ink-muted');
    expect(tab('new')).not.toHaveClass('bg-surface');
  });

  it('ac6_tab_panel_focusable_and_tab_ref', () => {
    const tabRef = { current: null as HTMLButtonElement | null };
    render(
      <div dir="rtl">
        <Tabs
          label={he.search.view.label}
          items={[
            { value: 'list', label: he.search.view.list },
            { value: 'map', label: he.search.view.map },
          ]}
          value="map"
          onChange={() => {}}
          panelId="view"
          tabRef={tabRef}
        />
        <TabPanel panelId="view" value="map" focusable>
          {he.search.map.empty}
        </TabPanel>
      </div>,
    );
    expect(tabRef.current).toBe(screen.getByRole('tab', { name: he.search.view.map }));
    expect(screen.getByRole('tabpanel')).toHaveAttribute('tabIndex', '0');
    expect(tabId('view', 'map')).toBe('view-tab-map');
  });
});
