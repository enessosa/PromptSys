import { useState, type FormEvent } from 'react'
import { Dialog, FormControl, TextInput } from '@primer/react'

type Props = {
  title: string
  label: string
  initialValue?: string
  confirmLabel?: string
  allowEmpty?: boolean
  onSubmit: (value: string) => void
  onClose: () => void
}

/** One-field dialog (rename, move to folder, link label …). */
export function PromptDialog({ title, label, initialValue = '', confirmLabel = 'Save', allowEmpty = false, onSubmit, onClose }: Props) {
  const [value, setValue] = useState(initialValue)
  const valid = allowEmpty || value.trim() !== ''
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!valid) return
    onSubmit(value.trim())
    onClose()
  }
  return (
    <Dialog
      title={title}
      width="small"
      onClose={onClose}
      footerButtons={[
        { content: 'Cancel', onClick: onClose },
        { content: confirmLabel, buttonType: 'primary', onClick: () => submit(), disabled: !valid },
      ]}
    >
      <form onSubmit={submit}>
        <FormControl>
          <FormControl.Label>{label}</FormControl.Label>
          <TextInput block autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
        </FormControl>
      </form>
    </Dialog>
  )
}
