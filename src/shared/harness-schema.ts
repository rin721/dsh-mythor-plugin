import { z } from 'zod'
import {
  assertObjectJsonSchema,
  assertSupportedJsonSchema,
  type ObjectJsonSchema,
} from '@deepseek-ai/dsh-tools'

/** Harness 0.1.7 has a deliberately smaller schema subset. Zod still enforces
 * numeric/string bounds and domain refinements after tool dispatch. */
export function harnessSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = JSON.parse(JSON.stringify(z.toJSONSchema(schema, { target: 'draft-7' }))) as Record<
    string,
    unknown
  >
  const visit = (node: Record<string, unknown>): Record<string, unknown> => {
    if (node.$ref) return { description: 'Lossless JSON value; validated by Mythor at execution.' }
    const out: Record<string, unknown> = {}
    for (const key of ['type', 'enum', 'const', 'description', 'title', 'required'])
      if (node[key] !== undefined) out[key] = node[key]
    if (node.anyOf || node.oneOf) {
      delete out.type
      out.oneOf = (node.anyOf ?? (node.oneOf as unknown[])) as unknown[]
      out.oneOf = (out.oneOf as Record<string, unknown>[]).map(visit)
    }
    if (node.properties)
      out.properties = Object.fromEntries(
        Object.entries(node.properties as Record<string, Record<string, unknown>>).map(
          ([key, value]) => [key, visit(value)],
        ),
      )
    if (node.items) out.items = visit(node.items as Record<string, unknown>)
    if (node.additionalProperties !== undefined)
      out.additionalProperties = node.additionalProperties !== false
    return out
  }
  const result = visit(raw)
  assertSupportedJsonSchema(result)
  return result
}
export function harnessObjectSchema(schema: z.ZodType): ObjectJsonSchema & Record<string, unknown> {
  const result = harnessSchema(schema)
  assertObjectJsonSchema(result)
  return result
}
