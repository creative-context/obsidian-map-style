import {expect, test, type Page, type TestInfo} from '@playwright/test';
import type {Map as MapLibreMap} from 'maplibre-gl';

/**
 * The demo in a real browser: every control, every state, and the layout at
 * each size in playwright.config.ts. A screenshot of each state is saved to
 * test-results/demo/<project>/.
 */

declare global {
  interface Window {
    demoMap?: MapLibreMap;
  }
}

const LAYERS = {
  Points: ['sample-points'],
  Route: ['sample-route-halo', 'sample-route'],
  District: ['sample-district-fill', 'sample-district-edge-halo', 'sample-district-edge'],
} as const;
type Overlay = keyof typeof LAYERS;

const CENTERS = {
  madrid: [-3.7038, 40.4168],
  milan: [9.19, 45.4642],
  'mexico-city': [-99.1332, 19.4326],
} as const;

const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({page}) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', (e) => list.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') list.push(m.text());
  });
});

test.afterEach(async ({page}) => {
  expect(errors.get(page), 'console errors').toEqual([]);
});

/**
 * Waits until the map has its style, the sample data, every visible tile and
 * its labels. Labels are placed after their glyphs arrive, which can be after
 * the map reports idle, and then fade in.
 */
async function settled(page: Page) {
  const idle = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const m = window.demoMap!;
          const done = () => (m.isMoving() || !m.loaded() ? m.once('idle', done) : resolve());
          done();
        }),
    );
  await page.waitForFunction(() => {
    const m = window.demoMap;
    return !!m && m.isStyleLoaded() && !!m.getLayer('sample-points');
  });
  await idle();
  await page.waitForFunction(() => window.demoMap!.queryRenderedFeatures().some((f) => f.layer.type === 'symbol'));
  await page.waitForTimeout(500); // the label fade-in
  await idle();
}

async function view(page: Page) {
  return page.evaluate(() => {
    const m = window.demoMap!;
    const c = m.getCenter();
    return {zoom: Math.round(m.getZoom() * 10) / 10, lng: c.lng, lat: c.lat};
  });
}

async function visibility(page: Page, overlay: Overlay) {
  return page.evaluate((ids) => ids.map((id) => window.demoMap!.getLayoutProperty(id, 'visibility') ?? 'visible'), [...LAYERS[overlay]]);
}

/** Lets menus finish opening before a screenshot. */
async function animationsDone(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
}

async function shot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({path: `test-results/demo/${info.project.name}/${name}.png`});
}

const panel = (page: Page) => page.getByRole('complementary', {name: 'Map style controls'});
const zoomButton = (page: Page, label: string) => panel(page).getByRole('button', {name: label});
const readout = (page: Page) => panel(page).getByText(/^Zoom \d+\.\d/);

/** Every control and text in the panel fits: nothing cut off, nothing past the panel's edge. */
async function expectNoOverflow(page: Page) {
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    if (document.documentElement.scrollWidth > vw) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
    const panel = document.querySelector('.demo-panel')!;
    const p = panel.getBoundingClientRect();
    if (p.left < 0 || p.top < 0 || p.right > vw || p.bottom > vh) out.push(`panel leaves the window: ${JSON.stringify(p)}`);
    if (panel.scrollWidth > panel.clientWidth) out.push('panel scrolls sideways');
    for (const el of panel.querySelectorAll<HTMLElement>('button, label, a, h1, h2, h3, p, span')) {
      if (!el.offsetParent || el.closest('[role=listbox]')) continue;
      const r = el.getBoundingClientRect();
      const name = (el.innerText || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40);
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible') out.push(`"${name}" is cut off`);
      if (r.right > p.right + 0.5 || r.left < p.left - 0.5) out.push(`"${name}" sticks out of the panel`);
    }
    // MapLibre's own controls stay on screen and clear of the panel.
    const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    for (const sel of ['.maplibregl-ctrl-zoom-in', '.maplibregl-ctrl-zoom-out', '.maplibregl-ctrl-attrib']) {
      const el = document.querySelector(sel);
      if (!el) {
        out.push(`${sel} is missing`);
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.left < 0 || r.top < 0 || r.right > vw || r.bottom > vh) out.push(`${sel} leaves the window`);
      if (overlaps(r, p)) out.push(`${sel} is under the panel`);
    }
    return out;
  });
  expect(problems).toEqual([]);
}

test.describe('layout', () => {
  test('the panel, the zoom buttons and the attribution fit at this size', async ({page}, info) => {
    await page.goto('/?city=madrid');
    await settled(page);
    await shot(page, info, 'layout');
    await expectNoOverflow(page);
    await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap');
    // Everything in the panel can be reached, scrolling the panel if it has to.
    const link = panel(page).getByRole('link', {name: 'Source on GitHub'});
    await link.scrollIntoViewIfNeeded();
    await expect(link).toBeInViewport();
  });
});

