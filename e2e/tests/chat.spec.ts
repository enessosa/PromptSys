import { expect, test } from '@playwright/test'
import { addToTray, createCard, newConversation, uniqueTitle } from './helpers.ts'

test('chat: a card in the tray is cited in the streamed answer and listed as used', async ({ page, request }) => {
  const card = await createCard(request, uniqueTitle('Cited card'), 'Fields are required by default.')
  await page.goto('/')
  const box = await newConversation(page)
  await addToTray(page, card)

  await box.fill('What are fields by default?')
  await page.getByRole('button', { name: 'Send' }).click()

  const answer = page.getByRole('article', { name: 'Answer' })
  await expect(answer).toContainText('This is a fake answer based on the card')
  // The citation marker becomes a chip for this card, and the card row lists it as used.
  await expect(answer.getByRole('button', { name: `Open [c${card.id}]` })).toBeVisible()
  const row = answer.getByLabel('Cards of this answer')
  await expect(row).toContainText('used')
  await expect(row.getByRole('button', { name: `Open c${card.id}`, exact: true })).toBeVisible()
  await expect(row).not.toContainText(/not used\s*c\d/)
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()
})

test('chat: Stop ends a long answer, which stays as a partial answer', async ({ page }) => {
  await page.goto('/')
  const box = await newConversation(page)
  await box.fill('Please write a long answer')
  await page.getByRole('button', { name: 'Send' }).click()

  await expect(page.getByRole('article', { name: 'Answer' })).toContainText('Sentence 3 of the long fake answer')
  await page.getByRole('button', { name: 'Stop' }).click()

  await expect(page.getByText('Stopped. This answer is partial.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()
  // It really stopped: the text does not grow any more.
  const text = (await page.getByRole('article', { name: 'Answer' }).innerText()).length
  await page.waitForTimeout(400)
  expect((await page.getByRole('article', { name: 'Answer' }).innerText()).length).toBe(text)
  await expect(page.getByRole('article', { name: 'Answer' })).not.toContainText('Sentence 400')
})

test('negotiation: an excluded card is not in the assembled prompt', async ({ page, request }) => {
  const kept = await createCard(request, uniqueTitle('Kept card'), 'Kept body marker.')
  const dropped = await createCard(request, uniqueTitle('Dropped card'), 'Dropped body marker.')
  await page.goto('/')
  await newConversation(page)
  await addToTray(page, kept)
  await addToTray(page, dropped)

  const tray = page.getByRole('region', { name: 'Context tray' })
  await tray.getByRole('button', { name: `Exclude c${dropped.id}` }).click()
  await expect(tray.getByRole('button', { name: `Exclude c${dropped.id}` })).toHaveAttribute('aria-pressed', 'true')

  await tray.getByRole('button', { name: 'Show prompt' }).click()
  const dialog = page.getByRole('dialog', { name: 'Assembled prompt' })
  await expect(dialog).toContainText(kept.title)
  await expect(dialog).toContainText('Kept body marker.')
  await expect(dialog).not.toContainText(dropped.title)
  await expect(dialog).not.toContainText('Dropped body marker.')
})
