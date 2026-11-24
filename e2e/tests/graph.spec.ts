import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { createCard, graphOf, uniqueTitle } from './helpers.ts'

const node = (page: Page, title: string) => page.locator('.react-flow__node').filter({ hasText: title })

/** Puts the cards far below everything else, so a selection box around them catches nothing but them. */
async function placeApart(request: APIRequestContext, ids: number[]) {
  const positions = ids.map((id, i) => ({ id, x: 600 * i, y: 4000 }))
  expect((await request.put('/api/graph/positions', { data: { positions } })).status()).toBe(204)
}

/** Multi-select with a selection box (Shift + drag on the pane) around the given nodes. */
async function selectWithBox(page: Page, titles: string[]) {
  const boxes = await Promise.all(titles.map(async (t) => (await node(page, t).boundingBox())!))
  const left = Math.min(...boxes.map((b) => b.x)) - 15
  const top = Math.min(...boxes.map((b) => b.y)) - 15
  const right = Math.max(...boxes.map((b) => b.x + b.width)) + 15
  const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + 15
  await page.keyboard.down('Shift')
  await page.mouse.move(left, top)
  await page.mouse.down()
  await page.mouse.move(right, bottom, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
}

async function openGraph(page: Page) {
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Ribbon' }).getByRole('button', { name: 'Graph' }).click()
  await expect(page.getByTestId('graph')).toBeVisible()
}

test('graph shows cards as nodes and a drag from handle to handle creates a link', async ({ page, request }) => {
  const a = await createCard(request, uniqueTitle('Link A'), 'first')
  const b = await createCard(request, uniqueTitle('Link B'), 'second')
  await openGraph(page)
  await expect(node(page, a.title)).toBeVisible()
  await expect(node(page, b.title)).toBeVisible()

  await node(page, a.title).locator('.react-flow__handle').last().dragTo(node(page, b.title).locator('.react-flow__handle').first())

  await expect
    .poll(async () => (await graphOf(request)).links.some((l) => [l.sourceId, l.targetId].sort().join() === [a.id, b.id].sort().join()))
    .toBe(true)
  await expect(page.locator('.react-flow__edge')).not.toHaveCount(0)
})

test('merge two selected nodes in a dialog, one node is left, undo brings both back', async ({ page, request }) => {
  const a = await createCard(request, uniqueTitle('Merge A'), 'text of a')
  const b = await createCard(request, uniqueTitle('Merge B'), 'text of b')
  await placeApart(request, [a.id, b.id])
  await openGraph(page)
  await selectWithBox(page, [a.title, b.title])
  await expect(page.getByRole('toolbar', { name: 'Selection' }).getByText('2 selected')).toBeVisible()
  await page.getByRole('toolbar', { name: 'Selection' }).getByRole('button', { name: 'Merge', exact: true }).click()

  const dialog = page.getByRole('dialog', { name: 'Merge 2 cards' })
  await expect(dialog.getByRole('textbox', { name: 'Merged text' })).toHaveValue(/text of a[\s\S]*text of b/)
  await dialog.getByRole('button', { name: 'Merge', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText(/^Merged c\d+ into c\d+\./)).toBeVisible()

  // Back in the graph, only the surviving card is left; the source is archived.
  expect((await graphOf(request)).nodes.map((n) => n.id)).toEqual(expect.arrayContaining([a.id]))
  expect((await graphOf(request)).nodes.some((n) => n.id === b.id)).toBe(false)
  await page.getByRole('navigation', { name: 'Ribbon' }).getByRole('button', { name: 'Graph' }).click()
  await expect(page.getByTestId('graph')).toBeVisible()
  await expect(node(page, a.title)).toHaveCount(1)
  await expect(node(page, b.title)).toHaveCount(0)

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText('Merge undone')).toBeVisible()
  await expect(node(page, a.title)).toHaveCount(1)
  await expect(node(page, b.title)).toHaveCount(1)
  expect((await graphOf(request)).nodes.some((n) => n.id === b.id)).toBe(true)
})
