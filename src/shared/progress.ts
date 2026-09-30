import type { CreativeRecord, Entity, WorkflowRun } from './contracts.ts'

export interface WorkspaceProgress {
  workspace: { id: string; title: string }
  enabled: boolean
  revision: number | null
  title: string | null
  records: CreativeRecord[]
  checkpoints: { sessionId: string; seq: number }[]
  unavailableSessions: string[]
  plans: Entity[]
  tasks: WorkflowRun[]
  pending: { id: string; summary: string; baseRevision: number }[]
  decisions: { id: string; text: string; baseRevision: number }[]
  recent: {
    id: string
    text: string
    kind: 'prose' | 'fact' | 'plan' | 'record'
    revision: number
  }[]
  runtime: { sessionId: string; status: string }
  totalRecords: number
  truncated: boolean
}
