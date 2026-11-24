;(() => {
  const params = new URLSearchParams(location.search)
  const text = (id: string, value: string) => {
    const el = document.getElementById(id)
    if (el) el.textContent = value
  }
  text('message', params.get('message') ?? 'The PromptSys backend could not be started.')
  text('log', params.get('log') ?? '')
  document.getElementById('open-log')?.addEventListener('click', () => void window.promptsysUi.openLog())
  document.getElementById('retry')?.addEventListener('click', () => void window.promptsysUi.retry())
  document.getElementById('quit')?.addEventListener('click', () => void window.promptsysUi.quit())
})()
