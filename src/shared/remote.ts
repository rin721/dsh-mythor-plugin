import { z } from 'zod'
import type {
  InvocationDescriptor,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import { RequestSchema } from './contracts.ts'

export const ResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: z.json() }).strict(),
  z
    .object({
      ok: z.literal(false),
      error: z.object({ code: z.string(), message: z.string(), details: z.json().optional() }),
    })
    .strict(),
])
// One schema-owned descriptor is used on both sides; contract tests exercise the real Gateway.
export const descriptor: InvocationDescriptor = {
  id: 'dsh-mythor-plugin#mythor/request',
  service: 'mythor',
  namespace: 'mythor',
  method: 'request',
  invocation: { kind: 'direct' },
  scope: { context: 'agent', wire: 'agentId' },
  parameters: [
    {
      name: 'agent',
      wire: 'agentId',
      source: 'lookup',
      lookup: 'agent',
      codec: {
        mode: 'strict',
        // The Agent lookup is wired by Harness through the owning SessionId.
        // This symbol must exactly match AgentRegistry's public lookup contract;
        // the Gateway rejects plugin-local aliases before resolving the Agent.
        typeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
        create: () => z.string(),
      },
    },
    {
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: 'dsh-mythor-plugin#Request',
        create: () => RequestSchema,
      },
    },
  ],
  cancellation: { parameter: 'signal' },
  result: { mode: 'strict', typeSymbol: 'dsh-mythor-plugin#ApiResult', create: () => ResultSchema },
}
export const watchDescriptor: InvocationDescriptor = {
  id: 'dsh-mythor-plugin#mythor/watch',
  service: 'mythor',
  namespace: 'mythor',
  method: 'watch',
  invocation: { kind: 'direct' },
  mode: 'stream',
  scope: { context: 'agent', wire: 'agentId' },
  parameters: [descriptor.parameters[0]!],
  cancellation: { parameter: 'signal' },
  result: {
    mode: 'strict',
    typeSymbol: 'dsh-mythor-plugin#NovelInvalidation',
    create: () => z.object({ generation: z.number().int().positive() }).strict(),
  },
}
export const remoteContribution: TypertRemoteContribution = {
  package: 'dsh-mythor-plugin',
  descriptors: [descriptor, watchDescriptor],
}
