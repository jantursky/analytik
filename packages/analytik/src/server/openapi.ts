import { version } from '../../package.json'
import { DIMENSIONS } from '../shared/dimensions'
import { BOT_CATEGORIES } from '../shared/ua'
import { KEY_ROUTES } from './key-access'
import { COMPARISONS } from './stats/query'
import { EXPORT_TABLES } from './stats/export'

type Json = Record<string, unknown>

interface Parameter {
  name: string
  description: string
  schema?: Json
  required?: boolean
}

interface Described {
  summary: string
  /** Query parameters beyond the path ones, as a named group or a list. */
  query?: readonly Parameter[]
  /** The JSON body of a write, kept loose: the dashboard and the guide spell out the fields. */
  body?: string
  /** What a 200 carries: a short description, and the media type when it is not JSON. */
  response: string
  media?: string
}

const text = (name: string, description: string, schema: Json = { type: 'string' }): Parameter => ({
  name,
  description,
  schema,
})
const choice = (name: string, description: string, values: readonly string[]): Parameter =>
  text(name, description, { type: 'string', enum: [...values] })

/** The range and filters every stats route understands. Filters repeat to match any of several values. */
const RANGE: readonly Parameter[] = [
  text('from', 'Start of the range, an ISO 8601 date or time. Default: the start of the default range.'),
  text('to', 'End of the range, an ISO 8601 date or time, inclusive for a date.'),
  text('tz', 'IANA time zone for days and dates. Default: the time zone of the site.'),
  choice('interval', 'Bucket size, clamped to what the range allows.', ['hour', 'day', 'week', 'month']),
  choice('compare', 'Adds the totals of a comparison range.', COMPARISONS),
  ...DIMENSIONS.map((dimension) =>
    text(dimension, `Only rows where ${dimension} is this value. Repeat to allow several.`),
  ),
]

const PAGE: readonly Parameter[] = [
  text('limit', 'Rows per page, capped by the server.', { type: 'integer', minimum: 1 }),
  text('cursor', 'The `nextCursor` of the previous page.'),
  text('offset', 'Rows to skip, instead of a cursor.', { type: 'integer', minimum: 0 }),
  text('sort', 'Column to sort by.'),
  choice('order', 'Sort direction.', ['asc', 'desc']),
  text('search', 'Free text match.'),
  text('visitor', 'Only this visitor.'),
]

/**
 * What the document says about every route a key may call, keyed like the route table (`METHOD /path`). A route in
 * the table without an entry here fails a test, so the document cannot silently lack a route.
 */
