import { expect, test } from '@playwright/test'

test('offline: an unreachable backend shows the offline overlay, it goes away when the backend is back', async ({ page }) => {
  let down = true
  await page.route('**/api/health', (route) => (down ? route.abort('connectionrefused') : route.continue()))
  await page.goto('/')

  const overlay = page.getByRole('alert').filter({ hasText: 'Backend not reachable' })
  await expect(overlay).toBeVisible()
  await expect(page.getByText('Backend offline', { exact: true })).toBeVisible()

  // The health check polls every 3 s while the backend is down; after it succeeds the overlay is gone.
  down = false
  await expect(overlay).toBeHidden({ timeout: 10_000 })
  await expect(page.getByText('Backend ok')).toBeVisible()
})
