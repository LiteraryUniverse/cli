import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../dist/main.js', import.meta.url))
function command(args, env) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [cli, ...args], {
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
		})
		let stdout = '',
			stderr = ''
		child.stdout.on('data', (chunk) => {
			stdout += chunk
		})
		child.stderr.on('data', (chunk) => {
			stderr += chunk
		})
		child.on('error', reject)
		child.on('close', (code) => resolve({ code, stdout, stderr }))
	})
}
const draft = {
	id: 'chapter',
	storyId: 'story',
	sequence: 1,
	title: 'First Light',
	language: 'en',
	version: 'v1',
	content: { type: 'doc', content: [{ type: 'paragraph' }] },
	markdown: 'Dawn.',
}
const results = {
	LuStory: { id: 'story', title: 'The Long Night', language: 'en' },
	LuChapters: {
		nodes: [{ id: 'chapter', hasDraft: true }],
		pageInfo: { hasNextPage: false, endCursor: null },
	},
	LuDraft: draft,
}

async function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), 'lu-cli-init-'))
	const server = createServer(async (req, res) => {
		let body = ''
		for await (const chunk of req) body += chunk
		// Port scanners (an IDE probing new local ports) send no body; ignore them.
		if (!body) return res.end()
		res.setHeader('Content-Type', 'application/json')
		res.end(
			JSON.stringify({
				data: { result: results[JSON.parse(body).operationName] },
			}),
		)
	})
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	t.after(async () => {
		await new Promise((resolve) => server.close(resolve))
		rmSync(root, { recursive: true, force: true })
	})
	const env = {
		...process.env,
		LU_TOKEN: 'lu_test_fixture',
		LU_BASE_URL: `http://127.0.0.1:${server.address().port}`,
		GIT_AUTHOR_NAME: 'Test',
		GIT_AUTHOR_EMAIL: 'test@example.test',
		GIT_COMMITTER_NAME: 'Test',
		GIT_COMMITTER_EMAIL: 'test@example.test',
	}
	const folder = join(root, 'workspace')
	const read = (file) => readFileSync(join(folder, file), 'utf8')
	return { folder, read, run: (args) => command(args, env) }
}

test('lu init pulls the story and writes the agent workspace once', async (t) => {
	const { folder, read, run } = await fixture(t)
	mkdirSync(join(folder, '.claude'), { recursive: true })
	writeFileSync(
		join(folder, '.claude', 'settings.json'),
		'{"permissions":{"allow":["Bash(lu status)"]}}',
	)
	const first = await run(['init', 'story', '--directory', folder])
	assert.equal(first.code, 0, first.stderr)
	const report = JSON.parse(first.stdout)
	assert.equal(report.title, 'The Long Night')
	assert.equal(report.git, 'initialized')
	assert.deepEqual(report.written.sort(), [
		'.claude/settings.json',
		'.claude/skills/continuity-check/SKILL.md',
		'.claude/skills/story-review/SKILL.md',
		'.claude/skills/world-rules/SKILL.md',
		'.codex/config.toml',
		'.gitignore',
		'.mcp.json',
		'AGENTS.md',
		'CLAUDE.md',
	])
	assert.match(read('AGENTS.md'), /"The Long Night"\n\(id `story`\)/)
	assert.ok(!read('AGENTS.md').includes('{{'))
	assert.equal(read('CLAUDE.md'), '@AGENTS.md\n')
	assert.deepEqual(JSON.parse(read('.mcp.json')), {
		mcpServers: { 'literary-universe': { command: 'lu', args: ['mcp'] } },
	})
	assert.deepEqual(JSON.parse(read('.claude/settings.json')), {
		permissions: { allow: ['Bash(lu status)'] },
		enabledMcpjsonServers: ['literary-universe'],
	})
	assert.match(
		read('.codex/config.toml'),
		/^\[mcp_servers\.literary-universe\]\ncommand = "lu"\nargs = \["mcp"\]\n$/,
	)
	assert.equal(read('.gitignore'), '.lu/lock\n')
	assert.match(
		read('.claude/skills/story-review/SKILL.md'),
		/^---\nname: story-review\n/,
	)
	assert.ok(existsSync(join(folder, 'chapters', 'chapter-chapter.en.json')))
	const log = execFileSync('git', ['log', '--oneline'], {
		cwd: folder,
		encoding: 'utf8',
	})
	assert.match(log, /Initial import from Literary Universe/)
	assert.ok(
		!execFileSync('git', ['ls-files'], {
			cwd: folder,
			encoding: 'utf8',
		}).includes('.lu/lock'),
	)

	writeFileSync(join(folder, 'AGENTS.md'), 'Mine.\n')
	const again = await run(['init', 'story', '--directory', folder])
	assert.equal(again.code, 0, again.stderr)
	assert.deepEqual(JSON.parse(again.stdout).written, [])
	assert.equal(JSON.parse(again.stdout).git, 'skipped')
	assert.equal(read('AGENTS.md'), 'Mine.\n')

	const other = await run(['init', 'another', '--directory', folder])
	assert.equal(other.code, 1)
	assert.equal(
		JSON.parse(other.stderr.trim().split('\n').at(-1)).code,
		'INVALID_PROJECT',
	)
})
