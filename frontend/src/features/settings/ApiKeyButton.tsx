import { Button } from '@primer/react'
import { desktopApiKeyAction } from './promptsys.ts'

/** Opens the desktop app's API key dialog; renders nothing in a browser. */
export function ApiKeyButton({ variant = 'default', size }: { variant?: 'default' | 'primary'; size?: 'small' | 'medium' }) {
  const action = desktopApiKeyAction()
  if (!action) return null
  return (
    <Button type="button" variant={variant} size={size} onClick={() => void action()}>
      Claude API key…
    </Button>
  )
}
