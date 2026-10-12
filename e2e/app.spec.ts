import { expect, test } from '@playwright/test'
import { buildSampleTakeoutZip } from '../src/dev/sampleTakeout'

test.describe('import and browse', () => {
  test('imports a Takeout zip, assigns roles, filters and opens a place', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('empty-state')).toBeVisible()
    await page.getByTestId('go-import').click()

    const zip = Buffer.from(buildSampleTakeoutZip({ count: 120 }))
    await page.getByTestId('takeout-input').setInputFiles({ name: 'takeout-20261011.zip', mimeType: 'application/zip', buffer: zip })

    const summary = page.getByTestId('import-summary')
    await expect(summary).toBeVisible()
    await expect(summary.getByTestId('count-New lists')).toHaveText('7')

    const roles = page.getByTestId('role-assignment')
    await expect(roles.getByRole('radiogroup', { name: 'Role for Visited' }).getByRole('radio', { name: 'Visited' })).toHaveAttribute('aria-checked', 'true')
    await expect(roles.getByRole('radiogroup', { name: 'Role for Want to go' }).getByRole('radio', { name: 'Want to go' })).toHaveAttribute('aria-checked', 'true')
    await page.getByTestId('save-roles').click()

    // Back on the map with every place listed.
    await expect(page.getByTestId('result-count')).toContainText('places')
    const sheet = page.getByTestId('sheet')
    await sheet.locator('div.cursor-grab').click()
    await expect(sheet).toHaveAttribute('data-snap', 'half')
    await expect(page.getByTestId('result-row').first()).toBeVisible()

    // Filter to visited places only.
    await page.getByRole('button', { name: 'Filters' }).click()
    const visitedChip = page.getByRole('dialog', { name: 'Filters' }).getByRole('button', { name: /^Visited \d+/ }).first()
    await visitedChip.click()
    await page.getByTestId('show-results').click()
    await expect(page.getByRole('button', { name: 'Visited ✕' })).toBeVisible()
    await expect(page).toHaveURL(/status=visited/)

    // Open a place card.
    await page.getByTestId('result-row').first().click()
    await expect(page.getByTestId('place-card')).toBeVisible()
    await expect(page.getByTestId('place-card').getByText('Visited', { exact: true }).first()).toBeVisible()
  })

  test('the sample Takeout resolves places offline and search finds them', async ({ page }) => {
    await page.goto('/#/import')
    await page.getByTestId('import-sample').click()
    await expect(page.getByTestId('import-summary')).toBeVisible()
    await page.getByTestId('save-roles').click()

    // The pipeline locates everything with the fixture geocoder.
    await expect(page.getByTestId('pipeline-banner')).toBeHidden({ timeout: 60_000 })
    await page.getByLabel('Search your places').fill('kadikoy')
    await expect(page).toHaveURL(/q=kadikoy/)
    await page.getByTestId('sheet').locator('div.cursor-grab').click()
    const first = page.getByTestId('result-row').first()
    await expect(first).toContainText('Kadıköy')
  })

  test('filters in the URL survive a reload', async ({ page }) => {
    await page.goto('/#/import')
    await page.getByTestId('import-sample').click()
    await page.getByTestId('save-roles').click()
    await page.goto('/?cat=cafe&status=wantToGo')
    await expect(page.getByRole('button', { name: 'Cafe ✕' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Want to go ✕' })).toBeVisible()
  })

  test('map type and details persist across a reload', async ({ page }) => {
    await page.goto('/#/import')
    await page.getByTestId('import-sample').click()
    await page.getByTestId('save-roles').click()
    await expect(page.getByTestId('map')).toHaveAttribute('data-loaded', 'true')

    await page.getByRole('button', { name: 'Map layers' }).click()
    const panel = page.getByTestId('layers-panel')
    await panel.getByText('Satellite', { exact: true }).click()
    await panel.getByRole('button', { name: 'Globe' }).click()
    await expect(panel.getByRole('radio', { name: 'Satellite' })).toBeChecked()
    await expect(panel.getByRole('button', { name: 'Globe' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('map')).toHaveAttribute('data-basemap', 'satellite')
    await expect.poll(() => page.evaluate(() => (window as unknown as { __map: { getStyle(): { projection?: { type: string } } } }).__map.getStyle().projection?.type)).toBe('globe')

    // Traffic asks for a key instead of failing silently.
    await panel.getByRole('button', { name: 'Traffic' }).click()
    await expect(panel.getByLabel('TomTom API key')).toBeVisible()
    await panel.getByRole('button', { name: 'Traffic' }).click()
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()

    await page.reload()
    await expect(page.getByTestId('map')).toHaveAttribute('data-basemap', 'satellite')
    await page.getByRole('button', { name: 'Map layers' }).click()
    await expect(page.getByTestId('layers-panel').getByRole('button', { name: 'Globe' })).toHaveAttribute('aria-pressed', 'true')
  })
})

test.describe('phases 2 and 3', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/import')
    await page.getByTestId('import-sample').click()
    await page.getByTestId('save-roles').click()
    await expect(page.getByTestId('pipeline-banner')).toBeHidden({ timeout: 60_000 })
  })

  test('stats open the matching places on the map', async ({ page }) => {
    await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('button', { name: 'Stats' }).click()
    await expect(page.getByRole('button', { name: /^Saved: \d+/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Coverage' })).toBeVisible()
    await page.getByRole('button', { name: /^Türkiye: \d+ visited of \d+ saved\. Show on map$/ }).first().click()
    await expect(page).toHaveURL(/country=T%C3%BCrkiye/)
    await expect(page.getByRole('button', { name: 'Türkiye ✕' })).toBeVisible()
  })

  test('a saved view brings its filters back', async ({ page }) => {
    await page.goto('/?cat=cafe&status=wantToGo')
    await page.getByRole('button', { name: 'Filters' }).click()
    const dialog = page.getByRole('dialog', { name: 'Filters' })
    await dialog.getByRole('button', { name: 'Save current filters' }).click()
    await dialog.getByLabel('View name').fill('Cafes to try')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await dialog.getByRole('button', { name: 'Clear all' }).click()
    await expect(page).not.toHaveURL(/cat=cafe/)
    await dialog.getByRole('button', { name: 'Cafes to try', exact: true }).click()
    await expect(page).toHaveURL(/cat=cafe/)
    await expect(page).toHaveURL(/status=wantToGo/)
  })

  test('open now and the lasso are filters in the URL', async ({ page }) => {
    await page.getByRole('button', { name: 'Filters' }).click()
    await page.getByRole('dialog', { name: 'Filters' }).getByRole('button', { name: 'Open now' }).click()
    await expect(page).toHaveURL(/open=1/)
    await page.getByTestId('show-results').click()
    await expect(page.getByRole('button', { name: 'Open now ✕' })).toBeVisible()

    await expect(page.getByTestId('map')).toHaveAttribute('data-loaded', 'true')
    await page.getByRole('button', { name: 'Draw area' }).click()
    await page.getByTestId('lasso').waitFor()
    await page.mouse.move(100, 200)
    await page.mouse.down()
    const loop: [number, number][] = [[300, 200], [300, 450], [100, 450], [100, 210]]
    for (const [x, y] of loop) await page.mouse.move(x, y, { steps: 5 })
    await page.mouse.up()
    await expect(page).toHaveURL(/area=/)
    await expect(page.getByRole('button', { name: 'Drawn area ✕' })).toBeVisible()
  })

  test('want-to-go places can be hidden from the map and the list, and stay hidden', async ({ page }) => {
    const count = async () => Number((await page.getByTestId('result-count').innerText()).match(/[\d,]+/)![0].replace(/,/g, ''))
    const all = await count()
    await page.getByRole('button', { name: 'Map layers' }).click()
    await page.getByRole('switch', { name: /Show want-to-go places/ }).click()
    await page.getByRole('button', { name: 'Close' }).first().click()
    await expect(page.getByRole('button', { name: 'Want to go hidden ✕' })).toBeVisible()
    const shown = await count()
    expect(shown).toBeLessThan(all)

    // Filtering for want to go now finds nothing, and a reload keeps it hidden.
    await page.goto('/?status=wantToGo')
    await expect(page.getByTestId('result-count')).toHaveText(/^0 places/)
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Want to go hidden ✕' })).toBeVisible()
    await page.getByRole('button', { name: 'Want to go hidden ✕' }).click()
    await expect.poll(count).toBe(all)
  })

  test('the theme can be forced dark and back', async ({ page }) => {
    await page.goto('/#/settings')
    await page.getByRole('radio', { name: 'Dark' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.reload()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.getByRole('radio', { name: 'Light' }).click()
    await expect(page.locator('html')).not.toHaveClass(/dark/)
  })
})

