import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
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
const lastError = (run) => JSON.parse(run.stderr.trim().split('\n').at(-1))
const page = (nodes) => ({
	nodes,
	pageInfo: { endCursor: null, hasNextPage: false },
})

/** Just enough of Literary Universe for lu init and lu sync. */
function world() {
	return {
		universe: {
			id: 'universe',
			title: 'Deep Sea',
			language: 'en',
			description: 'An ocean world.',
			genre: 'fantasy',
			rating: 'teen',
			license: 'cc-by',
			aiModel: null,
			version: 'uv1',
			translations: [],
		},
		story: {
			id: 'story',
			universeId: 'universe',
			title: 'The Long Night',
			language: 'en',
			description: 'A voyage.',
			genres: ['fantasy'],
			tags: [],
			rating: 'teen',
			license: 'cc-by',
			aiModel: null,
			version: 'sv1',
			translations: [],
		},
		chapter: {
			id: 'chapter',
			storyId: 'story',
			sequence: 0,
			title: 'First Light',
			language: 'en',
			hasDraft: true,
			version: 'v1',
			updatedAt: 't1',
			markdown: 'Dawn.',
		},
		entry: {
			id: 'nemo',
			universeId: 'universe',
			name: 'Nemo',
			categoryTitle: 'Characters',
			language: 'en',
			pronunciation: null,
			tags: [],
			summary: 'A captain.',
			parent: null,
			related: [],
			fields: [
				{
					id: 'f1',
					title: 'Biography',
					type: 'textarea',
					private: false,
					text: 'Born a prince.',
				},
			],
			aiModel: null,
			version: 'ev1',
			released: [],
			editions: [{ language: 'en', version: 'ev1' }],
		},
		comic: {
			id: 'comic',
			universeId: 'universe',
			title: 'Skyward',
			description: 'A tower.',
			format: 'webtoon',
			genres: ['fantasy'],
			chaptersCount: 1,
			pageCountTotal: 3,
			aiModel: null,
		},
	}
}

function answer(state, { operationName, variables }) {
	const { chapter, entry } = state
	const draft = () => ({
		...chapter,
		content: { type: 'doc', content: [{ type: 'paragraph' }] },
	})
	switch (operationName) {
		case 'LuStory':
			return variables.id === 'story' ? state.story : null
		case 'LuUniverse':
			return variables.id === 'universe' ? state.universe : null
		case 'LuStories':
			return page([state.story])
		case 'LuChapters':
			return page([chapter])
		case 'LuDraft':
			return draft()
		case 'LuSaveDraft':
			chapter.markdown = variables.input.markdown
			chapter.version = `${chapter.version}+`
			chapter.updatedAt = `${chapter.updatedAt}+`
			return { version: chapter.version, draft: draft() }
		case 'LuEncyclopediaEntries':
			return page([
				{ ...entry, editions: [{ language: 'en', version: entry.version }] },
			])
		case 'LuEncyclopediaEntry':
			return variables.id === entry.id ? entry : null
		case 'LuCreateEncyclopediaEntry':
			return {
				...entry,
				id: 'created',
				name: variables.input.name,
				categoryTitle: variables.input.categoryTitle,
				summary: variables.input.summary,
				fields: [],
				aiModel: variables.input.aiModel ?? null,
				version: 'new1',
			}
		case 'LuSeries':
			return [{ id: 'series', title: 'Reading order', storyIds: ['story'] }]
		case 'LuComics':
			return page([state.comic])
	}
	throw new Error(`Unexpected ${operationName}`)
}

