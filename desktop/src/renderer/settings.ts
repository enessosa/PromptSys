;(() => {
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
  const statusEl = $<HTMLParagraphElement>('status')
  const form = $<HTMLFormElement>('form')
  const input = $<HTMLInputElement>('key')
  const save = $<HTMLButtonElement>('save')
  const remove = $<HTMLButtonElement>('remove')
  const message = $<HTMLParagraphElement>('message')

  const show = (text: string, isError: boolean) => {
    message.textContent = text
    message.className = isError ? 'error' : 'ok'
  }

  async function refresh() {
    const status = await window.promptsysUi.getStatus()
    if (!status.available) {
      statusEl.textContent = 'Secure storage is not available on this system. The API key cannot be saved.'
      input.disabled = true
      save.disabled = true
    } else {
      statusEl.textContent = status.hasKey ? 'An API key is stored (encrypted by the system keychain).' : 'No API key is stored yet.'
    }
    remove.hidden = !status.hasKey
  }

  async function run(action: () => Promise<SaveResult>, success: string) {
    save.disabled = true
    remove.disabled = true
    show('Restarting the backend…', false)
    try {
      const result = await action()
      if (result.ok) {
        input.value = ''
        show(success, false)
      } else {
        show(result.error, true)
      }
    } catch {
      show('Something went wrong. See the log file.', true)
    }
    save.disabled = false
    remove.disabled = false
    await refresh()
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void run(() => window.promptsysUi.saveKey(input.value), 'Saved. The backend was restarted.')
  })
  remove.addEventListener('click', () => void run(() => window.promptsysUi.clearKey(), 'Key removed. The backend was restarted.'))
  void refresh()
})()
