#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { sep } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
	type JsonValue,
	LiteraryUniverseApiError,
	LiteraryUniverseClient,
} from '@literary-universe/sdk'
import { registerLiteraryUniverseTools } from '@literary-universe/sdk/mcp'
import {
	localProjectStatus,
	pullLocalProject,
	pushLocalProject,
	refreshLocalProject,
} from '@literary-universe/sdk/project'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { comicCommand } from './comics.js'
import {
	hasKey,
	loadKey,
	loadSession,
	removeKey,
	storeKey,
	storeSession,
} from './credentials.js'
import {
	curationCommand,
	noteOption,
	pageSize,
	STORY_NOTES,
	UNIVERSE_NOTES,
} from './curation.js'
import { imageCommand } from './images.js'
import { login, revokeSession } from './oauth.js'
import {
	folderStatus,
	initTarget,
	initWorkspace,
	isVault,
	syncFolder,
	unsettled,
} from './workspace.js'

const help = `Literary Universe CLI\n\nlu -v|--version\nlu identity|profile\nlu stories [--organization <id>] [--universe <id>] [--first <1-100>] [--after <cursor>]\nlu universes [--organization <id>] [--first <1-100>] [--after <cursor>]\nlu story|universe|draft <id>\nlu chapters <story-id> [--language <locale>]\nlu init story <story-id> [--directory <folder>] [--language <locale>]\nlu init universe <universe-id> [--directory <folder>] [--language <locale>]\nlu sync [--directory <folder>]\nlu status [--directory <folder>]\nlu pull <story-id> --directory <new-folder> [--language <locale>]   (legacy format)\nlu refresh|push [--directory <folder>]   (legacy format)\nlu save <chapter-id> --file <tiptap.json> --expected-version <version> --operation-id <id> [--ai-model <model>]\nlu recovery <chapter-id> --recovery-id <id>\nlu create <story-id> --operation-id <id> [--title <title>] [--file <tiptap.json>] [--ai-generated] [--ai-model <model>]\nlu publish <chapter-id> --expected-version <version> --operation-id <id> [--at <ISO-time>] [--audience readers|beta]\nlu image policy\nlu image prepare --file <source> --purpose <purpose> --output <new-file> [--crop x,y,w,h]\nlu image upload <target-id> --file <prepared> --purpose <purpose> --policy-version <version> --operation-id <id>\nlu image cover story|universe|comic <id> --file <image>\nlu story creation-options\nlu story create --title <t> --slug <s> --description <d> --language <locale> --genres <a,b> --rating <r> --license <l> [--universe <id>] [--ai-generated --ai-model <model>]\nlu story update <story-id> [--title <t>] [--description <d>] [--genres <a,b>] [--tags <a,b>] [--rating <r>] [--license <l>] [--language <locale>] [--universe <id>|--standalone] [--ai-model <model>] [--expected-version <v>]\nlu story hide|show <story-id>\nlu story notes <story-id>\nlu story notes update <story-id> [--file <notes.json>] [--concept <md>] [--settings <md>] [--theme <md>] [--impact <md>] [--outcome <md>] [--audience <md>] [--audience-age-group <group>] [--audience-sex male|female] [--pitch <md>] [--notes <md>] [--expected-version <v>]\nlu chapter rename <chapter-id> --title <title> [--language <locale>]\nlu chapter remove <chapter-id>\nlu chapter reorder <story-id> --chapters <id,id,...>\nlu universe create --title <t> --slug <s> --genre <g> --rating <r> --license <l> --language <locale> --description <d> [--ai-model <model>]\nlu universe update <universe-id> [--title <t>] [--slug <s>] [--description <d>] [--genre <g>] [--rating <r>] [--license <l>] [--language <locale>] [--ai-model <model>] [--expected-version <v>]\nlu universe notes <universe-id>\nlu universe notes update <universe-id> [--file <notes.json>] [--overview <md>] [--foundation <md>] [--society <md>] [--conflicts <md>] [--key-locations <md>] [--story-hooks <md>] [--notes <md>] [--expected-version <v>]\nlu entries <universe-id> [--after <cursor>]\nlu entry <entry-id> [--language <locale>]\nlu entry create <universe-id> --file <entry.json> [--ai-model <model>]\nlu entry update <entry-id> --file <changes.json> [--ai-model <model>] [--expected-version <v>]\nlu entry translate <entry-id> --language <locale> --file <translation.json> [--expected-version <v>]\nlu entry publish <entry-id> [--audience readers|beta] [--language <locale>] [--at <ISO-time>] [--expected-version <v>] [--operation-id <id>]\nlu entry unpublish|delete <entry-id>\nlu series <universe-id>\nlu series save <universe-id> --title <t> --stories <id,id,...> --expected-version <n> [--series <id>]\nlu comics [--organization <id>] [--universe <id>] [--first <1-100>] [--after <cursor>]\nlu comic <comic-id>\nlu comic create [--file <metadata.json>] --title <t> --description <d> --format manga|webtoon|comic --license <l> [--language <locale>] [--genres <a,b>] [--tags <a,b>] [--rating <r>] [--universe <id>] [--slug <s>] [--ai-generated]\nlu comic update <comic-id> [--file <changes.json>] [--title <t>] [--description <d>] [--format <f>] [--language <locale>] [--genres <a,b>] [--tags <a,b>] [--rating <r>]\nlu comic chapters <comic-id>\nlu comic chapter create <comic-id> [--title <title>]\nlu comic chapter update <chapter-id> --file <changes.json>\nlu comic chapter rename <chapter-id> --title <title>\nlu comic chapter remove <chapter-id>\nlu comic chapter reorder <comic-id> --chapters <id,id,...>\nlu comic pages <chapter-id>\nlu comic upload <chapter-id> <image>... | --directory <folder>\nlu comic page replace <page-id> --chapter <chapter-id> --file <image>\nlu comic page alt <page-id> --alt <text>\nlu comic page remove <page-id>\nlu comic page reorder <chapter-id> --pages <id,id,...>\nlu comic layer create <page-id> --file <layer.json>\nlu comic layer update <layer-id> --file <changes.json>\nlu comic layer remove <layer-id>\nlu comic publish <chapter-id> [--at <ISO-time>] [--audience readers|beta]\nlu blogs\nlu blog pages <blog-id> [--first <1-100>] [--after <last-page-id>]\nlu blog menus <blog-id>\nlu blog mutate <blog-id> --file <mutation.json>\nlu blog posts <blog-id> [--first <1-100>] [--after <last-post-id>]\nlu blog post <post-id>\nlu blog mutate-post <blog-id> --file <mutation.json>\nlu auth store|remove\nlu login|logout [--url <deployment>]\nlu update [--yes]   (checks npm for a newer CLI and offers to install it)\nlu mcp [--tools <category,tool,...>] [--url <deployment>]\n\nlu login signs in through the browser and keeps a refreshable session in the\nOS credential store. Set LU_TOKEN or provide a key through stdin to lu auth store. Keys are stored\nin the OS credential store for the selected deployment. Select it with --url\nor LU_BASE_URL. Output is JSON. Stripe settings are managed on the web.\n`

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
	'ai-model': { type: 'string' },
	chapter: { type: 'string' },
	directory: { type: 'string' },
	language: { type: 'string' },
	file: { type: 'string' },
	'expected-version': { type: 'string' },
	'operation-id': { type: 'string' },
	'recovery-id': { type: 'string' },
	description: { type: 'string' },
	genres: { type: 'string' },
	genre: { type: 'string' },
	tags: { type: 'string' },
	rating: { type: 'string' },
	license: { type: 'string' },
	slug: { type: 'string' },
	universe: { type: 'string' },
	organization: { type: 'string' },
	standalone: { type: 'boolean' },
	chapters: { type: 'string' },
	pages: { type: 'string' },
	alt: { type: 'string' },
	stories: { type: 'string' },
	series: { type: 'string' },
	first: { type: 'string' },
	after: { type: 'string' },
	tools: { type: 'string' },
	help: { type: 'boolean', short: 'h' },
	version: { type: 'boolean', short: 'v' },
	yes: { type: 'boolean', short: 'y' },
	// One text option per note, such as --concept and --key-locations.
	...(Object.fromEntries(
		[...STORY_NOTES, ...UNIVERSE_NOTES].map((field) => [
			noteOption(field),
			{ type: 'string' },
		]),
	) as Record<string, { type: 'string' }>),
} as const
const parseOptions = () => parseArgs({ allowPositionals: true, options })
/**
 * A refused option is reported in Node's words, which name the option and
 * never its value: a text starting with a dash, such as a Markdown list, has
 * to be given as `--option=value`.
 */
