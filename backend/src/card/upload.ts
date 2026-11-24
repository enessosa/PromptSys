import { AppError } from '../common/errors.ts'

/** Largest accepted upload (v1 reads the whole file into memory and stores it as the card body). */
export const MAX_UPLOAD_BYTES = 1024 * 1024

// Text types by extension (the browser often sends an empty or generic MIME type for these).
const TEXT_EXTENSIONS: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  text: 'text/plain',
  log: 'text/plain',
  json: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  toml: 'application/toml',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  xml: 'application/xml',
  html: 'text/html',
  css: 'text/css',
  ini: 'text/plain',
  sql: 'application/sql',
  sh: 'application/x-sh',
  js: 'text/javascript',
  mjs: 'text/javascript',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  jsx: 'text/javascript',
  py: 'text/x-python',
  java: 'text/x-java',
  kt: 'text/x-kotlin',
  go: 'text/x-go',
  rs: 'text/x-rust',
  c: 'text/x-c',
  h: 'text/x-c',
  cpp: 'text/x-c++',
  cs: 'text/x-csharp',
  rb: 'text/x-ruby',
  php: 'text/x-php',
  swift: 'text/x-swift',
}

const TEXT_MIME_TYPES = new Set([
  'application/json',
  'application/yaml',
  'application/x-yaml',
  'application/toml',
  'application/xml',
  'application/javascript',
  'application/sql',
  'application/x-sh',
])

export type UploadedText = { title: string; body: string; sourceName: string; mimeType: string }

/**
 * Turns an uploaded file into card data. v1 accepts text files only:
 * `413 file_too_large` above 1 MB, `422 unsupported_file_type` for anything that is not (UTF-8) text.
 */
export async function readTextUpload(file: File): Promise<UploadedText> {
  const name = file.name.split(/[\\/]/).pop()?.trim() || 'Untitled file'
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  const declared = file.type.split(';')[0].trim().toLowerCase()
  const known = TEXT_EXTENSIONS[extension]
  const looksLikeText = declared.startsWith('text/') || TEXT_MIME_TYPES.has(declared) || known !== undefined
  if (!looksLikeText) {
    throw new AppError(422, 'unsupported_file_type', `"${name}" is not a supported file type; only text files can be uploaded`, {
      mimeType: declared || null,
    })
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new AppError(413, 'file_too_large', `"${name}" is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`, {
      maxBytes: MAX_UPLOAD_BYTES,
    })
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
  } catch {
    throw new AppError(422, 'unsupported_file_type', `"${name}" is not valid UTF-8 text`)
  }
  if (text.includes('\0')) throw new AppError(422, 'unsupported_file_type', `"${name}" contains binary data`)
  return {
    title: name.slice(0, 200),
    body: text,
    sourceName: name,
    mimeType: declared && declared !== 'application/octet-stream' ? declared : (known ?? 'text/plain'),
  }
}
