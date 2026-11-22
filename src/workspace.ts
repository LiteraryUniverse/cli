import { execFileSync } from 'node:child_process'
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import {
	LiteraryUniverseApiError,
	type LiteraryUniverseClient,
} from '@literary-universe/sdk'
import {
	localProjectStatus,
	readLocalProject,
} from '@literary-universe/sdk/project'
import {
	readVaultConfig,
	type SyncReport,
	syncVault,
	type VaultConfig,
	type VaultFiles,
	vaultStatus,
	writeVaultConfig,
} from '@literary-universe/sdk/vault'
import { parse, stringify } from 'yaml'

// dist/workspace.js → the package root, where templates/ and skills/ ship.
const assets = fileURLToPath(new URL('../', import.meta.url))

// lineWidth 0: long titles stay on one line, as Obsidian writes them.
const yaml = {
	parse: (text: string) => parse(text),
	stringify: (value: unknown) => stringify(value, { lineWidth: 0 }),
}

const fail = (code: string, message: string): never => {
	throw new LiteraryUniverseApiError(code, message)
}

/**
 * The folder's Markdown notes for the SDK's vault sync, with `/` paths.
 * Dot-folders (.git, .obsidian, .lu, .claude, .codex, .trash) and
 * node_modules hold no notes of the author's.
 */
export function folderFiles(root: string): VaultFiles {
	const inside = (path: string) => {
		const full = resolve(root, path)
		const rel = relative(root, full)
		if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
			fail('INVALID_PROJECT', `${path} is outside the folder`)
		return full
	}
	async function walk(dir: string, prefix: string, found: string[]) {
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
			const path = prefix ? `${prefix}/${entry.name}` : entry.name
			if (entry.isDirectory()) await walk(join(dir, entry.name), path, found)
			else if (entry.isFile() && entry.name.endsWith('.md')) found.push(path)
		}
		return found
	}
	return {
		list: () => walk(root, '', []),
		read: (path) =>
			readFile(inside(path), 'utf8').catch((error) =>
				error?.code === 'ENOENT' ? undefined : Promise.reject(error),
			),
		async write(path, text) {
			const full = inside(path)
			await mkdir(dirname(full), { recursive: true })
			await writeFile(full, text)
		},
		async rename(from, to) {
			const target = inside(to)
			await mkdir(dirname(target), { recursive: true })
			await rename(inside(from), target)
		},
		exists: async (path) => existsSync(inside(path)),
	}
}

export const isVault = (directory: string) =>
	existsSync(join(directory, '.lu', 'vault.json'))

const deployment = (baseUrl: string) => {
	const url = new URL(baseUrl)
	return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

/** The folder's vault config, refused when it belongs to another deployment. */
async function configFor(files: VaultFiles, baseUrl: string) {
	const config = await readVaultConfig(files)
	if (config && config.baseUrl !== deployment(baseUrl))
		fail('DEPLOYMENT_MISMATCH', 'This folder belongs to a different deployment')
	return config
}

/** Conflicts and failures need the author; the command then exits with 1. */
export const unsettled = (report: SyncReport) =>
	report.conflicts.length > 0 || report.failures.length > 0

export async function syncFolder(
	client: LiteraryUniverseClient,
	directory: string,
	baseUrl: string,
) {
	const files = folderFiles(directory)
	const config =
		(await configFor(files, baseUrl)) ??
		fail(
			'NOT_A_VAULT',
			'This folder is not set up for lu sync; run lu init story ID or lu init universe ID first',
		)
	return syncVault({
		client,
		files,
		yaml,
		scope: config.scope,
		language: config.language,
	})
}

/** What the next `lu sync` pushes, read offline. */
export async function folderStatus(directory: string) {
	const files = folderFiles(directory)
	const config = await readVaultConfig(files)
	if (!config) return undefined
	return vaultStatus({ files, yaml, scope: config.scope })
}

type Written = string[]
/** Writes only when the file is absent; the author's own edits stay. */
function writeNew(
	root: string,
	file: string,
	content: string,
	written: Written,
) {
	const path = join(root, file)
	if (existsSync(path)) return
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, content)
	written.push(file)
}