export const DESCRIPTIONS: Readonly<Record<string, Described>> = {
  'GET /whoami': {
    summary: 'Who is calling: the key’s scope, sites, expiry and what is left of its rate limit.',
    response: 'The caller.',
  },
  'GET /openapi.json': { summary: 'This document.', response: 'An OpenAPI 3.1 document.' },
  'GET /summary': {
    summary: 'Headline numbers of every site the key can see.',
    query: [
      text('from', 'Start, ISO 8601. Default: 24 hours ago.'),
      text('to', 'End, ISO 8601. Default: now.'),
      choice('series', 'Adds a visitors and revenue series per site.', ['hour', 'day']),
      text('compare', 'Set to 1 for the totals of the window before.'),
    ],
    response: 'One entry per site.',
  },
  'GET /sites': { summary: 'The sites the key can see.', response: 'A list of sites.' },
  'GET /sites/:id': { summary: 'One site.', response: 'The site.' },
  'GET /sites/:id/shared': { summary: 'The site’s name, formats and shared views.', response: 'Shared site data.' },
  'GET /sites/:id/favicon': {
    summary: 'The site’s icon.',
    response: 'An image, or 404 when the site has none.',
    media: 'image/*',
  },
  'GET /sites/:id/overview': {
    summary: 'Visitors, pageviews, sessions, bounce rate and revenue.',
    query: RANGE,
    response: 'Totals for the range.',
  },
  'GET /sites/:id/timeseries': {
    summary: 'The same totals per interval.',
    query: RANGE,
    response: 'A series of buckets.',
  },
  'GET /sites/:id/properties': {
    summary: 'The properties of one goal’s events: its keys, or the values of `key`.',
    query: [
      ...RANGE,
      { ...text('name', 'The goal name.'), required: true },
      text('key', 'A property key to list the values of.'),
    ],
    response: 'Keys or values with counts.',
  },
  'GET /sites/:id/breakdown': {
    summary: 'Rows grouped by one dimension.',
    query: [
      { ...choice('dimension', 'What to group by.', DIMENSIONS), required: true },
      text('limit', 'Rows to return.', { type: 'integer', minimum: 1 }),
      ...RANGE,
    ],
    response: 'Rows with counts.',
  },
  'GET /sites/:id/bots': {
    summary: 'Crawler and AI bot traffic.',
    query: [
      ...RANGE,
      text('crawler', 'Only this crawler. Repeat for several.'),
      choice('category', 'Only this category. Repeat for several.', BOT_CATEGORIES),
      text('page', 'Only this page. Repeat for several.'),
    ],
    response: 'Bot statistics.',
  },
  'GET /sites/:id/targets': {
    summary: 'Progress of the site’s targets in their own period.',
    response: 'Targets with progress.',
  },
  'GET /sites/:id/vitals': { summary: 'Web Vitals percentiles.', query: RANGE, response: 'Percentiles per metric.' },
  'GET /sites/:id/journeys': {
    summary: 'The first pages of the newest sessions and where they went. Costly: shares a lower limit.',
    query: RANGE,
    response: 'Journey flows.',
  },
  'GET /sites/:id/retention': {
    summary: 'Weekly cohort retention. Costly: shares a lower limit.',
    query: RANGE,
    response: 'Cohorts.',
  },
  'GET /sites/:id/realtime': { summary: 'Visitors on the site now.', response: 'Live visitors and pages.' },
  'GET /sites/:id/sessions': {
    summary: 'Sessions, newest first. A `search` counts as a costly call.',
    query: [...RANGE, ...PAGE],
    response: 'A page of sessions.',
  },
  'GET /sites/:id/sessions/:sid': { summary: 'One session with its events.', response: 'The session, or 404.' },
  'GET /sites/:id/events': {
    summary: 'Events, newest first.',
    query: [
      ...RANGE,
      ...PAGE,
      choice('type', 'Only this event type.', ['pageview', 'goal', 'outbound', 'identify', 'revenue']),
      text('name', 'Only this event name.'),
    ],
    response: 'A page of events.',
  },
  'GET /sites/:id/event-log': {
    summary: 'The same as `/events`, under a name content blockers leave alone.',
    query: [
      ...RANGE,
      ...PAGE,
      choice('type', 'Only this event type.', ['pageview', 'goal', 'outbound', 'identify', 'revenue']),
      text('name', 'Only this event name.'),
    ],
    response: 'A page of events.',
  },
  'GET /sites/:id/funnels': { summary: 'The site’s funnels.', response: 'A list of funnels.' },
  'GET /sites/:id/funnels/:fid': {
    summary: 'A funnel with its result for the range.',
    query: RANGE,
    response: 'Step counts, or 404.',
  },
  'GET /sites/:id/payments': {
    summary: 'Payments and refunds.',
    query: [
      ...RANGE,
      ...PAGE,
      choice('kind', 'Only payments or only refunds.', ['payment', 'refund']),
      text('provider', 'Only this provider.'),
      choice('attributed', 'Only payments with or without a visit attributed.', ['true', 'false']),
    ],
    response: 'A page of payments.',
  },
  'GET /sites/:id/export': {
    summary: 'A full export as JSON, or one table as CSV. Costly: shares a lower limit.',
    query: [
      choice('format', 'Default json.', ['json', 'csv']),
      choice('table', 'The table for csv. Default events.', EXPORT_TABLES),
    ],
    response: 'A file.',
    media: 'application/json',
  },
  'GET /sites/:id/imports': { summary: 'History imported from other tools.', response: 'A list of imports.' },
  'PATCH /sites/:id': { summary: 'Changes the site’s settings.', body: 'The fields to change.', response: 'The site.' },
  'POST /sites/:id/annotations': {
    summary: 'Adds a dated note to the charts.',
    body: 'The note: date and text.',
    response: 'The note.',
  },
  'PATCH /sites/:id/annotations/:nid': {
    summary: 'Changes a note.',
    body: 'The fields to change.',
    response: 'The note, or 404.',
  },
  'DELETE /sites/:id/annotations/:nid': { summary: 'Deletes a note.', response: '`{ ok: true }`, or 404.' },
  'POST /sites/:id/funnels': {
    summary: 'Creates a funnel.',
    body: 'The funnel: name and steps.',
    response: 'The funnel.',
  },
  'DELETE /sites/:id/funnels/:fid': { summary: 'Deletes a funnel.', response: '`{ ok: true }`, or 404.' },
  'POST /sites/:id/rematch': {
    summary: 'Matches unattributed payments to visits again.',
    response: 'How many were matched.',
  },
  'POST /sites/:id/import': {
    summary: 'Imports visits from another tool, in chunks. Costly: shares a lower limit.',
    body: 'The source and the visits.',
    response: 'What was imported.',
  },
  'DELETE /sites/:id/imports/:source': {
    summary: 'Removes everything imported from one source.',
    response: 'How many rows were removed.',
  },
}

