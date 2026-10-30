import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
	existsSync,
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
const document = (text) => ({
	type: 'doc',
	content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})
const failure = (result) => JSON.parse(result.stderr.trim().split('\n').at(-1))

function command(args, env) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [cli, ...args], {
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
		})
		let stdout = '',
			stderr = ''
		child.stdout.on('data', (data) => {
			stdout += data
		})
		child.stderr.on('data', (data) => {
			stderr += data
		})
		child.on('error', reject)
		child.on('close', (code) => resolve({ code, stdout, stderr }))
	})
}

async function fixture(t, second = false, pull = true) {
	const root = mkdtempSync(join(tmpdir(), 'lu CLI Ω & workflow-'))
	const state = {
		draft: {
			id: 'chapter',
			storyId: 'story',
			sequence: 1,
			title: 'Chapter',
			language: 'en',
			version: 'v1',
			content: document('Original.'),
			markdown: 'Original.',
		},
		writes: 0,
		dropReply: false,
		operations: new Map(),
		requests: [],
	}
	if (second) state.second = { ...state.draft, id: 'second', sequence: 2 }
	const server = createServer(async (req, res) => {
		let body = ''
		for await (const chunk of req) body += chunk
		const request = JSON.parse(body)
		state.requests.push(request)
		assert.equal(req.headers.authorization, 'Bearer lu_test_fixture')
		assert.equal(req.headers['x-lu-client'], 'lu-cli/0.2.0')
		let result
		if (request.operationName === 'LuChapters')
			result = {
				nodes: [state.draft, state.second]
					.filter(Boolean)
					.map(({ id }) => ({ id, hasDraft: true })),
				pageInfo: { hasNextPage: false, endCursor: null },
			}
		else if (
			request.operationName === 'LuDraft' &&
			state.failDraft === request.variables.id
		) {
			res.statusCode = 500
			res.end()
			return
		} else if (request.operationName === 'LuDraft')
			result =
				request.variables.id === state.second?.id ? state.second : state.draft
		else if (request.operationName === 'LuValidateDraft') {
			const input = request.variables.input
			const draft = input.id === 'second' ? state.second : state.draft
			const code =
				input.expectedVersion !== draft.version
					? 'VERSION_CONFLICT'
					: input.content.content[0]?.content?.[0]?.text === 'bad'
						? 'BAD_USER_INPUT'
						: undefined
			if (code) {
				res.end(
					JSON.stringify({
						errors: [{ message: 'Draft rejected', extensions: { code } }],
					}),
				)
				return
			}
			result = { version: draft.version, warnings: [] }
		} else if (request.operationName === 'LuSaveDraft') {
			const input = request.variables.input
			if (input.content.content[0]?.content?.[0]?.text === 'huge') {
				res.statusCode = 413
				res.end(
					JSON.stringify({
						errors: [
							{
								message: 'Request exceeds the API size limit',
								extensions: { code: 'PAYLOAD_TOO_LARGE' },
							},
						],
					}),
				)
				return
			}
			if (input.content.content[0]?.content?.[0]?.text === 'bad') {
				res.end(
					JSON.stringify({
						errors: [
							{
								message: 'Invalid content',
								extensions: { code: 'BAD_USER_INPUT' },
							},
						],
					}),
				)
				return
			}
			result = state.operations.get(input.operationId)
			if (!result) {
				const draft = input.id === 'second' ? state.second : state.draft
				assert.equal(input.expectedVersion, draft.version)
				state.writes++
				const saved = {
					...draft,
					content: input.content,
					version: `v${state.writes + 1}`,
				}
				if (input.id === 'second') state.second = saved
				else state.draft = saved
				result = {
					draft: saved,
					version: saved.version,
					warnings: [],
					recoveryId: 'recovery',
				}
				state.operations.set(input.operationId, result)
				state.onSave?.(input.id)
			}
			if (state.dropReply) {
				state.dropReply = false
				res.destroy()
				return
			}
		} else {
			res.statusCode = 400
			res.end()
			return
		}
		res.setHeader('Content-Type', 'application/json')
		res.end(JSON.stringify({ data: { result } }))
	})
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	const baseUrl = `http://127.0.0.1:${server.address().port}`
	const env = {
		...process.env,
		LU_TOKEN: 'lu_test_fixture',
		LU_BASE_URL: baseUrl,
	}
	t.after(async () => {
		await new Promise((resolve) => server.close(resolve))
		rmSync(root, { recursive: true, force: true })
	})
	const run = (args) => command(args, env)
	const folder = join(root, 'project')
	if (pull)
		assert.equal((await run(['pull', 'story', '--directory', folder])).code, 0)
	const file = join(folder, 'chapters', 'chapter-chapter.en.json')
	return { folder, file, run, state }
}

