// Copies the static renderer files (HTML, CSS) next to the compiled scripts in out/renderer.
import { cpSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
mkdirSync(join(root, 'out', 'renderer'), { recursive: true })
for (const file of ['settings.html', 'error.html', 'ui.css']) {
  cpSync(join(root, 'src', 'renderer', file), join(root, 'out', 'renderer', file))
}
