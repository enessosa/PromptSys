import { expect, test } from '@playwright/test'
import { uniqueTitle } from './helpers.ts'

test('create a card, edit title and body, autosave survives a reload', async ({ page, request }) => {
  await page.goto('/')
  const title = uniqueTitle('Edited card')
  const body = 'Fields are required by default.'

  const sidebar = page.getByRole('complementary', { name: 'Sidebar' })
  await sidebar.getByRole('button', { name: 'New card', exact: true }).first().click()

  // The new card opens in an editor tab.
  const titleInput = page.getByRole('textbox', { name: 'Title' })
  await expect(titleInput).toHaveValue('Untitled')
  await titleInput.fill(title)
  await page.getByRole('textbox', { name: 'Body' }).fill(body)

  // Autosave (debounced) reports the new version.
  await expect(page.getByText(/^Saved · v[2-9]/)).toBeVisible()
  await expect(sidebar.getByRole('treeitem', { name: new RegExp(title) })).toBeVisible()

  const id = Number(new URL(page.url()).pathname.split('/').pop())
  const saved = await (await request.get(`/api/cards/${id}`)).json()
  expect(saved).toMatchObject({ title, body })

  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(title)
  await expect(page.getByRole('textbox', { name: 'Body' })).toHaveValue(body)
})
