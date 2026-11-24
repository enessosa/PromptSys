import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { createTestApp } from '../testing.ts'

/** Minimal valid PDF with one page per entry; an empty string makes a page without text. */
function makePdf(pages: string[]): Uint8Array<ArrayBuffer> {
  const objects: string[] = []
  const pageIds = pages.map((_, i) => 4 + i * 2)
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  pages.forEach((text, i) => {
    const stream = text ? `BT /F1 24 Tf 72 700 Td (${text}) Tj ET` : ''
    objects[4 + i * 2] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`
    objects[5 + i * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  })
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(out) as Uint8Array<ArrayBuffer>
}

async function makeDocx(paragraphs: string[]): Promise<Uint8Array<ArrayBuffer>> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  )
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  )
  return (await zip.generateAsync({ type: 'uint8array' })) as Uint8Array<ArrayBuffer>
}

function setup() {
  const { app } = createTestApp()
  const upload = async (file: File | undefined, fields: Record<string, string> = {}) => {
    const form = new FormData()
    if (file) form.set('file', file)
    for (const [k, v] of Object.entries(fields)) form.set(k, v)
    const res = await app.request('/api/cards/upload', { method: 'POST', body: form })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: the response shape is checked by the assertions
    const body: any = await res.json()
    return { status: res.status, body }
  }
  return { app, upload }
}

describe('file upload', () => {
  it('creates a file card from a markdown file', async () => {
    const { app, upload } = setup()
    const res = await upload(new File(['# Notes\n\nhello ä'], 'notes.md', { type: 'text/markdown' }), { folderPath: '/docs/api/' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      id: 1,
      title: 'notes.md',
      body: '# Notes\n\nhello ä',
      kind: 'file',
      sourceName: 'notes.md',
      mimeType: 'text/markdown',
      folderPath: 'docs/api',
      version: 1,
    })
    const get = await app.request('/api/cards/1')
    expect(((await get.json()) as { body: string }).body).toBe('# Notes\n\nhello ä')
    const versions = await app.request('/api/cards/1/versions')
    expect(await versions.json()).toHaveLength(1)
  })

  it.each([
    ['data.json', '', 'application/json'],
    ['config.yml', 'application/octet-stream', 'application/yaml'],
    ['table.csv', 'text/csv; charset=utf-8', 'text/csv'],
    ['main.py', '', 'text/x-python'],
    ['README', 'text/plain', 'text/plain'],
  ])('accepts %s (declared type "%s")', async (name, type, expected) => {
    const { upload } = setup()
    const res = await upload(new File(['x = 1'], name, { type }))
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ kind: 'file', title: name, mimeType: expected })
  })

  it('removes a BOM-free path from the file name and caps the title length', async () => {
    const { upload } = setup()
    const res = await upload(new File(['x'], `C:\\temp\\${'a'.repeat(300)}.txt`, { type: 'text/plain' }))
    expect(res.status).toBe(201)
    expect(res.body.title).toHaveLength(200)
    expect(res.body.sourceName.endsWith('.txt')).toBe(true)
  })

  it('accepts exactly 10 MB and rejects more with 413 file_too_large', async () => {
    const { upload } = setup()
    const limit = 10 * 1024 * 1024
    const ok = await upload(new File(['a'.repeat(limit)], 'big.txt', { type: 'text/plain' }))
    expect(ok.status).toBe(201)
    const tooBig = await upload(new File(['a'.repeat(limit + 1)], 'huge.txt', { type: 'text/plain' }))
    expect(tooBig.status).toBe(413)
    expect(tooBig.body.error.code).toBe('file_too_large')
    const bigPdf = await upload(new File([new Uint8Array(limit + 1)], 'huge.pdf', { type: 'application/pdf' }))
    expect(bigPdf.status).toBe(413)
  })

  it('extracts the text of a PDF, pages separated by blank lines', async () => {
    const { upload } = setup()
    const res = await upload(new File([makePdf(['Hello PDF', 'Second page'])], 'paper.pdf', { type: 'application/pdf' }))
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      kind: 'file',
      title: 'paper.pdf',
      sourceName: 'paper.pdf',
      mimeType: 'application/pdf',
      body: 'Hello PDF\n\nSecond page',
    })
  })

  it('rejects a PDF without extractable text (scanned) with 422', async () => {
    const { upload } = setup()
    const res = await upload(new File([makePdf([''])], 'scan.pdf', { type: 'application/pdf' }))
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('unsupported_file_type')
    expect(res.body.error.message).toBe('PDF contains no extractable text (scanned images are not supported yet)')
  })

  it('extracts the text of a DOCX', async () => {
    const { upload } = setup()
    const res = await upload(new File([await makeDocx(['First paragraph', 'Second paragraph'])], 'doc.docx'))
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      kind: 'file',
      sourceName: 'doc.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      body: 'First paragraph\n\nSecond paragraph',
    })
  })

  it('rejects files whose content does not match the extension with 422', async () => {
    const { upload } = setup()
    const zipBytes = await makeDocx(['x'])
    for (const file of [
      new File(['just text'], 'fake.pdf', { type: 'application/pdf' }),
      new File(['just text'], 'fake.docx'),
      new File([makePdf(['x'])], 'pdf-as-text.txt', { type: 'text/plain' }),
      new File([zipBytes], 'zip-as-text.md', { type: 'text/markdown' }),
      new File([makePdf(['x'])], 'pdf-as-docx.docx'),
    ]) {
      const res = await upload(file)
      expect(res.status, file.name).toBe(422)
      expect(res.body.error.code).toBe('unsupported_file_type')
    }
  })

  it('rejects documents with more than 500,000 characters of text with 422', async () => {
    const { upload } = setup()
    const res = await upload(new File([await makeDocx(['a'.repeat(500_001)])], 'long.docx'))
    expect(res.status).toBe(422)
    expect(res.body.error.message).toContain('500,000')
  })

  it('rejects "text" files that are binary or not UTF-8', async () => {
    const { upload } = setup()
    expect((await upload(new File([new Uint8Array([0xff, 0xfe, 0x41])], 'a.txt', { type: 'text/plain' }))).body.error.code).toBe('unsupported_file_type')
    expect((await upload(new File(['a\0b'], 'b.txt', { type: 'text/plain' }))).body.error.code).toBe('unsupported_file_type')
  })

  it('creates no card when rejected', async () => {
    const { app, upload } = setup()
    await upload(new File(['x'], 'a.zip', { type: 'application/zip' }))
    expect(await (await app.request('/api/cards')).json()).toEqual([])
  })

  it('answers 400 validation_failed without a file or with a body that is not multipart', async () => {
    const { app, upload } = setup()
    const none = await upload(undefined, { folderPath: 'x' })
    expect(none.status).toBe(400)
    expect(none.body.error.code).toBe('validation_failed')
    const notAFile = await upload(undefined, { file: 'just text' })
    expect(notAFile.body.error.code).toBe('validation_failed')
    const json = await app.request('/api/cards/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(json.status).toBe(400)
  })

  it('answers 413 early when the request itself is far too large', async () => {
    const { app } = setup()
    const res = await app.request('/api/cards/upload', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(11 * 1024 * 1024) },
      body: '--x--',
    })
    expect(res.status).toBe(413)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('file_too_large')
  })
})
