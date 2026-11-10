import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	truncateSync,
	writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

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

/** A fake deployment that records GraphQL operations and image uploads. */
async function deployment(t) {
	const requests = []
	let uploads = 0
	const server = createServer(async (req, res) => {
		const chunks = []
		for await (const chunk of req) chunks.push(chunk)
		if (!chunks.length) return res.end()
		res.setHeader('content-type', 'application/json')
		const url = new URL(req.url, 'http://local')
		if (url.pathname === '/api/author/images') {
			requests.push({ upload: Object.fromEntries(url.searchParams) })
			res.statusCode = 201
			return res.end(
				JSON.stringify({ data: { result: { fileId: `file-${++uploads}` } } }),
			)
		}
		const request = JSON.parse(Buffer.concat(chunks).toString())
		requests.push(request)
		res.end(
			JSON.stringify({
				data: { result: { operation: request.operationName } },
			}),
		)
	})
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	t.after(() => new Promise((resolve) => server.close(resolve)))
	const env = {
		...process.env,
		LU_TOKEN: 'lu_test_fixture',
		LU_BASE_URL: `http://127.0.0.1:${server.address().port}`,
	}
	return { requests, env }
}

test('comic commands send the named operation with only the given values', async (t) => {
	const { requests, env } = await deployment(t)
	const folder = mkdtempSync(join(tmpdir(), 'lu-cli-comic-'))
	t.after(() => rmSync(folder, { force: true, recursive: true }))
	const layer = join(folder, 'layer.json')
	writeFileSync(
		layer,
		JSON.stringify({
			kind: 'text',
			language: 'en',
			items: [{ x: 0.1, y: 0.1, w: 0.3, h: 0.1, text: 'Hello!' }],
		}),
	)
	const runs = [
		[
			[
				'comic',
				'create',
				'--title',
				'Skyward',
				'--description',
				'A climb.',
				'--format',
				'webtoon',
				'--license',
				'cc-by',
				'--genres',
				'fantasy',
			],
			'LuCreateComic',
			{
				input: {
					title: 'Skyward',
					description: 'A climb.',
					format: 'webtoon',
					license: 'cc-by',
					genres: ['fantasy'],
				},
			},
		],
		[
			['comic', 'chapter', 'create', 'comic'],
			'LuCreateComicChapter',
			{ input: { comicId: 'comic' } },
		],
		[
			['comic', 'page', 'reorder', 'chapter', '--pages', 'b,a'],
			'LuReorderComicPages',
			{ chapterId: 'chapter', pageIds: ['b', 'a'] },
		],
		[
			['comic', 'layer', 'create', 'page', '--file', layer],
			'LuCreateComicLayer',
			{
				input: {
					kind: 'text',
					language: 'en',
					items: [{ x: 0.1, y: 0.1, w: 0.3, h: 0.1, text: 'Hello!' }],
					pageId: 'page',
				},
			},
		],
		[
			['comic', 'publish', 'chapter', '--audience', 'beta'],
			'LuPublishComicChapter',
			{ id: 'chapter', audience: 'BETA' },
		],
		[['comic', 'comic'], 'LuComic', { id: 'comic' }],
		[['comics'], 'LuComics', {}],
	]
	for (const [args, operationName, variables] of runs) {
		requests.length = 0
		const run = await command(args, env)
		assert.equal(run.code, 0, run.stderr)
		assert.equal(requests.length, 1)
		assert.equal(requests[0].operationName, operationName)
		assert.deepEqual(requests[0].variables, variables)
	}
})

test('comic upload sends a folder of pages in name order, then appends them', async (t) => {
	const { requests, env } = await deployment(t)
	const folder = mkdtempSync(join(tmpdir(), 'lu-cli-pages-'))
	t.after(() => rmSync(folder, { force: true, recursive: true }))
	const png = await sharp({
		create: { width: 600, height: 900, channels: 3, background: '#224' },
	})
		.png()
		.toBuffer()
	mkdirSync(join(folder, 'nested.png'))
	for (const name of ['p10.png', 'p2.png', 'notes.txt'])
		writeFileSync(join(folder, name), name.endsWith('.png') ? png : 'x')
	const run = await command(
		['comic', 'upload', 'chapter', '--directory', folder],
		env,
	)
	assert.equal(run.code, 0, run.stderr)
	const plan = JSON.parse(run.stderr.split('\n')[0])
	assert.equal(plan.event, 'comic-upload-plan')
	assert.deepEqual(plan.pages, [
		join(folder, 'p2.png'),
		join(folder, 'p10.png'),
	])
	assert.equal(requests.length, 3)
	for (const { upload } of requests.slice(0, 2)) {
		assert.equal(upload.purpose, 'comic-page-art')
		assert.equal(upload.targetId, 'chapter')
	}
	assert.equal(requests[2].operationName, 'LuAddComicPages')
	assert.deepEqual(requests[2].variables, {
		chapterId: 'chapter',
		pages: [{ fileId: 'file-1' }, { fileId: 'file-2' }],
	})
})

test('comic upload refuses a folder without images', async (t) => {
	const { requests, env } = await deployment(t)
	const folder = mkdtempSync(join(tmpdir(), 'lu-cli-empty-'))
	t.after(() => rmSync(folder, { force: true, recursive: true }))
	const run = await command(
		['comic', 'upload', 'chapter', '--directory', folder],
		env,
	)
	assert.equal(run.code, 1)
	assert.equal(JSON.parse(run.stderr).code, 'BAD_USER_INPUT')
	assert.equal(requests.length, 0)
})

test('comic upload validates every input before uploading anything', async (t) => {
	const { requests, env } = await deployment(t)
	const folder = mkdtempSync(join(tmpdir(), 'lu-cli-invalid-pages-'))
	t.after(() => rmSync(folder, { force: true, recursive: true }))
	const page = join(folder, 'page.png')
	await sharp({
		create: { width: 10, height: 10, channels: 3, background: '#224' },
	})
		.png()
		.toFile(page)
	const oversized = join(folder, 'oversized.png')
	writeFileSync(oversized, '')
	truncateSync(oversized, 50 * 1024 * 1024 + 1)
	const cases = [
		[page, oversized],
		[page, folder],
		Array(301).fill(page),
		[page, '--directory', folder],
	]
	for (const files of cases) {
		const run = await command(['comic', 'upload', 'chapter', ...files], env)
		assert.equal(run.code, 1, run.stderr)
		assert.equal(
			JSON.parse(run.stderr.trim().split('\n').at(-1)).code,
			'BAD_USER_INPUT',
		)
		assert.equal(
			requests.length,
			0,
			'invalid batches must not leave unattached uploads',
		)
	}
})
