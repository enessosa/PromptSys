import { expect, type APIRequestContext, type Page } from '@playwright/test'

export type ApiCard = { id: number; title: string; body: string; version: number }
export type ApiLink = { id: number; sourceId: number; targetId: number }

let counter = 0
/** A title that is unique within the run: all tests share one database, so each test finds its own cards by text. */
export const uniqueTitle = (prefix: string) => `${prefix} ${Date.now().toString(36)}${(counter++).toString(36)}`

export async function createCard(request: APIRequestContext, title: string, body = ''): Promise<ApiCard> {
  const response = await request.post('/api/cards', { data: { title, body } })
  expect(response.status()).toBe(201)
  return (await response.json()) as ApiCard
}

export async function graphOf(request: APIRequestContext): Promise<{ nodes: { id: number; title: string }[]; links: ApiLink[] }> {
  const response = await request.get('/api/graph')
  expect(response.ok()).toBe(true)
  return response.json()
}

export const cardLabel = (id: number) => `c${id}`

/** Opens a new conversation (the tab opens too) and returns its message box. */
export async function newConversation(page: Page) {
  await // By label: a conversation row can be titled "New conversation" as well.
  await page.getByLabel('New conversation', { exact: true }).click()
  const box = page.getByRole('textbox', { name: 'Message' })
  await expect(box).toBeVisible()
  return box
}

/** Adds a card to the context tray through the picker dialog. */
export async function addToTray(page: Page, card: { id: number; title: string }) {
  await page.getByRole('button', { name: 'Add card to context' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add card to context' })
  await dialog.getByRole('textbox', { name: 'Search cards' }).fill(card.title)
  await dialog.getByRole('button', { name: new RegExp(`c${card.id}\\b`) }).click()
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('region', { name: 'Context tray' }).getByLabel(`Exclude ${cardLabel(card.id)}`)).toBeVisible()
}
