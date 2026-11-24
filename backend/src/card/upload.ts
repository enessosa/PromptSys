import { extractText, getDocumentProxy } from 'unpdf'
import mammoth from 'mammoth'
import { AppError } from '../common/errors.ts'

/** Largest accepted upload (v1 reads the whole file into memory and stores it as the card body). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

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

/** Longest extracted text accepted as a card body. */
export const MAX_TEXT_CHARS = 500_000

const PDF_MIME = 'application/pdf'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export type UploadedText = { title: string; body: string; sourceName: string; mimeType: string }

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((b, i) => bytes[i] === b)
}

async function extractPdf(name: string, bytes: Uint8Array): Promise<string> {
  if (!startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    throw new AppError(422, 'unsupported_file_type', `"${name}" has a .pdf extension but is not a PDF file`)
  }
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes))
    const { text } = await extractText(pdf, { mergePages: false })
    const pages = text.map((page) => page.trim()).filter((page) => page !== '')
    return pages.join('\n\n')
  } catch {
    throw new AppError(422, 'unsupported_file_type', `"${name}" could not be read as a PDF`)
  }
}

async function extractDocx(name: string, bytes: Uint8Array): Promise<string> {
  if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    throw new AppError(422, 'unsupported_file_type', `"${name}" has a .docx extension but is not a DOCX file`)
  }
  try {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
    return value.trim()
  } catch {
    throw new AppError(422, 'unsupported_file_type', `"${name}" could not be read as a DOCX file`)
  }
}

/**
 * Turns an uploaded file into card data: text files (UTF-8), PDF and DOCX (text extraction).
 * `413 file_too_large` above 10 MB, `422 unsupported_file_type` for anything else or when the content does not match the extension,
 */
export async function readTextUpload(file: File): Promise<UploadedText> {
  const name = file.name.split(/[\\/]/).pop()?.trim() || 'Untitled file'
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  const declared = file.type.split(';')[0].trim().toLowerCase()
  const isDocument = extension === 'pdf' || extension === 'docx'
  const known = TEXT_EXTENSIONS[extension]
  const looksLikeText = declared.startsWith('text/') || TEXT_MIME_TYPES.has(declared) || known !== undefined
  if (!isDocument && !looksLikeText) {
    throw new AppError(422, 'unsupported_file_type', `"${name}" is not a supported file type; supported are text, Markdown, code, PDF and DOCX`, {
      mimeType: declared || null,
    })
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new AppError(413, 'file_too_large', `"${name}" is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`, {
      maxBytes: MAX_UPLOAD_BYTES,
    })
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  let text: string
  let mimeType: string
  if (isDocument) {
    mimeType = extension === 'pdf' ? PDF_MIME : DOCX_MIME
    text = extension === 'pdf' ? await extractPdf(name, bytes) : await extractDocx(name, bytes)
    if (text.trim() === '') {
      throw new AppError(
        422,
        'unsupported_file_type',
        extension === 'pdf'
          ? 'PDF contains no extractable text (scanned images are not supported yet)'
          : 'DOCX contains no extractable text',
      )
    }
    if (text.length > MAX_TEXT_CHARS) {
      throw new AppError(422, 'unsupported_file_type', `"${name}" contains more than ${MAX_TEXT_CHARS.toLocaleString('en-US')} characters of text`, {
        maxChars: MAX_TEXT_CHARS,
      })
    }
  } else {
    if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) || startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
      throw new AppError(422, 'unsupported_file_type', `"${name}" looks like a PDF or ZIP/Office file, not text`)
    }
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw new AppError(422, 'unsupported_file_type', `"${name}" is not valid UTF-8 text`)
    }
    if (text.includes('\0')) throw new AppError(422, 'unsupported_file_type', `"${name}" contains binary data`)
    mimeType = declared && declared !== 'application/octet-stream' ? declared : (known ?? 'text/plain')
  }
  return { title: name.slice(0, 200), body: text, sourceName: name, mimeType }
}
