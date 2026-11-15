import { type ReactNode, type SubmitEvent, useId, useState } from 'react'

import { t } from '../i18n'
import { Field } from '../ui'
import { Dialog } from './dialog'

export interface PasswordDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** What is about to happen, and whether it can be undone. */
  description: ReactNode
  /** Extra fields of the action, shown above the password. */
  children?: ReactNode
  confirmLabel: string
  /** `false` when admins sign in another way: the dialog then only asks to confirm. */
  needsPassword: boolean
  /** Runs the action; a rejection is shown in the dialog, which stays open. */
  onSubmit: (password: string) => Promise<unknown>
  tone?: 'danger' | 'primary'
}

/**
 * A dialog that asks for the admin password before a step that cannot be taken back. The server's answer for a wrong
 * password or too many tries is shown inside, and the password is forgotten as soon as the dialog closes.
 */
export function PasswordDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  needsPassword,
  onSubmit,
  tone = 'primary',
}: PasswordDialogProps) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const errorId = useId()
  const close = (next: boolean): void => {
    if (!next) {
      setPassword('')
      setError(undefined)
    }
    onOpenChange(next)
  }
  const submit = (event: SubmitEvent): void => {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    onSubmit(password).then(
      () => {
        setBusy(false)
        close(false)
      },
      (failure: unknown) => {
        setBusy(false)
        setPassword('')
        setError(failure instanceof Error ? failure.message : String(failure))
      },
    )
  }
  return (
    <Dialog open={open} onOpenChange={close} title={title}>
      <form className="analytik-form" onSubmit={submit}>
        <p className="analytik-dialog-text">{description}</p>
        {children}
        {needsPassword && (
          <Field label={t('Admin password')}>
            <input
              className="analytik-input"
              type="password"
              required
              autoFocus
              autoComplete="current-password"
              value={password}
              aria-invalid={error ? true : undefined}
              aria-describedby={errorId}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        )}
        <p id={errorId} className="analytik-field-error" role="alert">
          {error}
        </p>
        <div className="analytik-actions analytik-card-actions">
          <button type="button" className="analytik-button" onClick={() => close(false)}>
            {t('Cancel')}
          </button>
          <button
            type="submit"
            className="analytik-button"
            data-variant={tone === 'danger' ? 'danger-solid' : 'primary'}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