const ERROR = { $ref: '#/components/schemas/Error' }
const RATE_HEADERS = {
  'X-RateLimit-Limit': { $ref: '#/components/headers/X-RateLimit-Limit' },
  'X-RateLimit-Remaining': { $ref: '#/components/headers/X-RateLimit-Remaining' },
  'X-RateLimit-Reset': { $ref: '#/components/headers/X-RateLimit-Reset' },
}

const pathParameters = (path: string): Json[] =>
  [...path.matchAll(/:([a-z]+)/gi)].map(([, name]) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }))

const operationId = (method: string, path: string): string =>
  method.toLowerCase() +
  path
    .replace(/\.json$/, '')
    .split('/')
    .filter(Boolean)
    .map((part) => part.replace(/^:/, 'By-'))
    .map((part) => part.replace(/(^|-)([a-z])/g, (_, __, letter: string) => letter.toUpperCase()))
    .join('')

function operation(method: string, path: string, scope: 'read' | 'write', described: Described): Json {
  const content = {
    [described.media ?? 'application/json']: { schema: { type: 'object', additionalProperties: true } },
  }
  return {
    operationId: operationId(method, path),
    summary: described.summary,
    'x-analytik-scope': scope,
    security: [{ bearerKey: [] }],
    parameters: [
      ...pathParameters(path),
      ...(described.query ?? []).map(({ name, description, schema, required }) => ({
        name,
        in: 'query',
        description,
        required: required ?? false,
        schema: schema ?? { type: 'string' },
      })),
    ],
    ...(described.body !== undefined && {
      requestBody: {
        description: described.body,
        content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
      },
    }),
    responses: {
      '200': { description: described.response, headers: RATE_HEADERS, content },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '403': { $ref: '#/components/responses/Forbidden' },
      '429': { $ref: '#/components/responses/TooManyRequests' },
    },
  }
}

let cached: Json | undefined

/** The OpenAPI 3.1 document of the routes an API key can call, built from the route table once per process. */
export function openApiDocument(): Json {
  if (cached) return cached
  const paths: Record<string, Record<string, Json>> = {}
  const usable = KEY_ROUTES.filter((route) => route.access !== 'closed').sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  )
  for (const route of usable) {
    const described = DESCRIPTIONS[`${route.method} ${route.path}`]
    if (!described) continue
    const path = route.path.replace(/:([a-z]+)/gi, '{$1}')
    ;(paths[path] ??= {})[route.method.toLowerCase()] = operation(
      route.method,
      route.path,
      route.access === 'write' ? 'write' : 'read',
      described,
    )
  }
  cached = {
    openapi: '3.1.0',
    info: {
      title: 'Analytik API',
      version,
      'x-api-version': 'v1',
      description:
        'The routes an API key can call. Send the key as `Authorization: Bearer anl_…`. A `read` key can call every GET; a `write` key every operation here.',
    },
    servers: [{ url: '/v1', description: 'Relative to the address of the analytics server, under its base path.' }],
    security: [{ bearerKey: [] }],
    paths,
    components: {
      securitySchemes: { bearerKey: { type: 'http', scheme: 'bearer', bearerFormat: 'anl_' } },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'string' } },
        },
      },
      headers: {
        'X-RateLimit-Limit': {
          description: 'Requests a minute this key may make on this kind of route.',
          schema: { type: 'integer' },
        },
        'X-RateLimit-Remaining': { description: 'Requests left in the current minute.', schema: { type: 'integer' } },
        'X-RateLimit-Reset': {
          description: 'Unix time in seconds when the window resets.',
          schema: { type: 'integer' },
        },
        'Retry-After': { description: 'Seconds to wait before trying again.', schema: { type: 'integer' } },
      },
      responses: {
        Unauthorized: {
          description: 'The key is missing, unknown, disabled or expired. All alike on purpose.',
          content: { 'application/json': { schema: ERROR } },
        },
        Forbidden: {
          description: 'The key may not do this: read-only key on a write, a site outside its list, or a closed route.',
          content: { 'application/json': { schema: ERROR } },
        },
        TooManyRequests: {
          description: 'A rate limit applies. Wait the seconds in Retry-After.',
          headers: {
            'Retry-After': { $ref: '#/components/headers/Retry-After' },
            ...RATE_HEADERS,
          },
          content: { 'application/json': { schema: ERROR } },
        },
      },
    },
  }
  return cached
}
