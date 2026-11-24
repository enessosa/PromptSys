import type { Context } from 'hono'
import { z } from 'zod'
import { AppError } from './errors.ts'

/** A positive integer id as used in paths and bodies (`3` is card `c3` in the UI). Accepts numeric strings from paths. */
export const idSchema = z.coerce.number().int().positive()

function validationFailed(error: z.ZodError): AppError {
  const details = error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
  return new AppError(400, 'validation_failed', details[0] ? `${details[0].path || 'body'}: ${details[0].message}` : 'Invalid request', details)
}

/** Validates a value with a Zod schema; throws a 400 `validation_failed` listing every problem. */
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value)
  if (!result.success) throw validationFailed(result.error)
  return result.data
}

/** Reads the JSON body of a request and validates it. */
export async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let json: unknown
  try {
    json = await c.req.json()
  } catch {
    throw new AppError(400, 'validation_failed', 'Request body is not valid JSON')
  }
  return parse(schema, json)
}

/** Query strings: empty values count as not given. */
export function parseQuery<T extends z.ZodType>(c: Context, schema: T): z.infer<T> {
  const query = Object.fromEntries(Object.entries(c.req.query()).filter(([, v]) => v !== ''))
  return parse(schema, query)
}