function parse() {
	try {
		return parseOptions()
	} catch (error) {
		if (String((error as { code?: string }).code).startsWith('ERR_PARSE_ARGS'))
			invalid((error as Error).message.replace(/\s*\n\s*/g, ' '))
		throw error
	}
}
type Args = ReturnType<typeof parseOptions> & {
	directory: string
	baseUrl: string
}
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

async function session(args: Args) {
	if (args.positionals[0] === 'login') {
		const stored = await login(args.baseUrl)
		storeSession(args.baseUrl, stored)
		return output({
			status: 'logged-in',
			deployment: args.baseUrl,
			accessExpiresAt: stored.accessExpiresAt,
		})
	}
	const current = loadSession(args.baseUrl)
	// Signing out locally must not depend on reaching the deployment.
	const revoked = current
		? await revokeSession(args.baseUrl, current).then(
				() => true,
				() => false,
			)
		: undefined
	removeKey(args.baseUrl)
	output({ status: 'logged-out', deployment: args.baseUrl, revoked })
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
	// Organization works are listed only when --organization or --universe asks for them.
	const page = () => ({
		first: pageSize(args.values.first),
		after: args.values.after,
		organizationId: args.values.organization,
	})
	const handlers: Record<string, () => Promise<unknown>> = {
		identity: () => client.identity(),
		profile: () => client.profile(),
		stories: () =>
			client.stories({ ...page(), universeId: args.values.universe }),
		universes: () => client.universes(page()),
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
	for (const item of result)
		if (item.code === 'AMBIGUOUS_CHANGE')
			process.stderr.write(
				`${JSON.stringify({ event: 'ambiguous-change', id: item.id, message: 'Both the Markdown and the JSON file changed; revert one and push again' })}\n`,
			)
	if (result.some((item) => item.status === 'failed')) process.exitCode = 1
}

/** A stdio MCP server for local agents; stdout carries the protocol, so nothing else prints there. */
async function mcp(args: Args) {
	const selection = (args.values.tools ?? process.env.LU_MCP_TOOLS)
		?.split(',')
		.map((item) => item.trim())
		.filter(Boolean)
	const server = new McpServer({ name: 'literary-universe', version })
	const client = clientFor(args.baseUrl)
	const { registered } = registerLiteraryUniverseTools(server, {
		client: () => (hasKey(args.baseUrl) ? client : null),
		tools: selection,
		readLocalFile: (path) => readFile(path),
	})
	process.stderr.write(
		`${JSON.stringify({ event: 'mcp', deployment: args.baseUrl, tools: registered })}\n`,
	)
	await server.connect(new StdioServerTransport())
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
		aiModel: args.values['ai-model'],
	}
}