test('CLI rejects chapter filenames that would overwrite each other on Windows or macOS', async (t) => {
	const { folder, file, run, state } = await fixture(t, true, false)
	state.second.id = 'CHAPTER'
	state.second.content = document('Different chapter.')
	const result = await run(['pull', 'story', '--directory', folder])
	assert.equal(result.code, 1)
	assert.equal(failure(result).code, 'INVALID_PROJECT')
	// The failed pull leaves nothing behind, not one chapter's file.
	assert.equal(existsSync(file), false)
	assert.equal(state.writes, 0)
})

test('CLI refuses a project copied from a filesystem with case-sensitive chapter names', async (t) => {
	const { folder, file, run, state } = await fixture(t)
	const path = join(folder, '.lu', 'project.json')
	const project = JSON.parse(readFileSync(path, 'utf8'))
	project.chapters.push({
		...project.chapters[0],
		id: 'CHAPTER',
		file: 'chapters/chapter-CHAPTER.en.json',
	})
	writeFileSync(path, JSON.stringify(project))
	const result = await run(['status', '--directory', folder])
	assert.equal(result.code, 1)
	assert.equal(failure(result).code, 'INVALID_PROJECT')
	assert.deepEqual(
		JSON.parse(readFileSync(file, 'utf8')),
		document('Original.'),
	)
	assert.equal(state.writes, 0)
})

test('CLI preserves canonical JSON through pull, local edit, status and push', async (t) => {
	const { folder, file, run, state } = await fixture(t)
	writeFileSync(file, JSON.stringify(document('Hello from a local agent.')))
	assert.equal(
		JSON.parse((await run(['status', '--directory', folder])).stdout)[0]
			.changed,
		true,
	)
	const push = await run(['push', '--directory', folder])
	assert.equal(push.code, 0, push.stderr)
	assert.equal(
		state.draft.content.content[0].content[0].text,
		'Hello from a local agent.',
	)
	assert.equal(
		JSON.parse((await run(['status', '--directory', folder])).stdout)[0]
			.changed,
		false,
	)
	assert.equal(state.writes, 1)
	assert.ok(!push.stdout.includes('lu_test_fixture'))
})

test('CLI accepts UTF-8 BOM and CRLF edits from Windows without changing them during status', async (t) => {
	const { folder, file, run, state } = await fixture(t)
	const content = document('Windows edit.')
	const source = `\uFEFF${JSON.stringify(content, null, 2).replaceAll('\n', '\r\n')}`
	writeFileSync(file, source)
	const status = await run(['status', '--directory', folder])
	assert.equal(status.code, 0, status.stderr)
	assert.equal(JSON.parse(status.stdout)[0].changed, true)
	assert.equal(readFileSync(file, 'utf8'), source)
	const pushed = await run(['push', '--directory', folder])
	assert.equal(pushed.code, 0, pushed.stderr)
	assert.deepEqual(state.draft.content, content)
})

test('CLI pushes the validated batch and preserves edits made while another chapter saves', async (t) => {
	const { folder, file, run, state } = await fixture(t, true)
	const second = join(folder, 'chapters', 'chapter-second.en.json')
	writeFileSync(file, JSON.stringify(document('First intended edit.')))
	writeFileSync(second, JSON.stringify(document('Second intended edit.')))
	state.onSave = (id) => {
		if (id === 'chapter')
			writeFileSync(second, JSON.stringify(document('Later local edit.')))
	}
	const push = await run(['push', '--directory', folder])
	assert.equal(push.code, 0, push.stderr)
	assert.equal(
		state.second.content.content[0].content[0].text,
		'Second intended edit.',
	)
	assert.equal(
		JSON.parse(readFileSync(second)).content[0].content[0].text,
		'Later local edit.',
	)
	assert.equal(
		JSON.parse((await run(['status', '--directory', folder])).stdout)[1]
			.changed,
		true,
	)
})

