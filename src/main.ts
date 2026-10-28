#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs'
import { parseArgs } from 'node:util'
import {
	type JsonValue,
	LiteraryUniverseApiError,
	LiteraryUniverseClient,
} from '@literary-universe/sdk'
import {
	localProjectStatus,
	pullLocalProject,
	pushLocalProject,
} from '@literary-universe/sdk/project'
import { loadKey, removeKey, storeKey } from './credentials.js'
import { imageCommand } from './images.js'

const help = `Literary Universe CLI\n\nlu identity|profile|stories|universes\nlu story|universe|draft <id>\nlu chapters <story-id> [--language <locale>]\nlu pull <story-id> --directory <new-folder> [--language <locale>]\nlu status [--directory <folder>]\nlu push [--directory <folder>]\nlu save <chapter-id> --file <tiptap.json> --expected-version <version> --operation-id <id>\nlu recovery <chapter-id> --recovery-id <id>\nlu create <story-id> --operation-id <id> [--title <title>] [--file <tiptap.json>]\nlu publish <chapter-id> --expected-version <version> --operation-id <id> [--at <ISO-time>] [--audience readers|beta]\nlu image policy\nlu image prepare --file <source> --purpose <purpose> --output <new-file> [--crop x,y,w,h]\nlu image upload <target-id> --file <prepared> --purpose <purpose> --policy-version <version> --operation-id <id>\nlu image cover story|universe <id> --file <image>\nlu auth store|remove\n\nSet LU_TOKEN or provide a key through stdin to lu auth store. Keys are stored\nin the OS credential store for the selected deployment. Select it with --url\nor LU_BASE_URL. Output is JSON. Stripe settings are managed on the web.\n`

const options = {
	url: { type: 'string' },
	purpose: { type: 'string' },
	output: { type: 'string' },
	crop: { type: 'string' },
	format: { type: 'string' },
	'policy-file': { type: 'string' },
	'policy-version': { type: 'string' },
	title: { type: 'string' },
	at: { type: 'string' },
	audience: { type: 'string' },
	'ai-generated': { type: 'boolean' },
	directory: { type: 'string' },
	language: { type: 'string' },
	file: { type: 'string' },
	'expected-version': { type: 'string' },
	'operation-id': { type: 'string' },
	'recovery-id': { type: 'string' },
	help: { type: 'boolean', short: 'h' },
} as const
const parse = () => parseArgs({ allowPositionals: true, options })
type Args = ReturnType<typeof parse> & { directory: string; baseUrl: string }
const required = (value?: string) =>
	value ?? invalid('Missing argument; run lu --help')
function invalid(message: string): never {
	throw new LiteraryUniverseApiError('BAD_USER_INPUT', message)
}

async function inputKey() {
	if (process.env.LU_TOKEN) return process.env.LU_TOKEN
	if (process.stdin.isTTY)
		invalid('Set LU_TOKEN or provide the key through stdin')
	let key = ''
	for await (const chunk of process.stdin) {
		key += String(chunk)
		if (key.length > 512) invalid('API key input is too long')
	}
	return key.trim()
}

async function auth(args: Args) {
	const action = args.positionals[1]
	if (action === 'store') storeKey(args.baseUrl, await inputKey())
	else if (action === 'remove') removeKey(args.baseUrl)
	else invalid('Use lu auth store or lu auth remove')
	output({ status: action === 'store' ? 'stored' : 'removed' })
}

function reads(client: LiteraryUniverseClient, args: Args) {
	const id = args.positionals[1],
		language = args.values.language
	const handlers: Record<string, () => Promise<unknown>> = {
		identity: () => client.identity(),
		profile: () => client.profile(),
		stories: () => client.stories(),
		universes: () => client.universes(),
		story: () => client.story({ id: required(id) }),
		universe: () => client.universe({ id: required(id) }),
		chapters: () => client.chapters({ storyId: required(id), language }),
		draft: () => client.draft({ id: required(id), language }),
		recovery: () =>
			client.draftRecovery({
				id: required(id),
				recoveryId: required(args.values['recovery-id']),
			}),
	}
	return handlers[args.positionals[0]]
}

async function push(client: LiteraryUniverseClient, args: Args) {
	const changes = localProjectStatus(args.directory).filter(
		(item) => item.changed || item.pending,
	)
	process.stderr.write(
		`${JSON.stringify({ event: 'push-plan', deployment: args.baseUrl, changes })}\n`,
	)
	const result = await pushLocalProject(client, args)
	output(result)
	if (result.some((item) => item.status === 'failed')) process.exitCode = 1
}

