import { useState, type ReactNode } from 'react'
import { CheckIcon, CopyIcon } from '@primer/octicons-react'
import styles from './codeBlock.module.css'

type HastNode = { type: string; value?: string; tagName?: string; properties?: { className?: unknown }; children?: HastNode[] }

const textOf = (node: HastNode | undefined): string =>
  !node ? '' : node.type === 'text' ? (node.value ?? '') : (node.children ?? []).map(textOf).join('')

/** Language named after the opening fence (```java → "java"), or null. */
function languageOf(node: HastNode | undefined): string | null {
  const code = node?.children?.find((c) => c.tagName === 'code')
  const classes = code?.properties?.className
  const list = Array.isArray(classes) ? classes.map(String) : []
  const lang = list.find((c) => c.startsWith('language-'))
  return lang ? lang.slice('language-'.length) : null
}

/** Copies through the Clipboard API, else through a hidden text field (older browsers, pages without permission). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    try {
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      field.remove()
    }
  }
}

/** A fenced code block: header with the language and a copy button, highlighted code below. */
export function CodeBlock({ node, children }: { node?: unknown; children?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const hast = node as HastNode | undefined
  const lang = languageOf(hast)
  const copy = () => {
    void copyText(textOf(hast).replace(/\n$/, '')).then((ok) => {
      if (!ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className={styles.block}>
      <div className={styles.head}>
        <span className={styles.lang}>{lang ?? 'text'}</span>
        <button type="button" className={styles.copy} onClick={copy} aria-label={copied ? 'Copied' : 'Copy code'}>
          {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className={styles.pre}>{children}</pre>
    </div>
  )
}
