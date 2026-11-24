import type { ReactNode } from 'react'
import { Dialog } from '@primer/react'

type Props = {
  title: string
  children: ReactNode
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}

/** In-app confirmation (never window.confirm). */
export function ConfirmDialog({ title, children, confirmLabel = 'Confirm', danger, onConfirm, onClose }: Props) {
  return (
    <Dialog
      title={title}
      width="small"
      role="alertdialog"
      onClose={onClose}
      footerButtons={[
        { content: 'Cancel', onClick: onClose },
        {
          content: confirmLabel,
          buttonType: danger ? 'danger' : 'primary',
          onClick: () => {
            onConfirm()
            onClose()
          },
        },
      ]}
    >
      {children}
    </Dialog>
  )
}
