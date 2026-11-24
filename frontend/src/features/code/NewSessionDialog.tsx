import { useState, type FormEvent } from 'react'
import { Dialog, FormControl, TextInput } from '@primer/react'
import { FileDirectoryIcon } from '@primer/octicons-react'
import { ApiError } from '../../api/client.ts'
import type { CodeSession } from '../../api/types.ts'
import { desktopFolderPicker } from '../settings/promptsys.ts'
import { useCreateSession } from './hooks.ts'
import styles from './code.module.css'

export function NewSessionDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (session: CodeSession) => void }) {
  const create = useCreateSession()
  const [projectPath, setProjectPath] = useState('')
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const pickFolder = desktopFolderPicker()
  const choose = async () => {
    if (!pickFolder) return
    const path = await pickFolder()
    if (path) setProjectPath(path)
  }
  const valid = projectPath.trim().startsWith('/') || /^[a-zA-Z]:[\\/]/.test(projectPath.trim())

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!valid || create.isPending) return
    setError(null)
    create.mutate(
      { projectPath: projectPath.trim(), ...(title.trim() ? { title: title.trim() } : {}) },
      {
        onSuccess: (session) => {
          onCreated(session)
          onClose()
        },
        onError: (e) => setError(e instanceof ApiError && e.code === 'invalid_project_path' ? 'This is not an existing folder. Use an absolute path.' : e.message),
      },
    )
  }

  return (
    <Dialog
      title="New session"
      width="medium"
      onClose={onClose}
      footerButtons={[
        { content: 'Cancel', onClick: onClose },
        { content: 'Create', buttonType: 'primary', onClick: () => submit(), disabled: !valid || create.isPending },
      ]}
    >
      <form onSubmit={submit} className={styles.dialogForm}>
        <FormControl required>
          <FormControl.Label>Project folder</FormControl.Label>
          <TextInput
            block
            autoFocus
            placeholder="/Users/me/project"
            value={projectPath}
            onChange={(e) => setProjectPath(e.target.value)}
            trailingAction={pickFolder ? <TextInput.Action icon={FileDirectoryIcon} aria-label="Choose folder…" tooltipDirection="nw" onClick={() => void choose()} /> : undefined}
          />
          <FormControl.Caption>
            {pickFolder ? 'Choose a folder or type its absolute path.' : 'Absolute path of an existing folder.'} The agent works inside it.
          </FormControl.Caption>
        </FormControl>
        <FormControl>
          <FormControl.Label>Title</FormControl.Label>
          <TextInput block placeholder="Empty = folder name" value={title} onChange={(e) => setTitle(e.target.value)} />
        </FormControl>
        <p className={styles.note}>Agent mode runs your own installed Claude Code with your own login and plan; your use is subject to Anthropic's terms. PromptSys never sees your login.</p>
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </form>
    </Dialog>
  )
}
