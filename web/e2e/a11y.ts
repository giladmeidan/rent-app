import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** The WCAG 2.2 A/AA rules (2.0 and 2.1 included) and axe's best practices. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/**
 * Runs axe on the page as it is now and fails with one line per violation: its id, impact, help
 * and first three targets. No rule is disabled here unless another spec owns its fix; then the
 * `disableRules` line names the rule, the reason and that spec (spec 0009c).
 */
export async function expectNoAxeViolations(page: Page, label: string): Promise<void> {
  // Every rule but color-contrast, on the whole page (MapLibre's attribution included).
  const main = await new AxeBuilder({ page })
    .withTags(TAGS)
    // Checked by the run below, which may skip the attribution (not disabled).
    .disableRules(['color-contrast'])
    .analyze();
  // color-contrast alone, without MapLibre's attribution: it sits over the map tiles, whose
  // colours axe cannot know. The only exclude allowed (spec 0009c Scope 7).
  const contrast = await new AxeBuilder({ page })
    .withRules(['color-contrast'])
    .exclude('.maplibregl-ctrl-attrib')
    .analyze();
  const violations = [...main.violations, ...contrast.violations].map((violation) => {
    const targets = violation.nodes
      .slice(0, 3)
      .map((node) => node.target.map(String).join(' '))
      .join(' | ');
    return `${violation.id} (${violation.impact ?? 'unknown'}): ${violation.help} [${targets}]`;
  });
  expect(violations, `axe violations on ${label}`).toEqual([]);
}