async function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), 'lu-cli-init-'))
	const state = world()
	const requests = []
	const server = createServer(async (req, res) => {
		let body = ''
		for await (const chunk of req) body += chunk
		// Port scanners (an IDE probing new local ports) send no body; ignore them.
		if (!body) return res.end()
		const request = JSON.parse(body)
		requests.push(request)
		res.setHeader('Content-Type', 'application/json')
		const result = answer(state, request)
		res.end(
			JSON.stringify(
				result === null
					? {
							errors: [
								{ message: 'Not found', extensions: { code: 'NOT_FOUND' } },
							],
						}
					: { data: { result } },
			),
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
	const write = (file, text) => {
		mkdirSync(join(folder, file, '..'), { recursive: true })
		writeFileSync(join(folder, file), text)
	}
	return {
		folder,
		read,
		write,
		state,
		requests,
		baseUrl: env.LU_BASE_URL,
		run: (args) => command(args, env),
		env,
	}
}

test('lu init story syncs into an existing folder and writes the agent workspace once', {
	timeout: 30_000,
}, async (t) => {
	const { folder, read, write, run, baseUrl } = await fixture(t)
	write(
		'.claude/settings.json',
		'{"permissions":{"allow":["Bash(lu status)"]}}',
	)
	write('.obsidian/app.json', '{}')
	write('Ideas.md', 'My own notes.\n')
	const first = await run(['init', 'story', 'story', '--directory', folder])
	assert.equal(first.code, 0, first.stderr)
	const report = JSON.parse(first.stdout)
	assert.equal(report.kind, 'story')
	assert.equal(report.title, 'The Long Night')
	// The folder held the author's files (and .obsidian/): no repository is made.
	assert.equal(report.git, 'skipped')
	assert.ok(!existsSync(join(folder, '.git')))
	assert.deepEqual(report.sync.created.sort(), [
		'01 First Light.md',
		'Story.md',
	])
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
	assert.deepEqual(JSON.parse(read('.lu/vault.json')), {
		version: 1,
		baseUrl,
		scope: { kind: 'story', storyId: 'story' },
	})
	assert.match(
		read('01 First Light.md'),
		/^---\nlu_kind: chapter\n[\s\S]*\n---\n\nDawn\.\n$/,
	)
	assert.equal(read('Ideas.md'), 'My own notes.\n')
	const agents = read('AGENTS.md')
	assert.match(
		agents,
		/"The Long Night"\n\(id `story`\), set up by `lu init story`/,
	)
	assert.match(agents, /ai_model: <your exact model id>/)
	assert.ok(!agents.includes('{{'))
	assert.equal(read('CLAUDE.md'), '@AGENTS.md\n')
	assert.deepEqual(JSON.parse(read('.mcp.json')), {
		mcpServers: {
			'literary-universe': { command: 'lu', args: ['mcp', '--url', baseUrl] },
		},
	})
	assert.deepEqual(JSON.parse(read('.claude/settings.json')), {
		permissions: { allow: ['Bash(lu status)'] },
		enabledMcpjsonServers: ['literary-universe'],
	})
	assert.equal(
		read('.codex/config.toml'),
		`[mcp_servers.literary-universe]\ncommand = "lu"\nargs = ["mcp","--url",${JSON.stringify(baseUrl)}]\n`,
	)
	assert.equal(read('.gitignore'), '.lu/lock\n')
	assert.match(
		read('.claude/skills/story-review/SKILL.md'),
		/^---\nname: story-review\n/,
	)

	writeFileSync(join(folder, 'AGENTS.md'), 'Mine.\n')
	const again = await run(['init', 'story', 'story', '--directory', folder])
	assert.equal(again.code, 0, again.stderr)
	assert.deepEqual(JSON.parse(again.stdout).written, [])
	assert.equal(JSON.parse(again.stdout).git, 'skipped')
	assert.equal(read('AGENTS.md'), 'Mine.\n')

	const other = await run([
		'init',
		'universe',
		'universe',
		'--directory',
		folder,
	])
	assert.equal(other.code, 1)
	assert.equal(lastError(other).code, 'INVALID_PROJECT')
	const missing = await run([
		'init',
		'story',
		'nothing',
		'--directory',
		join(folder, 'x'),
	])
	assert.equal(missing.code, 1)
	assert.equal(lastError(missing).code, 'NOT_FOUND')
	assert.ok(!existsSync(join(folder, 'x')))
})

test('lu init needs the kind without a terminal and never contacts the server for it', async () => {
	const env = {
		...process.env,
		LU_TOKEN: 'lu_test_fixture',
		LU_BASE_URL: 'http://127.0.0.1:9',
	}
	for (const args of [['init'], ['init', 'story-id']]) {
		const run = await command(args, env)
		assert.equal(run.code, 1)
		const error = JSON.parse(run.stderr)
		assert.equal(error.code, 'INIT_KIND_REQUIRED')
		assert.match(error.message, /lu init story ID/)
		assert.match(error.message, /lu init universe ID/)
	}
})

test('lu init universe lays out the universe, and lu status and lu sync push edits and new notes', {
	timeout: 30_000,
}, async (t) => {
	const { folder, read, write, run, state, requests } = await fixture(t)
	write('Daily/2026-11-21.md', '# Today\n')
	write('node_modules/pkg/README.md', 'Not a note.\n')
	const init = await run([
		'init',
		'universe',
		'universe',
		'--directory',
		folder,
	])
	assert.equal(init.code, 0, init.stderr)
	const { sync } = JSON.parse(init.stdout)
	assert.deepEqual(sync.created.sort(), [
		'Comics/Skyward.md',
		'Encyclopedia/Characters/Nemo.md',
		'Series.md',
		'Stories/The Long Night/01 First Light.md',
		'Stories/The Long Night/Story.md',
		'Universe.md',
	])
	assert.match(read('AGENTS.md'), /set up by `lu init universe`/)
	assert.match(read('AGENTS.md'), /Encyclopedia\/<category>\/<name>\.md/)
	assert.match(
		read('Encyclopedia/Characters/Nemo.md'),
		/A captain\.\n\n## Biography\n\nBorn a prince\.\n$/,
	)
	assert.match(read('Series.md'), /1\. \[\[The Long Night\]\]/)
	assert.equal(read('Daily/2026-11-21.md'), '# Today\n')

	const status = (args = []) =>
		run(['status', '--directory', folder, ...args]).then((result) => {
			assert.equal(result.code, 0, result.stderr)
			return JSON.parse(result.stdout)
		})
	assert.deepEqual(await status(), [])
	const chapter = 'Stories/The Long Night/01 First Light.md'
	write(
		chapter,
		read(chapter)
			.replace(
				'lu_kind: chapter',
				'lu_kind: chapter\nai_model: claude-opus-5-5',
			)
			.replace('Dawn.', 'Dawn broke.'),
	)
	write(
		'Encyclopedia/Characters/Ned Land.md',
		'---\nlu_kind: entry\nai_model: claude-opus-5-5\n---\n\nA harpooner.\n',
	)
	assert.deepEqual(await status(), [
		{
			path: 'Encyclopedia/Characters/Ned Land.md',
			kind: 'entry',
			state: 'new',
		},
		{ path: chapter, kind: 'chapter', state: 'edited' },
	])

	requests.length = 0
	const pushed = await run(['sync', '--directory', folder])
	assert.equal(pushed.code, 0, pushed.stderr)
	assert.deepEqual(JSON.parse(pushed.stdout).pushed.sort(), [
		'Encyclopedia/Characters/Ned Land.md',
		chapter,
	])
	const save = requests.find((r) => r.operationName === 'LuSaveDraft')
	assert.equal(save.variables.input.markdown, 'Dawn broke.')
	assert.equal(save.variables.input.aiModel, 'claude-opus-5-5')
	assert.equal(save.variables.input.expectedVersion, 'v1')
	const created = requests.find(
		(r) => r.operationName === 'LuCreateEncyclopediaEntry',
	)
	assert.deepEqual(created.variables.input, {
		universeId: 'universe',
		name: 'Ned Land',
		categoryTitle: 'Characters',
		tags: [],
		relatedAdd: [],
		summary: 'A harpooner.',
		fields: [],
		aiModel: 'claude-opus-5-5',
	})
	assert.deepEqual(await status(), [])

	// The chapter changes on both sides: the note stays, the copy waits beside it.
	write(chapter, read(chapter).replace('Dawn broke.', 'Dawn broke late.'))
	state.chapter.markdown = 'Night fell.'
	state.chapter.version = 'v9'
	state.chapter.updatedAt = 't9'
	const conflicted = await run(['sync', '--directory', folder])
	assert.equal(conflicted.code, 1)
	assert.equal(JSON.parse(conflicted.stdout).conflicts.length, 1)
	assert.match(
		read('Stories/The Long Night/01 First Light (Literary Universe).md'),
		/Night fell\./,
	)
	assert.match(read(chapter), /Dawn broke late\./)
	assert.deepEqual(await status(), [
		{ path: chapter, kind: 'chapter', state: 'conflict' },
	])
})

test('legacy commands refuse a vault folder and lu sync refuses other folders', {
	timeout: 30_000,
}, async (t) => {
	const { folder, run, requests } = await fixture(t)
	const init = await run(['init', 'story', 'story', '--directory', folder])
	assert.equal(init.code, 0, init.stderr)
	requests.length = 0
	for (const args of [
		['push', '--directory', folder],
		['refresh', '--directory', folder],
		['pull', 'story', '--directory', folder],
	]) {
		const result = await run(args)
		assert.equal(result.code, 1)
		const error = JSON.parse(result.stderr)
		assert.equal(error.code, 'VAULT_FOLDER')
		assert.match(error.message, /lu sync/)
	}
	assert.equal(requests.length, 0)
	const plain = join(folder, '..', 'plain')
	mkdirSync(plain)
	const sync = await run(['sync', '--directory', plain])
	assert.equal(sync.code, 1)
	assert.equal(JSON.parse(sync.stderr).code, 'NOT_A_VAULT')

	// A lu pull folder takes lu init only for its own story.
	const legacy = join(folder, '..', 'legacy')
	const pull = await run(['pull', 'story', '--directory', legacy])
	assert.equal(pull.code, 0, pull.stderr)
	const other = await run([
		'init',
		'universe',
		'universe',
		'--directory',
		legacy,
	])
	assert.equal(other.code, 1)
	assert.equal(lastError(other).code, 'INVALID_PROJECT')
	const same = await run(['init', 'story', 'story', '--directory', legacy])
	assert.equal(same.code, 0, same.stderr)
	assert.ok(existsSync(join(legacy, '01 First Light.md')))
})

test('lu init binds agent configs to --url without an inherited deployment', {
	timeout: 30_000,
}, async (t) => {
	const { folder, read, baseUrl, env } = await fixture(t)
	delete env.LU_BASE_URL
	const result = await command(
		['init', 'story', 'story', '--directory', folder, '--url', baseUrl],
		env,
	)
	assert.equal(result.code, 0, result.stderr)
	const { args } = JSON.parse(read('.mcp.json')).mcpServers['literary-universe']
	assert.deepEqual(args, ['mcp', '--url', baseUrl])
	assert.ok(read('.codex/config.toml').includes(JSON.stringify(baseUrl)))
	assert.match(read('AGENTS.md'), /append `--url`/)
	assert.match(read('AGENTS.md'), /\.mcp\.json/)
	const sync = await command(
		['sync', '--directory', folder, ...args.slice(1)],
		env,
	)
	assert.equal(sync.code, 0, sync.stderr)
	for (const command_ of [
		['init', 'story', 'story', '--directory', folder],
		['sync', '--directory', folder],
	]) {
		const wrong = await command([...command_, '--url', `${baseUrl}/other`], env)
		assert.equal(wrong.code, 1)
		assert.equal(JSON.parse(wrong.stderr).code, 'DEPLOYMENT_MISMATCH')
	}
})
