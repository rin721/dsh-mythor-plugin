import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { mountStyles } from '../../src/client/styles.ts'
import {
  Button,
  Field,
  FilePicker,
  Modal,
  NumberField,
  Select,
  SelectOption,
  TextArea,
  FormActions,
} from '../../src/client/ui/index.tsx'

describe('Harness component adapters', () => {
  it('registers and removes compiled styles with each workbench lifecycle', () => {
    vi.stubGlobal('__MYTHOR_CSS__', '.scoped { color: var(--dsw-alias-label-primary); }')
    const release = mountStyles()
    expect(document.head.querySelector('[data-mythor-styles]')?.textContent).toContain('.scoped')
    release()
    expect(document.head.querySelector('[data-mythor-styles]')).toBeNull()
    vi.unstubAllGlobals()
  })

  it('selects real empty values and returns public values rather than encoded indexes', async () => {
    const changed = vi.fn()
    function Fixture() {
      const [value, setValue] = useState('alpha')
      return (
        <Select
          aria-label="Scope"
          value={value}
          onValueChange={(next) => {
            setValue(next)
            changed(next)
          }}
        >
          <SelectOption value="">All</SelectOption>
          <SelectOption value="alpha">Alpha</SelectOption>
          <SelectOption value="option-0">User sentinel</SelectOption>
          <SelectOption value="blocked" disabled>
            Blocked
          </SelectOption>
        </Select>
      )
    }
    render(<Fixture />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'All' }))
    expect(changed).toHaveBeenLastCalledWith('')
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'User sentinel' }))
    expect(changed).toHaveBeenLastCalledWith('option-0')
    expect(screen.getByRole('combobox').textContent).toContain('User sentinel')
  })

  it('keeps unknown numeric values empty and allows controlled text input including IME', () => {
    const numbers = vi.fn()
    const texts = vi.fn()
    function Fixture() {
      const [number, setNumber] = useState('')
      const [text, setText] = useState('')
      return (
        <>
          <Field>
            World time
            <NumberField
              value={number}
              onChange={(e) => {
                setNumber(e.target.value)
                numbers(e.target.value)
              }}
            />
          </Field>
          <Field>
            Intent
            <TextArea
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                texts(e.target.value)
              }}
            />
          </Field>
        </>
      )
    }
    render(<Fixture />)
    const number = screen.getByRole('spinbutton') as HTMLInputElement
    expect(number.value).toBe('')
    fireEvent.change(number, { target: { value: '12' } })
    fireEvent.change(number, { target: { value: '' } })
    expect(numbers).toHaveBeenLastCalledWith('')
    const textarea = screen.getByRole('textbox')
    fireEvent.compositionStart(textarea)
    fireEvent.change(textarea, { target: { value: '人物选择\n造成后果' } })
    fireEvent.compositionEnd(textarea)
    expect(texts).toHaveBeenLastCalledWith('人物选择\n造成后果')
  })

  it('lets explicit submit buttons submit and cancellation buttons stay local', async () => {
    const submitted = vi.fn()
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submitted()
        }}
      >
        <FormActions>
          <Button>Cancel</Button>
          <Button type="submit">Save</Button>
        </FormActions>
      </form>,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(submitted).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(submitted).toHaveBeenCalledOnce()
  })

  it('allows choosing the same file again without submitting the surrounding form', async () => {
    const selected = vi.fn()
    const submitted = vi.fn()
    const { container } = render(
      <form onSubmit={submitted}>
        <FilePicker label="Choose" accept=".txt" onFileSelect={selected} />
      </form>,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Choose' }))
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    const file = new File(['Story'], 'novel.txt', { type: 'text/plain' })
    await user.upload(input, file)
    await user.upload(input, file)
    expect(selected).toHaveBeenCalledTimes(2)
    expect(selected).toHaveBeenLastCalledWith(file)
    expect(submitted).not.toHaveBeenCalled()
  })

  it('opens a Select inside the host Modal, consumes Escape once, and restores focus', async () => {
    function Fixture() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <Button onClick={() => setOpen(true)}>Open</Button>
          {open && (
            <Modal title="Editor" closeLabel="Close" close={() => setOpen(false)}>
              <Select aria-label="Kind" value="a" onValueChange={() => {}}>
                <SelectOption value="a">Character</SelectOption>
                <SelectOption value="b">Event</SelectOption>
              </Select>
            </Modal>
          )}
        </>
      )
    }
    render(<Fixture />)
    const user = userEvent.setup()
    const trigger = screen.getByRole('button', { name: 'Open' })
    await user.click(trigger)
    await user.click(screen.getByRole('combobox'))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('combobox'))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(trigger)
    await user.click(trigger)
    expect(screen.getByRole('combobox').textContent).toContain('Character')
  })

  it('supports arrow-key selection and displays file read failures', async () => {
    function Fixture() {
      const [value, setValue] = useState('a')
      return (
        <>
          <Select aria-label="Type" value={value} onValueChange={setValue}>
            <SelectOption value="a">Character</SelectOption>
            <SelectOption value="b">Event</SelectOption>
          </Select>
          <FilePicker
            label="Read file"
            onFileSelect={async () => {
              throw new Error('Read failed')
            }}
          />
        </>
      )
    }
    const { container } = render(<Fixture />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox'))
    await user.keyboard('{ArrowDown}{Enter}')
    expect(screen.getByRole('combobox').textContent).toContain('Event')
    await user.upload(
      container.querySelector('input[type=file]') as HTMLInputElement,
      new File(['Text'], 'story.txt'),
    )
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Read failed'))
    expect(screen.getByRole('button', { name: 'Read file' }).hasAttribute('disabled')).toBe(false)
  })
})
