import { LiteraryUniverseApiError } from '@literary-universe/sdk'

type AssistantArgs = {
	baseUrl: string
	positionals: string[]
	values: {
		skill?: string
		chapter?: string
		language?: string
		entry?: string
		'entry-name'?: string
		'chapter-offset'?: string
	}
}

function invalid(message: string): never {
	throw new LiteraryUniverseApiError('BAD_USER_INPUT', message)
}
const required = (value?: string) =>
	value ?? invalid('Missing argument; run lu --help')

/**
 * Calls one of the in-app AI Assistant's skill loaders on the hosted MCP
 * endpoint, which keeps no sessions, so a single tools/call needs no
 * handshake. The instructions stay on the server.
 */
async function callAssistantTool(
	baseUrl: string,
	token: string,
	name: string,
	args: Record<string, unknown>,
) {
	const response = await fetch(new URL('/mcp?tools=assistant', baseUrl), {
		method: 'POST',
		headers: {
			authorization: `Bearer ${token}`,
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
		},
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/call',
			params: { name, arguments: args },
		}),
	})
	if (response.status === 401 || response.status === 403)
		throw new LiteraryUniverseApiError(
			'UNAUTHENTICATED',
			'Sign in with lu login; organization keys cannot load assistant skills',
		)
	if (!response.ok)
		throw new LiteraryUniverseApiError(
			'ASSISTANT_UNAVAILABLE',
			`The assistant skill could not be loaded (HTTP ${response.status})`,
		)
	const reply = (await response.json()) as {
		result?: { isError?: boolean; content?: { text?: string }[] }
		error?: { message?: string }
	}
	const text = reply.result?.content?.[0]?.text ?? ''
	if (reply.error || reply.result?.isError)
		throw new LiteraryUniverseApiError(
			'ASSISTANT_REFUSED',
			text || reply.error?.message || 'The assistant refused the request',
		)
	return JSON.parse(text) as unknown
}

const WRITING_SKILLS = [
	'proofreading',
	'tone',
	'consistency',
	'developmental',
	'dialogue',
	'worldbuilding',
]

export function assistantCommand(
	args: AssistantArgs,
	token: () => Promise<string>,
) {
	if (args.positionals[0] !== 'assistant') return undefined
	const [, kind, id] = args.positionals
	const { values } = args
	if (kind === 'writing') {
		const skill = required(values.skill)
		if (!WRITING_SKILLS.includes(skill))
			invalid(`--skill is one of ${WRITING_SKILLS.join(', ')}`)
		return async () =>
			callAssistantTool(args.baseUrl, await token(), 'load-writing-skill', {
				storyId: required(id),
				skill,
				chapterId: values.chapter,
				language: values.language,
			})
	}
	if (kind === 'universe') {
		if (!values.entry && !values['entry-name'])
			invalid('Give --entry <entry-id> or --entry-name <name>')
		const offset = values['chapter-offset']
		if (offset !== undefined && !/^\d+$/.test(offset))
			invalid('--chapter-offset is a whole number')
		return async () =>
			callAssistantTool(args.baseUrl, await token(), 'load-universe-skill', {
				universeId: required(id),
				skill: 'discrepancies',
				entryId: values.entry,
				entryName: values['entry-name'],
				chapterOffset: offset === undefined ? undefined : Number(offset),
			})
	}
	return invalid('Use lu assistant writing or lu assistant universe')
}
