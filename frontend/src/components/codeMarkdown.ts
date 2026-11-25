import type { Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './CodeBlock.tsx'

/** GitHub Markdown: tables, strikethrough, task lists, autolinks. */
export const remarkMarkdown = [remarkGfm]
/** Highlights fenced blocks with a language; blocks without one stay plain. */
export const rehypeCode = [rehypeHighlight]
export const codeComponents: Partial<Components> = { pre: CodeBlock }
