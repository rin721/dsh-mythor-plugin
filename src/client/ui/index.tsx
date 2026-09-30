import { Children, createContext, isValidElement, useContext, useId, useRef, useState } from 'react'
import type { ComponentProps, ReactNode, TextareaHTMLAttributes } from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import * as Collapsible from '@radix-ui/react-collapsible'
import clsx from 'clsx'
import {
  Button,
  Input,
  Modal as HarnessModal,
  MenuSurface,
  DisclosureRow,
  JsonTree,
  DiffBlock,
  StateDot,
  Toast,
  IconChevronDownOutlineRegular,
  IconCheckOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '../locales.ts'
import css from './ui.module.css'

const FeedbackContext = createContext('')
const DiagnosticContext = createContext('')
export function FeedbackScope({
  error,
  details = '',
  children,
}: {
  error: string
  details?: string
  children: ReactNode
}) {
  return (
    <DiagnosticContext.Provider value={details}>
      <FeedbackContext.Provider value={error}>{children}</FeedbackContext.Provider>
    </DiagnosticContext.Provider>
  )
}

export {
  Button,
  Input,
  Checkbox,
  Pill,
  Tag,
  StateDot,
  Menu,
  MenuItemButton,
  Tooltip,
  Toast,
  SegmentedTabs,
  SegmentedControl,
} from '@deepseek-ai/dsh-client-ui-primitives'

export interface SelectOptionProps {
  value: string | number
  children?: ReactNode
  disabled?: boolean
}
/** Declarative option data; only Select renders the library's option elements. */
export function SelectOption(_props: SelectOptionProps) {
  return null
}
function collectOptions(children: ReactNode): SelectOptionProps[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<SelectOptionProps & { children?: ReactNode }>(child)) return []
    return child.type === SelectOption ? [child.props] : collectOptions(child.props.children)
  })
}
export interface SelectProps {
  value: string | number
  onValueChange: (value: string) => void
  children?: ReactNode
  options?: SelectOptionProps[]
  disabled?: boolean
  required?: boolean
  id?: string
  name?: string
  className?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'data-modal-autofocus'?: boolean
}
export function Select({
  value,
  onValueChange,
  children,
  options,
  className,
  ...props
}: SelectProps) {
  const entries = options ?? collectOptions(children)
  // Radix reserves the empty string. Encode by index, never by a user value sentinel.
  const current = entries.findIndex((entry) => String(entry.value) === String(value))
  return (
    <SelectPrimitive.Root
      value={current < 0 ? '' : `option-${current}`}
      onValueChange={(encoded) => {
        const entry = entries[Number(encoded.slice(7))]
        if (entry) onValueChange(String(entry.value))
      }}
      disabled={props.disabled}
      required={props.required}
      name={props.name}
    >
      <SelectPrimitive.Trigger asChild>
        <Button
          id={props.id}
          variant="outline"
          className={clsx(css.selectTrigger, className)}
          aria-label={props['aria-label']}
          aria-labelledby={props['aria-labelledby']}
          data-modal-autofocus={props['data-modal-autofocus']}
        >
          <SelectPrimitive.Value />
          <SelectPrimitive.Icon>
            <IconChevronDownOutlineRegular />
          </SelectPrimitive.Icon>
        </Button>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content asChild position="popper" sideOffset={4}>
          <MenuSurface className={css.selectSurface}>
            <SelectPrimitive.Viewport>
              {entries.map((entry, index) => (
                <SelectPrimitive.Item
                  key={index}
                  value={`option-${index}`}
                  disabled={entry.disabled}
                  className={css.selectItem}
                >
                  <SelectPrimitive.ItemText>{entry.children}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator>
                    <IconCheckOutlineRegular />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </MenuSurface>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx(css.textArea, className)} />
}
export function NumberField(props: Omit<ComponentProps<typeof Input>, 'type'>) {
  return <Input {...props} type="number" />
}
export function FilePicker({
  onFileSelect,
  accept,
  label,
  disabled,
  ...props
}: {
  onFileSelect: (file: File | undefined) => void | Promise<void>
  accept?: string
  label: string
  disabled?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  return (
    <span className={css.filePicker} {...props}>
      <Button
        disabled={disabled || reading}
        variant="outline"
        onClick={() => input.current?.click()}
      >
        {label}
      </Button>
      <span className={css.fileName}>{name}</span>
      {reading && <StateDot state="ongoing" />}
      {error && <ErrorState>{error}</ErrorState>}
      <input
        ref={input}
        hidden
        tabIndex={-1}
        type="file"
        accept={accept}
        disabled={disabled || reading}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          if (file) {
            setName(file.name)
            setError('')
            setReading(true)
            void Promise.resolve()
              .then(() => onFileSelect(file))
              .catch((failure: unknown) => setError(String(failure)))
              .finally(() => setReading(false))
          }
          event.currentTarget.value = ''
        }}
      />
    </span>
  )
}

export function Field({ children, className, ...props }: ComponentProps<'label'>) {
  return (
    <label {...props} className={clsx(css.field, className)}>
      {children}
    </label>
  )
}
export function FormActions({ children }: { children: ReactNode }) {
  return <div className={css.formActions}>{children}</div>
}
export function Panel({ children, className, ...props }: ComponentProps<'section'>) {
  return (
    <section {...props} className={clsx(css.panel, className)}>
      {children}
    </section>
  )
}
export function Modal({
  title,
  close,
  closeLabel,
  children,
}: {
  title: string
  close: () => void
  closeLabel: string
  children: ReactNode
}) {
  const error = useContext(FeedbackContext)
  const details = useContext(DiagnosticContext)
  return (
    <HarnessModal
      open
      onClose={close}
      title={title}
      closeLabel={closeLabel}
      className={css.dialog}
      contentClassName={css.dialogContent}
    >
      {error && <ErrorState>{error}</ErrorState>}
      {error && details && (
        <Disclosure title="查看详细信息">
          <SourceText>{details}</SourceText>
        </Disclosure>
      )}
      {children}
    </HarnessModal>
  )
}
export function Disclosure({
  title,
  children,
  open = false,
}: {
  title: string
  children: ReactNode
  open?: boolean
}) {
  const [expanded, setExpanded] = useState(open)
  const id = useId()
  return (
    <Collapsible.Root open={expanded} onOpenChange={setExpanded}>
      <DisclosureRow
        icon={null}
        title={title}
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => setExpanded(!expanded)}
      >
        <Collapsible.Content id={id}>{children}</Collapsible.Content>
      </DisclosureRow>
    </Collapsible.Root>
  )
}
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className={css.empty}>
      <StateDot state="idle" />
      {children}
    </div>
  )
}
export function LoadingState({ children }: { children: ReactNode }) {
  return (
    <div className={css.feedback} role="status">
      <StateDot state="ongoing" />
      {children}
    </div>
  )
}
export function ErrorState({ children }: { children: ReactNode }) {
  const technical =
    typeof children === 'string' &&
    /gateway\/|transport|HTTP \d|unrecognized_keys|typert|Error:|[a-z]+-[a-z]+:/.test(children)
  return (
    <div className={css.feedback} role="alert">
      <StateDot state="error" />
      {technical ? (
        <div>
          这项操作暂时无法完成，已有内容仍保留。
          <Disclosure title="查看详细信息">
            <SourceText>{children}</SourceText>
          </Disclosure>
        </div>
      ) : (
        children
      )}
    </div>
  )
}
export function SourceText({ children }: { children: ReactNode }) {
  return <pre className={css.sourceText}>{children}</pre>
}
export function Feedback({
  text,
  error,
  details,
  retry,
  onClose,
  closeLabel,
}: {
  text: string
  error: boolean
  details?: string
  retry?: () => void
  onClose: () => void
  closeLabel: string
}) {
  // Errors stay available until explicitly dismissed; transient success uses host toast.
  return error ? (
    <div className={clsx(css.feedback, css.feedbackError)} role="alert">
      <StateDot state="error" />
      <span>{text}</span>
      {retry && <Button onClick={retry}>重试</Button>}
      {details && (
        <Disclosure title="查看详细信息">
          <SourceText>{details}</SourceText>
        </Disclosure>
      )}
      <Button onClick={onClose}>{closeLabel}</Button>
    </div>
  ) : (
    <Toast key={text} text={text} tone="success" onDone={onClose} />
  )
}
export function JsonView({ data, label, t }: { data: unknown; label: string; t: Translate }) {
  return (
    <JsonTree
      data={data !== null && typeof data === 'object' ? data : { value: data }}
      label={label}
      expandTopLevel
      labels={{
        copyValue: t('copyValue'),
        copyJson: t('copyJson'),
        copyPath: t('copyPath'),
        copyPrettyJson: t('copyPrettyJson'),
        copyCompactJson: t('copyCompactJson'),
        copied: t('copied'),
        copyFailed: t('copyFailed'),
        collapseNode: t('collapse'),
        expandNode: t('expand'),
        copyButtonTitle: (action) => action,
      }}
    />
  )
}
export function TextDiff({
  before,
  after,
  title,
  t,
}: {
  before: string | null
  after: string
  title: string
  t: Translate
}) {
  return (
    <DiffBlock
      diffs={[{ path: title, oldText: before, newText: after }]}
      labels={{
        codeLabel: t('manuscript'),
        wrapLabel: t('wrapLines'),
        unwrapLabel: t('nowrapLines'),
        copy: t('copyValue'),
        copied: t('copied'),
        collapseAria: t('collapse'),
        collapse: t('collapse'),
        expandAria: (count) => `${t('expand')} (${count})`,
        expand: (count) => `${t('expand')} (${count})`,
      }}
    />
  )
}
