import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { uniqueTitle } from './helpers.ts'

const mode = (page: Page, name: 'API' | 'Agent') => page.getByTestId('sidebar').getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name })

async function createSession(page: Page, folder: string, title: string) {
  await page.getByRole('button', { name: 'New session' }).click()
  const dialog = page.getByRole('dialog', { name: 'New session' })
  await dialog.getByPlaceholder('/Users/me/project').fill(folder)
  await dialog.getByPlaceholder('Empty = folder name').fill(title)
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(dialog).toBeHidden()
}

test('claude code mode: session, echo, card, approval, review, second session, back to API', async ({ page }) => {
  const folder = mkdtempSync(join(tmpdir(), 'promptsys-e2e-'))
  const first = uniqueTitle('Code A')
  const second = uniqueTitle('Code B')
  try {
    await page.goto('/')
    await mode(page, 'Agent').click()
    await expect(mode(page, 'Agent')).toBeChecked()

    await createSession(page, folder, first)
    const box = page.getByRole('textbox', { name: 'Message' })
    await expect(box).toBeVisible()

    // Plain prompt: echoed text and a card chip.
    await box.fill('explain the build')
    await page.getByRole('button', { name: 'Send' }).click()
    const timeline = page.getByRole('list', { name: 'Timeline' })
    await expect(timeline).toContainText('Working on: explain the build')
    await expect(timeline.getByRole('button', { name: /^Card c\d+ / })).toBeVisible()
    await expect(page.getByRole('status')).toContainText(/idle|ready|done|finished/i)

    // Prompt with "edit": approval card, Allow, tool result.
    await box.fill('please edit README')
    await page.getByRole('button', { name: 'Send' }).click()
    const approval = page.getByRole('group', { name: 'Tool Edit' })
    await expect(approval).toBeVisible()
    // While the agent waits, a new message is queued and runs after the turn.
    await box.fill('queued task')
    await page.getByRole('button', { name: 'Queue' }).click()
    await expect(page.getByRole('list', { name: 'Queued messages' })).toContainText('queued task')
    await approval.getByRole('button', { name: 'Allow' }).click()
    await expect(timeline).toContainText('Working on: queued task')
    await expect(page.getByRole('list', { name: 'Queued messages' })).toHaveCount(0)
    await expect(approval).toContainText('Allowed')
    await expect(page.getByRole('group', { name: 'Tool Edit' })).toHaveCount(1)
    await approval.getByRole('button', { name: 'Show details' }).click()
    await expect(approval.locator('pre[data-result]')).toHaveText('Edited README.md (fake)')

    // Status line and permission mode: "Accept edits" runs the next edit without asking.
    const line = page.getByRole('group', { name: 'Session status' })
    await expect(line).toContainText('13%')
    await expect(line).toContainText('Tokens 75k')
    await expect(page.getByTestId('plan-usage')).toHaveText(/^Plan limits\s*5h\s*34%\s*(reset|↻ [0-9dhm ]+)\s*7d\s*12%\s*(reset|↻ [0-9dhm ]+)$/)
    await line.getByRole('combobox', { name: 'Permission mode' }).selectOption('acceptEdits')
    await box.fill('edit again')
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.getByRole('group', { name: 'Tool Edit' })).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'Allow' })).toHaveCount(0)
    await expect(page.getByRole('status')).toContainText(/idle/i)

    // Changes panel: the temp folder is no git repository.
    await page.getByRole('button', { name: 'Show changes' }).click()
    await expect(page.getByRole('complementary', { name: 'Changes' })).toContainText('not a git repository')
    await page.getByRole('button', { name: 'Hide changes' }).click()

    // Side panel: confirm the card of the first prompt.
    const panel = page.getByRole('complementary', { name: 'Cards from this session' })
    const row = panel.getByRole('listitem').filter({ hasText: 'Understanding: explain the build' })
    await expect(row).toContainText('Proposed')
    await row.getByRole('button', { name: 'Confirm' }).click()
    // Reviewed cards leave the list and join the library.
    await expect(row).toHaveCount(0)

    // Subagent: shown in the Agents tab (selected automatically); "Show" in the timeline expands it.
    await box.fill('start an agent')
    await page.getByRole('button', { name: 'Send' }).click()
    const agents = page.getByRole('complementary', { name: 'Agents' })
    await expect(page.getByRole('status')).toContainText(/idle/i)
    // The finished agent has left the list; it waits under "Finished".
    await expect(agents).toContainText('No agent is running.')
    await agents.getByRole('button', { name: 'Finished (1)' }).click()
    await expect(agents).toContainText('Explore the repo')
    await page.getByRole('group', { name: 'Tool Agent' }).getByRole('button', { name: 'Show', exact: true }).click()
    await expect(agents.getByRole('list', { name: 'Agent activity' })).toContainText('Looking at package.json')
    await expect(agents).toContainText('Build scripts live in package.json (fake)')

    // A question of the agent is a form; the answer reaches the agent.
    await box.fill('ask a question')
    await page.getByRole('button', { name: 'Send' }).click()
    const form = page.getByRole('form', { name: 'Questions from the agent' })
    await form.getByRole('radio', { name: /Postgres/ }).check()
    await form.getByRole('button', { name: 'Submit answers' }).click()
    await expect(timeline).toContainText('You chose: Postgres')

    // Second session: both are listed.
    await createSession(page, folder, second)
    const sessions = page.getByRole('region', { name: 'Sessions' })
    await expect(sessions).toContainText(first)
    await expect(sessions).toContainText(second)
    await sessions.getByText(first, { exact: true }).click()
    await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Working on: explain the build')

    // Back to API mode: the conversation list is there again.
    await mode(page, 'API').click()
    await expect(mode(page, 'API')).toBeChecked()
    await expect(page.getByLabel('New conversation', { exact: true })).toBeVisible()
  } finally {
    await page.request.put('/api/settings', { data: { mode: 'api' } }).catch(() => undefined)
    rmSync(folder, { recursive: true, force: true })
  }
})
