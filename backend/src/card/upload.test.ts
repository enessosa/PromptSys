import { describe, expect, it } from 'vitest'
import { createTestApp } from '../testing.ts'

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

  it('accepts exactly 1 MB and rejects more with 413 file_too_large', async () => {
    const { upload } = setup()
    const ok = await upload(new File(['a'.repeat(1024 * 1024)], 'big.txt', { type: 'text/plain' }))
    expect(ok.status).toBe(201)
    const tooBig = await upload(new File(['a'.repeat(1024 * 1024 + 1)], 'huge.txt', { type: 'text/plain' }))
    expect(tooBig.status).toBe(413)
    expect(tooBig.body.error.code).toBe('file_too_large')
  })

  it('rejects other file types with 422 unsupported_file_type', async () => {
    const { upload } = setup()
    for (const file of [
      new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'paper.pdf', { type: 'application/pdf' }),
      new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' }),
      new File(['x'], 'archive.zip', { type: 'application/zip' }),
      new File(['x'], 'noextension', { type: 'application/octet-stream' }),
    ]) {
      const res = await upload(file)
      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('unsupported_file_type')
    }
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
      headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(5 * 1024 * 1024) },
      body: '--x--',
    })
    expect(res.status).toBe(413)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('file_too_large')
  })
})
