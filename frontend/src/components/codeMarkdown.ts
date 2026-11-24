import type { Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import { CodeBlock } from './CodeBlock.tsx'

/** Highlights fenced blocks with a language; blocks without one stay plain. */
export const rehypeCode = [rehypeHighlight]
export const codeComponents: Partial<Components> = { pre: CodeBlock }
