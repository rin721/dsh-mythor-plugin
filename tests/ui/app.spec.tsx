import { expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { App } from '../../src/client/App.tsx'
import {
  EntitySchema,
  type ApiResult,
  type Json,
  type Request,
} from '../../src/shared/contracts.ts'

it('renders a quiet workspace choice state when the session has no valid Harness workspace', async () => {
  const api = vi.fn(
    async (): Promise<ApiResult> => ({
      ok: false,
      error: { code: 'workspace-unavailable', message: '请选择项目' },
    }),
  )
  render(<App api={api} />)
  await screen.findByText(
    '请先在 Harness 中选择或创建一个工作区。Mythor 不会在工作区之外创建小说数据。',
  )
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByText(/workspace-unavailable/)).toBeNull()
})

it('keeps an edited entity and reports version conflicts inside its host modal', async () => {
  const novel = {
    id: 'test_project',
    title: '测试小说',
    revision: 3,
    status: 'active',
    createdAt: '',
    seed: {
      worldRule: '',
      protagonist: '',
      desire: '',
      obstacle: '',
      stakes: '',
      centralQuestion: '',
      notes: '',
    },
  }
  const entity = EntitySchema.parse({
    id: 'test_character',
    kind: 'character',
    name: '林烬',
    revision: 3,
  })
  const encode = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json
  const api = vi.fn(async (request: Request): Promise<ApiResult> => {
    if (request.action === 'novel.status')
      return { ok: true, value: encode({ enabled: true, novel }) }
    if (request.action === 'snapshot')
      return {
        ok: true,
        value: encode({
          novel,
          entities: [entity],
          relations: [],
          documents: [],
          changes: [],
          tasks: [],
        }),
      }
    if (request.action === 'history') return { ok: true, value: [] }
    if (request.action === 'changes.propose')
      return {
        ok: false,
        error: {
          code: 'revision-conflict',
          message: '项目已更新，请重新读取',
          details: { currentRevision: 4 },
        },
      }
    if (request.action === 'session.state' || request.action === 'session.save')
      return { ok: true as const, value: {} }
    throw new Error(`Unexpected request: ${request.action}`)
  })
  render(<App api={api} />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '世界与人物' }))
  await user.click(await screen.findByRole('button', { name: /林烬/ }))
  await user.click(screen.getByRole('button', { name: '编辑' }))
  const dialog = screen.getByRole('dialog', { name: '编辑' })
  const name = within(dialog).getByRole('textbox', { name: '名称' })
  await user.clear(name)
  await user.type(name, '林烬的新名字')
  await user.click(within(dialog).getByRole('button', { name: '保存为待审阅变更' }))
  expect((await within(dialog).findByRole('alert')).textContent).toContain('revision-conflict')
  expect((name as HTMLInputElement).value).toBe('林烬的新名字')
  const proposal = api.mock.calls.find(([request]) => request.action === 'changes.propose')?.[0]
  expect('projectId' in (proposal ?? {})).toBe(false)
  expect(proposal?.payload.baseRevision).toBe(3)
  expect(api.mock.calls.some(([request]) => request.action === 'changes.commit')).toBe(false)
})