async function create(client: LiteraryUniverseClient, args: Args) {
	const input = {
		storyId: required(args.positionals[1]),
		title: args.values.title,
		operationId: required(args.values['operation-id']),
		isAIGenerated: args.values['ai-generated'],
		aiModel: args.values['ai-model'],
		content: args.values.file ? sourceDocument(args.values.file) : undefined,
	}
	process.stderr.write(
		`${JSON.stringify({
			event: 'create-plan',
			deployment: args.baseUrl,
			storyId: input.storyId,
			operationId: input.operationId,
			title: input.title,
			aiModel: input.aiModel,
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
			aiModel: input.aiModel,
		})}\n`,
	)
	output(await client.saveDraft(input))
}

async function dispatch(client: LiteraryUniverseClient, args: Args) {
	const command = args.positionals[0],
		curation = curationCommand(client, args) ?? comicCommand(client, args),
		read = reads(client, args)
	if (curation) output(await curation())
	else if (read) output(await read())
	else if (command === 'pull')
		output(
			await pullLocalProject(client, {
				...args,
				storyId: required(args.positionals[1]),
				language: args.values.language,
			}),
		)
	else if (command === 'init') {
		const result = await initWorkspace(client, {
			...args,
			...(await initTarget(client, args.positionals)),
			language: args.values.language,
		})
		output(result)
		if (unsettled(result.sync)) process.exitCode = 1
	} else if (command === 'sync') {
		const report = await syncFolder(client, args.directory, args.baseUrl)
		output(report)
		if (unsettled(report)) process.exitCode = 1
	} else if (command === 'refresh')
		output(await refreshLocalProject(client, args))
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

const { version } = JSON.parse(
	readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string }
const packageName = '@literary-universe/cli'
const numbers = (v: string) => v.split('-')[0].split('.').map(Number)
/** True when `latest` is a newer release than `current` (a prerelease sorts before its release). */
function isNewer(latest: string, current: string) {
	const [a, b] = [numbers(latest), numbers(current)]
	for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
	return current.includes('-') && !latest.includes('-')
}

async function updateCheck() {
	// npm exports npm_config_registry to scripts; honour it for mirrors and tests.
	const registry = (
		process.env.npm_config_registry ?? 'https://registry.npmjs.org'
	).replace(/\/$/, '')
	const response = await fetch(`${registry}/${packageName}/latest`, {
		signal: AbortSignal.timeout(10_000),
	}).catch(() => undefined)
	const latest = response?.ok
		? ((await response.json()) as { version?: string }).version
		: undefined
	if (!latest)
		throw new LiteraryUniverseApiError(
			'UPDATE_CHECK_FAILED',
			`Could not read the latest version from ${registry}`,
		)
	const updateAvailable = isNewer(latest, version)
	// A Bun global install lives under ~/.bun; anything else came from npm.
	const [tool, ...install] = fileURLToPath(import.meta.url).includes(
		`${sep}.bun${sep}`,
	)
		? ['bun', 'add', '--global', `${packageName}@latest`]
		: ['npm', 'install', '--global', `${packageName}@latest`]
	return {
		current: version,
		latest,
		updateAvailable,
		...(updateAvailable && { command: [tool, ...install].join(' ') }),
		tool,
		install,
	}
}

async function confirm(question: string) {
	const prompt = createInterface({
		input: process.stdin,
		output: process.stderr,
	})
	// Ctrl+C or Ctrl+D at the prompt closes it, which counts as no.
	const answer = await prompt
		.question(question)
		.catch(() => '')
		.finally(() => prompt.close())
	return /^y(es)?$/i.test(answer.trim())
}

async function update(args: Args) {
	const { tool, install, ...result } = await updateCheck()
	const interactive = process.stdin.isTTY && process.stderr.isTTY
	if (!result.updateAvailable) return output(result)
	if (interactive)
		process.stderr.write(
			`lu ${result.latest} is available (installed: ${result.current}). To update, run:\n\n  ${result.command}\n\n`,
		)
	if (
		!args.values.yes &&
		!(interactive && (await confirm('Update now? [y/N] ')))
	)
		return output(result)
	// npm's progress goes to stderr so stdout stays a single JSON result.
	// Windows starts npm through its npm.cmd shim, which needs a shell; the
	// arguments are fixed strings.
	const run = spawnSync(tool, install, {
		stdio: ['inherit', 2, 2],
		shell: process.platform === 'win32',
	})
	const updated = run.status === 0
	if (!updated) process.exitCode = 1
	output({ ...result, updated })
}

const clientFor = (baseUrl: string) =>
	new LiteraryUniverseClient({
		baseUrl,
		credentials: async (signal) => ({
			kind: 'api-key',
			token: await loadKey(baseUrl, signal),
		}),
		clientName: `lu-cli/${version}`,
	})

async function main() {
	const parsed = parse()
	if (parsed.values.version) {
		process.stdout.write(`${version}\n`)
		return
	}
	if (!parsed.positionals[0] || parsed.values.help) {
		process.stdout.write(help)
		return
	}
	const args = argumentsFor(parsed)
	if (args.positionals[0] === 'status')
		return output(
			(await folderStatus(args.directory)) ??
				localProjectStatus(args.directory),
		)
	if (
		['pull', 'push', 'refresh'].includes(args.positionals[0]) &&
		isVault(args.directory)
	)
		throw new LiteraryUniverseApiError(
			'VAULT_FOLDER',
			`This folder syncs with lu sync; lu ${args.positionals[0]} works only in folders made by lu pull`,
		)
	if (args.positionals[0] === 'update') return update(args)
	if (args.positionals[0] === 'auth') return auth(args)
	if (['login', 'logout'].includes(args.positionals[0])) return session(args)
	if (args.positionals[0] === 'mcp') return mcp(args)
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
