import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, test } from 'vitest'
import { ConfirmProvider } from './ConfirmProvider'
import { useConfirm } from './useConfirm'

function Trigger() {
  const confirm = useConfirm()
  const [answer, setAnswer] = useState('none')
  return (
    <>
      <button
        type="button"
        onClick={async () =>
          setAnswer(
            (await confirm({ title: 'Delete user “alice”?', message: 'This cannot be undone.', confirmLabel: 'Delete' })) ? 'yes' : 'no',
          )
        }
      >
        ask
      </button>
      <output>{answer}</output>
    </>
  )
}

function setup() {
  render(
    <ConfirmProvider>
      <Trigger />
    </ConfirmProvider>,
  )
  return userEvent.setup()
}

test('shows the question and resolves true on confirm', async () => {
  const user = setup()
  await user.click(screen.getByRole('button', { name: 'ask' }))
  const dialog = await screen.findByRole('dialog', { name: 'Delete user “alice”?' })
  expect(dialog).toHaveTextContent('This cannot be undone.')
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  expect(await screen.findByText('yes')).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('resolves false on cancel, and Cancel has focus first', async () => {
  const user = setup()
  await user.click(screen.getByRole('button', { name: 'ask' }))
  expect(await screen.findByRole('button', { name: 'Cancel' })).toHaveFocus()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(await screen.findByText('no')).toBeInTheDocument()
})

test('resolves false when the dialog is cancelled', async () => {
  const user = setup()
  await user.click(screen.getByRole('button', { name: 'ask' }))
  // Browsers fire "cancel" on a modal dialog for Escape; jsdom does not, so send it directly.
  fireEvent(await screen.findByRole('dialog'), new Event('cancel', { cancelable: true }))
  expect(await screen.findByText('no')).toBeInTheDocument()
})
