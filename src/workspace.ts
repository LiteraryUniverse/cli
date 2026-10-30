import { execFileSync } from 'node:child_process'
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	LiteraryUniverseApiError,
	type LiteraryUniverseClient,
} from '@literary-universe/sdk'
import {
	pullLocalProject,
	readLocalProject,
} from '@literary-universe/sdk/project'

// dist/workspace.js → the package root, where templates/ and skills/ ship.
const assets = fileURLToPath(new URL('../', import.meta.url))
const mcpConfig = {
	mcpServers: { 'literary-universe': { command: 'lu', args: ['mcp'] } },
}
const codexConfig =
	'[mcp_servers.literary-universe]\ncommand = "lu"\nargs = ["mcp"]\n'

type Written = string[]
/** Writes only when the file is absent; the author's own edits stay. */
function writeNew(root: string, file: string, content: string, written: Written) {
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

async function ensureProject(
	client: LiteraryUniverseClient,
	input: InitInput,
) {
	if (!existsSync(join(input.directory, '.lu', 'project.json')))
		return pullLocalProject(client, input)
	const project = readLocalProject(input.directory)
	if (project.storyId !== input.storyId)
		throw new LiteraryUniverseApiError(
			'INVALID_PROJECT',
			'This folder holds a different story',
		)
	return project
}

type InitInput = {
	directory: string
	baseUrl: string
	storyId: string
	language?: string
}
export async function initWorkspace(
	client: LiteraryUniverseClient,
	input: InitInput,
) {
	await ensureProject(client, input)
	const story = await client.story({ id: input.storyId })
	const title = story?.title ?? input.storyId
	const root = input.directory
	const written: Written = []
	const agents = readFileSync(join(assets, 'templates', 'AGENTS.md'), 'utf8')
		.replaceAll('{{title}}', title)
		.replaceAll('{{id}}', input.storyId)
	writeNew(root, 'AGENTS.md', agents, written)
	writeNew(root, 'CLAUDE.md', '@AGENTS.md\n', written)
	writeNew(root, '.mcp.json', `${JSON.stringify(mcpConfig, null, 2)}\n`, written)
	approveMcpServer(root, written)
	writeNew(root, '.codex/config.toml', codexConfig, written)
	writeNew(root, '.gitignore', '.lu/lock\n', written)
	copySkills(root, written)
	return { storyId: input.storyId, title, written, git: initGit(root) }
}
