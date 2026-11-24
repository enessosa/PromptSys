import { render, screen } from '@testing-library/react'
import Markdown from 'react-markdown'
import { describe, expect, it } from 'vitest'
import { codeComponents, rehypeCode } from './codeMarkdown.ts'

const md = (text: string) => render(<Markdown rehypePlugins={rehypeCode} components={codeComponents}>{text}</Markdown>)

describe('CodeBlock', () => {
  it('highlights a fenced block and shows its language', () => {
    const { container } = md('```java\npublic class A { int x = 1; }\n```')
    expect(screen.getByText('java')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument()
    expect(container.querySelector('.hljs-keyword')?.textContent).toBe('public')
  })

  it('keeps a block without language plain and an unknown language readable', () => {
    md('```\nplain\n```\n\n```notalang\nstill here\n```')
    expect(screen.getByText('text')).toBeInTheDocument()
    expect(screen.getByText('still here')).toBeInTheDocument()
  })

  it('leaves inline code alone', () => {
    md('use `npm test` here')
    expect(screen.queryByRole('button', { name: 'Copy code' })).toBeNull()
  })
})