/** Claude Code asks before using project MCP servers unless settings pre-approve them. */
function approveMcpServer(root: string, written: Written) {
	const file = '.claude/settings.json'
	const path = join(root, file)
	const settings = existsSync(path)
		? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)
		: {}
	const enabled = Array.isArray(settings.enabledMcpjsonServers)
		? (settings.enabledMcpjsonServers as string[])
		: []
	if (enabled.includes('literary-universe')) return
	settings.enabledMcpjsonServers = [...enabled, 'literary-universe']
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`)
	written.push(file)
}

function copySkills(root: string, written: Written) {
	for (const name of readdirSync(join(assets, 'skills')))
		writeNew(
			root,
			`.claude/skills/${name}/SKILL.md`,
			readFileSync(join(assets, 'skills', name, 'SKILL.md'), 'utf8'),
			written,
		)
}

const git = (root: string, args: string[]) =>
	execFileSync('git', args, { cwd: root, stdio: 'pipe', timeout: 30_000 })

/** A repository with an initial commit, unless git is missing or the folder is already tracked. */
function initGit(root: string) {
	try {
		git(root, ['rev-parse', '--is-inside-work-tree'])
		return 'skipped'
	} catch {}
	try {
		git(root, ['init', '-q'])
		git(root, ['add', '-A'])
		git(root, ['commit', '-q', '-m', 'Initial import from Literary Universe'])
		return 'initialized'
	} catch {
		return 'skipped'
	}
}

type Kind = 'story' | 'universe'
type InitInput = {
	directory: string
	baseUrl: string
	kind: Kind
	id: string
	language?: string
}

/** Binds the folder to the work, refusing one bound to something else. */
async function bind(files: VaultFiles, input: InitInput) {
	const baseUrl = deployment(input.baseUrl)
	const scope =
		input.kind === 'story'
			? { kind: 'story' as const, storyId: input.id }
			: { kind: 'universe' as const, universeId: input.id }
	const existing = await configFor(files, input.baseUrl)
	if (existing && JSON.stringify(existing.scope) !== JSON.stringify(scope))
		fail('INVALID_PROJECT', 'This folder syncs a different story or universe')
	let legacy = false
	if (existsSync(join(input.directory, '.lu', 'project.json'))) {
		const project = readLocalProject(input.directory)
		if (project.baseUrl !== baseUrl)
			fail(
				'DEPLOYMENT_MISMATCH',
				'This folder belongs to a different deployment',
			)
		if (input.kind !== 'story' || project.storyId !== input.id)
			fail('INVALID_PROJECT', 'This folder holds a different story')
		// Its unpushed edits would be stranded: lu push stops working in a vault.
		if (
			!existing &&
			localProjectStatus(input.directory).some(
				(item) => item.changed || item.pending,
			)
		)
			fail(
				'LOCAL_CHANGES',
				'Push the changed chapters with lu push before running lu init here',
			)
		legacy = true
	}
	const language = input.language ?? existing?.language
	const config: VaultConfig = {
		version: 1,
		baseUrl,
		scope,
		...(language ? { language } : {}),
	}
	await writeVaultConfig(files, config)
	return { config, legacy }
}

export async function initWorkspace(
	client: LiteraryUniverseClient,
	input: InitInput,
) {
	const work =
		input.kind === 'story'
			? await client.story({ id: input.id })
			: await client.universe({ id: input.id })
	if (!work) fail('NOT_FOUND', `No ${input.kind} with this ID`)
	const title = work?.title ?? input.id
	const root = input.directory
	mkdirSync(root, { recursive: true })
	// An existing folder (an Obsidian vault, say) holds the author's own files,
	// and .obsidian/ can hold plugin keys: no repository is made and committed there.
	const empty = readdirSync(root).length === 0
	const files = folderFiles(root)
	const { config, legacy } = await bind(files, input)
	const sync = await syncVault({
		client,
		files,
		yaml,
		scope: config.scope,
		language: config.language,
	})
	const written: Written = []
	const args = ['mcp', '--url', input.baseUrl]
	const mcpConfig = {
		mcpServers: { 'literary-universe': { command: 'lu', args } },
	}
	const codexConfig = `[mcp_servers.literary-universe]\ncommand = "lu"\nargs = ${JSON.stringify(args)}\n`
	const agents = readFileSync(
		join(assets, 'templates', input.kind, 'AGENTS.md'),
		'utf8',
	)
		.replaceAll('{{title}}', title)
		.replaceAll('{{id}}', input.id)
	writeNew(root, 'AGENTS.md', agents, written)
	writeNew(root, 'CLAUDE.md', '@AGENTS.md\n', written)
	writeNew(
		root,
		'.mcp.json',
		`${JSON.stringify(mcpConfig, null, 2)}\n`,
		written,
	)
	approveMcpServer(root, written)
	writeNew(root, '.codex/config.toml', codexConfig, written)
	writeNew(root, '.gitignore', '.lu/lock\n', written)
	copySkills(root, written)
	if (legacy && !written.includes('AGENTS.md'))
		process.stderr.write(
			`${JSON.stringify({ event: 'legacy-project', message: 'chapters/ and .lu/project.json are the old lu pull format, which lu sync does not use. AGENTS.md still describes that format: delete it and run lu init again for the new one.' })}\n`,
		)
	return {
		kind: input.kind,
		id: input.id,
		title,
		sync,
		written,
		git: empty ? initGit(root) : 'skipped',
	}
}

/**
 * `lu init story ID` and `lu init universe ID` say what to set up. Otherwise a
 * terminal asks; anything else must say it.
 */
export async function initTarget(
	client: LiteraryUniverseClient,
	positionals: string[],
): Promise<{ kind: Kind; id: string }> {
	const [, first, second] = positionals
	if (first === 'story' || first === 'universe')
		return {
			kind: first,
			id: second ?? fail('BAD_USER_INPUT', `Run lu init ${first} ID`),
		}
	if (!process.stdin.isTTY)
		fail(
			'INIT_KIND_REQUIRED',
			'Say what to set up: lu init story ID or lu init universe ID',
		)
	const prompt = createInterface({
		input: process.stdin,
		output: process.stderr,
	})
	try {
		const ask = async (guess?: Kind) => {
			const choices =
				guess === 'story' ? 'S/u' : guess === 'universe' ? 's/U' : 's/u'
			const answer = (await prompt.question(`Story or universe? [${choices}] `))
				.trim()
				.toLowerCase()
			if (!answer && guess) return guess
			if (answer.startsWith('s')) return 'story'
			if (answer.startsWith('u')) return 'universe'
			return fail('BAD_USER_INPUT', 'Answer story or universe')
		}
		if (first) {
			const found = (lookup: Promise<unknown>) => lookup.catch(() => null)
			const [story, universe] = await Promise.all([
				found(client.story({ id: first })),
				found(client.universe({ id: first })),
			])
			return {
				kind: await ask(story ? 'story' : universe ? 'universe' : undefined),
				id: first,
			}
		}
		const kind = await ask()
		// ponytail: first page only; the full walkthrough is LiteraryUniverse/cli#12.
		const works = (
			kind === 'story' ? await client.stories() : await client.universes()
		).nodes
		works.forEach((work, index) => {
			process.stderr.write(`${index + 1}. ${work.title} (${work.id})\n`)
		})
		const answer = (
			await prompt.question(works.length ? 'Number or ID: ' : `${kind} ID: `)
		).trim()
		const id = works[Number(answer) - 1]?.id ?? answer
		return { kind, id: id || fail('BAD_USER_INPUT', `Give a ${kind} ID`) }
	} finally {
		prompt.close()
	}
}