function sourceDocument(file: string): JsonValue {
	if (statSync(file).size > 16 * 1024 * 1024)
		throw new LiteraryUniverseApiError(
			'PAYLOAD_TOO_LARGE',
			'Source file exceeds the size limit',
		)
	return JSON.parse(
		readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
	) as JsonValue
}

function saveInput(args: Args) {
	return {
		id: required(args.positionals[1]),
		language: args.values.language,
		expectedVersion: required(args.values['expected-version']),
		operationId: required(args.values['operation-id']),
		content: sourceDocument(required(args.values.file)),
	}
}

async function create(client: LiteraryUniverseClient, args: Args) {
	const input = {
		storyId: required(args.positionals[1]),
		title: args.values.title,
		operationId: required(args.values['operation-id']),
		isAIGenerated: args.values['ai-generated'],
		content: args.values.file ? sourceDocument(args.values.file) : undefined,
	}
	process.stderr.write(
		`${JSON.stringify({
			event: 'create-plan',
			deployment: args.baseUrl,
			storyId: input.storyId,
			operationId: input.operationId,
			title: input.title,
		})}\n`,
	)
	output(await client.createChapter(input))
}

async function publish(client: LiteraryUniverseClient, args: Args) {
	const audience = args.values.audience ?? 'readers'
	if (audience !== 'readers' && audience !== 'beta')
		invalid('Use --audience readers or beta')
	const input = {
		id: required(args.positionals[1]),
		language: args.values.language,
		expectedVersion: required(args.values['expected-version']),
		operationId: required(args.values['operation-id']),
		publishAt: args.values.at,
		audience: audience === 'readers' ? ('READERS' as const) : ('BETA' as const),
	}
	process.stderr.write(
		`${JSON.stringify({ event: 'publish-plan', deployment: args.baseUrl, ...input })}\n`,
	)
	output(await client.publishChapter(input))
}

async function save(client: LiteraryUniverseClient, args: Args) {
	const input = saveInput(args)
	process.stderr.write(
		`${JSON.stringify({
			event: 'save-plan',
			deployment: args.baseUrl,
			id: input.id,
			expectedVersion: input.expectedVersion,
			operationId: input.operationId,
		})}\n`,
	)
	output(await client.saveDraft(input))
}

async function dispatch(client: LiteraryUniverseClient, args: Args) {
	const command = args.positionals[0],
		read = reads(client, args)
	if (read) output(await read())
	else if (command === 'pull')
		output(
			await pullLocalProject(client, {
				...args,
				storyId: required(args.positionals[1]),
				language: args.values.language,
			}),
		)
	else if (command === 'push') await push(client, args)
	else if (command === 'save') await save(client, args)
	else if (command === 'image') output(await imageCommand(client, args))
	else if (command === 'create') await create(client, args)
	else if (command === 'publish') await publish(client, args)
	else invalid('Unknown command; run lu --help')
}

function argumentsFor(parsed: ReturnType<typeof parse>): Args {
	return {
		...parsed,
		directory: parsed.values.directory ?? process.cwd(),
		baseUrl:
			parsed.values.url ??
			process.env.LU_BASE_URL ??
			'https://literaryuniverse.com',
	}
}

const clientFor = (baseUrl: string) =>
	new LiteraryUniverseClient({
		baseUrl,
		credentials: () => ({ kind: 'api-key', token: loadKey(baseUrl) }),
		clientName: 'lu-cli/0.1.0',
	})

async function main() {
	const parsed = parse()
	if (!parsed.positionals[0] || parsed.values.help) {
		process.stdout.write(help)
		return
	}
	const args = argumentsFor(parsed)
	if (args.positionals[0] === 'status')
		return output(localProjectStatus(args.directory))
	if (args.positionals[0] === 'auth') return auth(args)
	await dispatch(clientFor(args.baseUrl), args)
}

function output(value: unknown) {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}
main().catch((error) => {
	const failure =
		error instanceof LiteraryUniverseApiError
			? { code: error.code, message: error.message, requestId: error.requestId }
			: {
					code: 'CLI_ERROR',
					message: 'Command failed; check its arguments and local files',
				}
	process.stderr.write(`${JSON.stringify(failure)}\n`)
	process.exitCode = 1
})