test('CLI resumes a lost write reply using the original operation without another write', async (t) => {
	const { folder, file, run, state } = await fixture(t)
	writeFileSync(file, JSON.stringify(document('Saved once.')))
	state.dropReply = true
	assert.equal((await run(['push', '--directory', folder])).code, 1)
	assert.equal(
		JSON.parse((await run(['status', '--directory', folder])).stdout)[0]
			.pending,
		true,
	)
	assert.equal((await run(['push', '--directory', folder])).code, 0)
	assert.equal(state.writes, 1)
	const saves = state.requests.filter(
		(request) => request.operationName === 'LuSaveDraft',
	)
	assert.equal(
		saves[0].variables.input.operationId,
		saves[1].variables.input.operationId,
	)
})

test('CLI permits corrected input after a known rejection while preserving the local file', async (t) => {
	const { folder, file, run, state } = await fixture(t)
	writeFileSync(file, JSON.stringify(document('bad')))
	assert.equal((await run(['push', '--directory', folder])).code, 1)
	writeFileSync(file, JSON.stringify(document('fixed')))
	assert.equal((await run(['push', '--directory', folder])).code, 0)
	assert.equal(state.draft.content.content[0].content[0].text, 'fixed')
})

test('CLI pushes later chapters past a refused one and accepts its corrected file', async (t) => {
	const { folder, file, run, state } = await fixture(t, true)
	const second = join(folder, 'chapters', 'chapter-second.en.json')
	writeFileSync(file, JSON.stringify(document('huge')))
	writeFileSync(second, JSON.stringify(document('Second edit.')))
	assert.equal((await run(['push', '--directory', folder])).code, 1)
	assert.equal(state.second.content.content[0].content[0].text, 'Second edit.')
	writeFileSync(file, JSON.stringify(document('smaller')))
	assert.equal((await run(['push', '--directory', folder])).code, 0)
	assert.equal(state.draft.content.content[0].content[0].text, 'smaller')
})

test('CLI retries a pull that failed partway into the same directory', async (t) => {
	const { folder, run, state } = await fixture(t, true, false)
	state.failDraft = 'second'
	assert.equal((await run(['pull', 'story', '--directory', folder])).code, 1)
	delete state.failDraft
	assert.equal((await run(['pull', 'story', '--directory', folder])).code, 0)
	assert.equal(
		JSON.parse((await run(['status', '--directory', folder])).stdout).length,
		2,
	)
})

test('CLI refuses a stale draft without replacing local content or making a write', async (t) => {
	const { folder, file, run, state } = await fixture(t)
	writeFileSync(file, JSON.stringify(document('My edit.')))
	state.draft.version = 'browser-v2'
	const push = await run(['push', '--directory', folder])
	assert.equal(push.code, 1)
	assert.equal(failure(push).code, 'VERSION_CONFLICT')
	assert.equal(state.writes, 0)
	assert.equal(
		JSON.parse(readFileSync(file)).content[0].content[0].text,
		'My edit.',
	)
})

test('CLI refuses manifest traversal and deployment changes before sending credentials', async (t) => {
	const { folder, run, state } = await fixture(t)
	const path = join(folder, '.lu', 'project.json')
	const manifest = JSON.parse(readFileSync(path))
	manifest.baseUrl = 'https://another-deployment.test'
	writeFileSync(path, JSON.stringify(manifest))
	const before = state.requests.length
	assert.equal(
		failure(await run(['push', '--directory', folder])).code,
		'DEPLOYMENT_MISMATCH',
	)
	assert.equal(state.requests.length, before)
	manifest.chapters[0].file = '../../outside.json'
	writeFileSync(path, JSON.stringify(manifest))
	assert.equal(
		JSON.parse((await run(['status', '--directory', folder])).stderr).code,
		'INVALID_PROJECT',
	)
})
