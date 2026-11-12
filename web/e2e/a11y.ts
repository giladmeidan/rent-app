import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** The WCAG 2.2 A/AA rules (2.0 and 2.1 included) and axe's best practices. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

type Options = {
  /** Rules skipped for this one check only, each because another spec owns its fix; the call
   * site names the rule, the reason and that spec (spec 0009c). */
  disableRules?: string[];
  /** A page with the search map's pins: `target-size` is not checked on the pins only, under
   * WCAG 2.5.8's "essential" exception (pins sit at their listings' true positions, so close
   * listings overlap; accepted by Gilad 2026-11-12, spec 0009t). Every other control keeps the
   * rule, and the pins keep every other rule. */
  markerTargetSizeExempt?: boolean;
};

/** The search map's pins (MapLibre's marker elements). */
const MARKER = '.maplibregl-marker';

/**
 * Runs axe on the page as it is now and fails with one line per violation: its id, impact, help
 * and first three targets. No rule is disabled here; a call may skip one for its own page only
 * (`options.disableRules`) when another spec owns the fix, and a map page may exempt its pins
 * alone from `target-size` (`options.markerTargetSizeExempt`).
 */
export async function expectNoAxeViolations(
  page: Page,
  label: string,
  { disableRules = [], markerTargetSizeExempt = false }: Options = {},
): Promise<void> {
  // Every rule but color-contrast, on the whole page (MapLibre's attribution included); with the
  // marker exemption, on everything but the pins.
  const mainBuilder = new AxeBuilder({ page })
    .withTags(TAGS)
    // color-contrast is checked by the run below, which may skip the attribution (not disabled).
    .disableRules(['color-contrast', ...disableRules]);
  if (markerTargetSizeExempt) mainBuilder.exclude(MARKER);
  const main = await mainBuilder.analyze();
  // The pins alone, with every rule of the main run but target-size (axe fails an `include` that
  // matches nothing, so only when pins are shown).
  const markers =
    markerTargetSizeExempt && (await page.locator(MARKER).count()) > 0
      ? await new AxeBuilder({ page })
          .include(MARKER)
          .withTags(TAGS)
          .disableRules(['color-contrast', 'target-size', ...disableRules])
          .analyze()
      : { violations: [] };
  // color-contrast alone, without MapLibre's attribution: it sits over the map tiles, whose
  // colours axe cannot know. The only exclude allowed besides the pins' target-size scope above
  // (spec 0009c Scope 7, spec 0009t).
  const contrast = await new AxeBuilder({ page })
    .withRules(['color-contrast'])
    .exclude('.maplibregl-ctrl-attrib')
    .analyze();
  const violations = [...main.violations, ...markers.violations, ...contrast.violations].map(
    (violation) => {
      const targets = violation.nodes
        .slice(0, 3)
        .map((node) => node.target.map(String).join(' '))
        .join(' | ');
      return `${violation.id} (${violation.impact ?? 'unknown'}): ${violation.help} [${targets}]`;
    },
  );
  expect(violations, `axe violations on ${label}`).toEqual([]);
}
