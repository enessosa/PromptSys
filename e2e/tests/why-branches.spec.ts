import { expect, test, type Page } from '@playwright/test'
import { addToTray, createCard, newConversation, uniqueTitle } from './helpers.ts'

async function askWithCard(page: Page, question: string, card: { id: number; title: string }) {
  await page.goto('/')
  const box = await newConversation(page)
  await addToTray(page, card)
  await box.fill(question)
  await page.getByRole('button', { name: 'Send' }).click()
  const answer = page.getByRole('article', { name: 'Answer' })
  await expect(answer.getByRole('button', { name: `Open [c${card.id}]` })).toBeVisible()
  // The answer is finished when the used/unused row is there and Send is back.
  await expect(answer.getByLabel('Cards of this answer')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()
  return answer
}

test('ablation: "Why?" estimates the calls, runs them and shows a result for the card', async ({ page, request }) => {
  const card = await createCard(request, uniqueTitle('Why card'), 'Some background.')
  const answer = await askWithCard(page, 'Explain it.', card)

  await answer.getByRole('button', { name: `Why [c${card.id}]?` }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Why? What did the cards change?' })
  await dialog.getByRole('spinbutton', { name: 'Runs per card' }).fill('2')
  await dialog.getByRole('spinbutton', { name: 'Baseline runs' }).fill('2')
  await dialog.getByRole('button', { name: 'Estimate API calls' }).click()
  // k baseline runs + n runs x 1 card = 2 + 2
  await expect(dialog.getByRole('status')).toContainText('Expected: 2 + 2 × 1 = 4 API calls')
  await dialog.getByRole('button', { name: 'Run 4 API calls' }).click()

  const results = dialog.getByRole('region', { name: 'Results' })
  await expect(results).toBeVisible()
  await expect(results).toContainText(`c${card.id}`)
  await expect(results).toContainText('Baseline noise')
  await expect(results).toContainText('2 runs')
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click()
  await expect(dialog).toBeHidden()
})

// FIXME (frontend bug): opening the branch view navigates to /branches/:id, but `frontend/src/App.tsx` has no route for it
// (only index, card/:id, graph, chat/:id), so the catch-all route renders "Page not found" instead of the shell.
test('branch view: opens for a conversation with an answer and shows the message tree', async ({ page, request }) => {
  const card = await createCard(request, uniqueTitle('Branch card'), 'Some background.')
  await askWithCard(page, 'A question for the branch view.', card)

  await page.getByRole('navigation', { name: 'Ribbon' }).getByRole('button', { name: 'Branches' }).click()
  await expect(page.getByRole('toolbar', { name: 'Compare timelines' })).toBeVisible()
  await expect(page.getByText('A question for the branch view.').first()).toBeVisible()
})