test.describe('controls', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'desktop', 'every control is pressed once, at the desktop size');
  });

  test('opens on Madrid at city zoom with all the data on', async ({page}, info) => {
    await page.goto('/');
    await settled(page);
    // A plain visit has no ?city=; the view goes into the hash.
    await expect(page).toHaveURL(/\/#13\/40\.4168\/-3\.7038$/);
    await expect(panel(page).getByRole('combobox', {name: 'City'})).toHaveText('Madrid');
    await expect(zoomButton(page, 'City · 13')).toHaveAttribute('data-variant', 'primary');
    await expect(zoomButton(page, 'Region · 9')).toHaveAttribute('data-variant', 'secondary');
    await expect(readout(page)).toHaveText(/Zoom 13\.0/);
    for (const name of Object.keys(LAYERS) as Overlay[]) {
      await expect(panel(page).getByRole('switch', {name})).toBeChecked();
      expect(await visibility(page, name)).not.toContain('none');
    }
    await expect(panel(page).getByRole('link', {name: 'Source on GitHub'})).toHaveAttribute('href', 'https://github.com/creative-context/obsidian-map-style');
    await shot(page, info, 'madrid-city');
  });

  test('the zoom buttons fly to region, street and city zoom', async ({page}, info) => {
    await page.goto('/?city=madrid');
    await settled(page);
    for (const [label, zoom, name] of [
      ['Region · 9', 9, 'zoom-region'],
      ['Street · 15.5', 15.5, 'zoom-street'],
      ['City · 13', 13, 'zoom-city'],
    ] as const) {
      await zoomButton(page, label).click();
      await settled(page);
      expect((await view(page)).zoom).toBe(zoom);
      await expect(zoomButton(page, label)).toHaveAttribute('data-variant', 'primary');
      await expect(readout(page)).toHaveText(new RegExp(`Zoom ${zoom.toFixed(1).replace('.', '\\.')}`));
      await expect(page).toHaveURL(new RegExp(`#${zoom}/`));
      await shot(page, info, name);
    }
  });

  test('each switch hides and shows its data', async ({page}, info) => {
    await page.goto('/?city=madrid');
    await settled(page);
    for (const name of Object.keys(LAYERS) as Overlay[]) {
      const toggle = panel(page).getByRole('switch', {name});
      await toggle.click();
      await expect(toggle).not.toBeChecked();
      await expect.poll(() => visibility(page, name)).toEqual(LAYERS[name].map(() => 'none'));
      await shot(page, info, `${name.toLowerCase()}-off`);
    }
    await shot(page, info, 'data-off');
    for (const name of Object.keys(LAYERS) as Overlay[]) {
      const toggle = panel(page).getByRole('switch', {name});
      // The label toggles too.
      await panel(page).getByText(name, {exact: true}).click();
      await expect(toggle).toBeChecked();
      await expect.poll(() => visibility(page, name)).toEqual(LAYERS[name].map(() => 'visible'));
    }
  });

  test('the city menu opens, closes and switches the extract', async ({page}, info) => {
    await page.goto('/?city=madrid');
    await settled(page);
    const city = panel(page).getByRole('combobox', {name: 'City'});
    const menu = page.getByRole('listbox', {name: 'City'});

    await city.click();
    await expect(city).toHaveAttribute('aria-expanded', 'true');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('option')).toHaveText(['Madrid', 'Milan', 'Mexico City']);
    await animationsDone(page);
    await shot(page, info, 'city-menu');
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(city).toHaveText('Madrid');

    // A switched-off layer stays off in the next city.
    await panel(page).getByRole('switch', {name: 'Route'}).click();

    await city.click();
    await menu.getByRole('option', {name: 'Milan'}).click();
    await expect(city).toHaveText('Milan');
    await expect(page).toHaveURL(/\?city=milan#/);
    await page.waitForFunction(() => window.demoMap!.getStyle().sources.protomaps && JSON.stringify(window.demoMap!.getStyle().sources.protomaps).includes('milan'));
    await settled(page);
    const v = await view(page);
    expect(v.lng).toBeCloseTo(CENTERS.milan[0], 3);
    expect(v.lat).toBeCloseTo(CENTERS.milan[1], 3);
    expect(v.zoom).toBe(13);
    expect(await visibility(page, 'Route')).toEqual(['none', 'none']);
    expect(await visibility(page, 'Points')).toEqual(['visible']);
    await shot(page, info, 'milan-route-off');

    // By keyboard: open, move down to Mexico City, choose.
    await city.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(city).toHaveText('Mexico City');
    await expect(page).toHaveURL(/\?city=mexico-city#/);
    await page.waitForFunction(() => JSON.stringify(window.demoMap!.getStyle().sources.protomaps).includes('mexico-city'));
    await settled(page);
    const mx = await view(page);
    expect(mx.lng).toBeCloseTo(CENTERS['mexico-city'][0], 3);
    expect(mx.lat).toBeCloseTo(CENTERS['mexico-city'][1], 3);
    await shot(page, info, 'mexico-city');
  });

  test('Poland and Vietnam fly to labels in other scripts', async ({page}, info) => {
    await page.goto('/?city=madrid');
    await settled(page);
    for (const [label, lng, lat, zoom] of [
      ['Poland', 19.2, 51.8, 5.6],
      ['Vietnam', 106.0, 20.9, 6],
    ] as const) {
      await panel(page).getByRole('button', {name: label, exact: true}).click();
      await settled(page);
      const v = await view(page);
      expect(v.zoom).toBe(zoom);
      expect(v.lng).toBeCloseTo(lng, 3);
      expect(v.lat).toBeCloseTo(lat, 3);
      // No zoom preset is current this far out.
      for (const preset of ['Region · 9', 'City · 13', 'Street · 15.5']) {
        await expect(zoomButton(page, preset)).toHaveAttribute('data-variant', 'secondary');
      }
      const names = await page.evaluate(() =>
        window
          .demoMap!.queryRenderedFeatures()
          .filter((f) => f.layer.type === 'symbol')
          .map((f) => String(f.properties.name ?? '')),
      );
      expect(names.length, `labels drawn over ${label}`).toBeGreaterThan(5);
      // Letters beyond basic Latin are drawn, so the composited glyphs are in use.
      expect(names.some((n) => /[^\x00-\x7f]/.test(n)), `non-ASCII labels over ${label}`).toBe(true);
      await shot(page, info, label.toLowerCase());
    }
  });

  test('the map zooms with its buttons, the keyboard and the mouse wheel', async ({page}) => {
    await page.goto('/?city=madrid');
    await settled(page);
    await page.getByRole('button', {name: 'Zoom in'}).click();
    await settled(page);
    expect((await view(page)).zoom).toBe(14);
    await expect(readout(page)).toHaveText(/Zoom 14\.0/);
    await expect(zoomButton(page, 'City · 13')).toHaveAttribute('data-variant', 'secondary');
    await page.getByRole('button', {name: 'Zoom out'}).click();
    await settled(page);
    expect((await view(page)).zoom).toBe(13);

    // MapLibre's keyboard shortcuts, with the map focused.
    await page.locator('canvas.maplibregl-canvas').focus();
    await page.keyboard.press('=');
    await settled(page);
    expect((await view(page)).zoom).toBe(14);
    await page.keyboard.press('-');
    await settled(page);
    expect((await view(page)).zoom).toBe(13);
    const before = await view(page);
    await page.keyboard.press('ArrowRight');
    await settled(page);
    expect((await view(page)).lng).toBeGreaterThan(before.lng);

    // The wheel, over the map and clear of the panel.
    const box = (await page.locator('.demo-map').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5);
    await page.mouse.wheel(0, -600);
    await expect.poll(async () => (await view(page)).zoom).toBeGreaterThan(13);
    await settled(page);
  });

  test('the attribution opens and closes, and never goes away', async ({page}, info) => {
    await page.goto('/?city=madrid');
    await settled(page);
    const attrib = page.locator('.maplibregl-ctrl-attrib');
    const toggle = page.locator('.maplibregl-ctrl-attrib-button');
    const open = () => attrib.evaluate((el) => el.classList.contains('maplibregl-compact-show'));
    const first = await open();
    await toggle.click();
    expect(await open()).toBe(!first);
    await shot(page, info, first ? 'attribution-closed' : 'attribution-open');
    await toggle.click();
    expect(await open()).toBe(first);
    await expect(attrib).toBeVisible();
    await expect(attrib).toContainText('OpenStreetMap');
  });

  test('a shared link opens on its city and view', async ({page}, info) => {
    await page.goto('/?city=milan#15.5/45.4642/9.19');
    await settled(page);
    await expect(panel(page).getByRole('combobox', {name: 'City'})).toHaveText('Milan');
    const v = await view(page);
    expect(v.zoom).toBe(15.5);
    expect(v.lng).toBeCloseTo(9.19, 3);
    await expect(zoomButton(page, 'Street · 15.5')).toHaveAttribute('data-variant', 'primary');
    await expect(readout(page)).toHaveText(/Zoom 15\.5/);
    await shot(page, info, 'shared-link');

    // An unknown city falls back to Madrid.
    await page.goto('/?city=atlantis');
    await settled(page);
    await expect(panel(page).getByRole('combobox', {name: 'City'})).toHaveText('Madrid');
    const m = await view(page);
    expect(m.lng).toBeCloseTo(CENTERS.madrid[0], 3);
  });

  test('the README banner renders at its frame size, with the attribution', async ({page}, info) => {
    await page.goto('/?view=banner');
    const frame = page.locator('.banner-frame');
    await expect(frame).toBeVisible();
    expect(await frame.boundingBox()).toMatchObject({width: 880, height: 440});
    await expect(page.locator('.banner-attribution')).toContainText('OpenStreetMap');
    // The copy fits inside its panel.
    const cut = await page.evaluate(() => {
      const copy = document.querySelector('.banner-copy')!;
      return copy.scrollHeight > copy.clientHeight || copy.scrollWidth > copy.clientWidth;
    });
    expect(cut).toBe(false);
    await page.waitForLoadState('networkidle');
    await frame.screenshot({path: `test-results/demo/${info.project.name}/banner.png`});
  });
});
