import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

/** A server answering each operation with its name, and the input files. */
async function curationServer(t) {
	const folder = mkdtempSync(join(tmpdir(), 'lu-cli-curation-')),
		requests = []
	const changes = join(folder, 'changes.json')
	writeFileSync(changes, '﻿{"summary":"A captain.","tags":["sea"]}')
	const translation = join(folder, 'translation.json')
	writeFileSync(translation, '{"name":"Kapitán Nemo"}')
	const doc = join(folder, 'doc.json')
	writeFileSync(doc, '{"type":"doc","content":[{"type":"paragraph"}]}')
	const server = createServer(async (req, res) => {
		let body = ''
		for await (const chunk of req) body += chunk
		// Port scanners (an IDE probing new local ports) send no body; ignore them.
		if (!body) return res.end()
		const request = JSON.parse(body)
		requests.push(request)
		res.setHeader('content-type', 'application/json')
		res.end(
			JSON.stringify({
				data: { result: { operation: request.operationName } },
			}),
		)
	})
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	t.after(async () => {
		await new Promise((resolve) => server.close(resolve))
		rmSync(folder, { force: true, recursive: true })
	})
	const env = {
		...process.env,
		LU_TOKEN: 'lu_test_fixture',
		LU_BASE_URL: `http://127.0.0.1:${server.address().port}`,
	}
	return { env, requests, changes, translation, doc }
}

async function expectOperations({ env, requests }, runs) {
	for (const [args, operationName, variables] of runs) {
		requests.length = 0
		const run = await command(args, env)
		assert.equal(run.code, 0, run.stderr)
		assert.equal(requests.length, 1)
		assert.equal(requests[0].operationName, operationName)
		assert.deepEqual(requests[0].variables, variables)
		assert.equal(JSON.parse(run.stdout).operation, operationName)
	}
}

test('CLI curation commands send the named operation with only the given values', {
	timeout: 30_000,
}, async (t) => {
	const server = await curationServer(t)
	const { changes } = server
	await expectOperations(server, [
		[['story', 'creation-options'], 'LuStoryCreationOptions', {}],
		// Listings name an organization or universe only when asked to.
		[['stories'], 'LuStories', {}],
		[
			['stories', '--universe', 'world', '--first', '100', '--after', 'cursor'],
			'LuStories',
			{ first: 100, after: 'cursor', universeId: 'world' },
		],
		[
			['universes', '--organization', 'press'],
			'LuUniverses',
			{ organizationId: 'press' },
		],
		[
			[
				'story',
				'create',
				'--title',
				'Voyages',
				'--slug',
				'voyages',
				'--description',
				'At sea.',
				'--language',
				'en',
				'--genres',
				'fantasy, adventure',
				'--rating',
				'universal',
				'--license',
				'cc-by',
			],
			'LuCreateStory',
			{
				input: {
					title: 'Voyages',
					slug: 'voyages',
					description: 'At sea.',
					language: 'en',
					genres: ['fantasy', 'adventure'],
					rating: 'universal',
					license: 'cc-by',
					isAIGenerated: false,
				},
			},
		],
		[
			[
				'story',
				'create',
				'--title',
				'Voyages',
				'--slug',
				'voyages',
				'--description',
				'At sea.',
				'--language',
				'en',
				'--genres',
				'fantasy',
				'--rating',
				'universal',
				'--license',
				'cc-by',
				'--ai-generated',
				'--ai-model',
				'model',
				'--universe',
				'universe',
			],
			'LuCreateStory',
			{
				input: {
					title: 'Voyages',
					slug: 'voyages',
					description: 'At sea.',
					language: 'en',
					genres: ['fantasy'],
					rating: 'universal',
					license: 'cc-by',
					isAIGenerated: true,
					aiModel: 'model',
					universeId: 'universe',
				},
			},
		],
		[
			['story', 'update', 'story', '--license', 'cc-by-sa', '--tags', 'a, b'],
			'LuUpdateStory',
			{ storyId: 'story', input: { license: 'cc-by-sa', tags: ['a', 'b'] } },
		],
		[
			['story', 'update', 'story', '--standalone'],
			'LuUpdateStory',
			{ storyId: 'story', input: { universeId: null } },
		],
		[
			['story', 'hide', 'story'],
			'LuSetStoryVisibility',
			{ storyId: 'story', visibility: 'PRIVATE' },
		],
		[
			['chapter', 'reorder', 'story', '--chapters', 'c,a,b'],
			'LuReorderChapters',
			{ input: { storyId: 'story', chapterIds: ['c', 'a', 'b'] } },
		],
		[
			['chapter', 'remove', 'chapter'],
			'LuRemoveChapter',
			{ input: { id: 'chapter' } },
		],
		[
			['universe', 'update', 'universe', '--slug', 'mythes'],
			'LuUpdateUniverse',
			{ universeId: 'universe', input: { slug: 'mythes' } },
		],
		[
			['entry', 'update', 'entry', '--file', changes],
			'LuUpdateEncyclopediaEntry',
			{ id: 'entry', changes: { summary: 'A captain.', tags: ['sea'] } },
		],
		[
			[
				'series',
				'save',
				'universe',
				'--title',
				'Voyages',
				'--stories',
				's1,s2',
				'--expected-version',
				'0',
			],
			'LuSaveSeries',
			{
				input: {
					universeId: 'universe',
					expectedVersion: 0,
					title: 'Voyages',
					storyIds: ['s1', 's2'],
				},
			},
		],
		[['series', 'universe'], 'LuSeries', { universeId: 'universe' }],
		[['story', 'story'], 'LuStory', { id: 'story' }],
	])
})

// A test of its own: Bun stops a test after five seconds.
test('CLI sends AI disclosure, expected versions, universe creation and entry releases', {
	timeout: 30_000,
}, async (t) => {
	const server = await curationServer(t)
	const { changes, translation, doc } = server
	await expectOperations(server, [
		[
			[
				'entry',
				'publish',
				'entry',
				'--audience',
				'beta',
				'--language',
				'cs',
				'--at',
				'2027-01-01T12:00:00+01:00',
				'--expected-version',
				'ev3',
				'--operation-id',
				'release-1',
			],
			'LuPublishEncyclopediaEntry',
			{
				input: {
					id: 'entry',
					language: 'cs',
					publishAt: '2027-01-01T12:00:00+01:00',
					audience: 'BETA',
					expectedVersion: 'ev3',
					operationId: 'release-1',
				},
			},
		],
		[
			['entry', 'unpublish', 'entry'],
			'LuSetEncyclopediaEntryPublication',
			{ id: 'entry', published: false },
		],
		[
			[
				'entry',
				'update',
				'entry',
				'--file',
				changes,
				'--ai-model',
				'claude-opus-5-5',
				'--expected-version',
				'ev2',
			],
			'LuUpdateEncyclopediaEntry',
			{
				id: 'entry',
				changes: {
					summary: 'A captain.',
					tags: ['sea'],
					aiModel: 'claude-opus-5-5',
				},
				expectedVersion: 'ev2',
			},
		],
		[
			['entry', 'create', 'universe', '--file', changes, '--ai-model', 'm'],
			'LuCreateEncyclopediaEntry',
			{
				input: {
					summary: 'A captain.',
					tags: ['sea'],
					aiModel: 'm',
					universeId: 'universe',
				},
			},
		],
		[
			[
				'entry',
				'translate',
				'entry',
				'--language',
				'cs',
				'--file',
				translation,
				'--expected-version',
				'cv1',
			],
			'LuTranslateEncyclopediaEntry',
			{
				input: {
					name: 'Kapitán Nemo',
					expectedVersion: 'cv1',
					id: 'entry',
					language: 'cs',
				},
			},
		],
		[
			[
				'universe',
				'create',
				'--title',
				'Deep Sea',
				'--slug',
				'deep-sea',
				'--genre',
				'fantasy',
				'--rating',
				'teen',
				'--license',
				'cc-by',
				'--language',
				'en',
				'--description',
				'An ocean world.',
				'--ai-model',
				'm',
			],
			'LuCreateUniverse',
			{
				input: {
					title: 'Deep Sea',
					slug: 'deep-sea',
					genre: 'fantasy',
					rating: 'teen',
					license: 'cc-by',
					language: 'en',
					description: 'An ocean world.',
					aiModel: 'm',
				},
			},
		],
		[
			[
				'universe',
				'update',
				'universe',
				'--description',
				'An ocean.',
				'--ai-model',
				'm',
				'--expected-version',
				'uv1',
			],
			'LuUpdateUniverse',
			{
				universeId: 'universe',
				input: { description: 'An ocean.', aiModel: 'm' },
				expectedVersion: 'uv1',
			},
		],
		[
			[
				'story',
				'update',
				'story',
				'--title',
				'Voyages',
				'--ai-model',
				'm',
				'--expected-version',
				'sv1',
			],
			'LuUpdateStory',
			{
				storyId: 'story',
				input: { title: 'Voyages', aiModel: 'm' },
				expectedVersion: 'sv1',
			},
		],
		[
			['create', 'story', '--operation-id', 'op', '--ai-model', 'm'],
			'LuCreateChapter',
			{ input: { storyId: 'story', operationId: 'op', aiModel: 'm' } },
		],
		[
			[
				'save',
				'chapter',
				'--file',
				doc,
				'--expected-version',
				'v1',
				'--operation-id',
				'op',
				'--ai-model',
				'm',
			],
			'LuSaveDraft',
			{
				input: {
					id: 'chapter',
					expectedVersion: 'v1',
					operationId: 'op',
					content: { type: 'doc', content: [{ type: 'paragraph' }] },
					aiModel: 'm',
				},
			},
		],
	])
})

test('CLI states each curation write before sending it and refuses contradicting options', {
	timeout: 30_000,
}, async () => {
	const env = {
		...process.env,
		LU_TOKEN: 'lu_test_fixture',
		LU_BASE_URL: 'http://127.0.0.1:9',
	}
	const removal = await command(['chapter', 'remove', 'chapter'], env)
	assert.equal(removal.code, 1)
	assert.deepEqual(JSON.parse(removal.stderr.split('\n')[0]), {
		event: 'chapter-remove-plan',
		deployment: 'http://127.0.0.1:9',
		id: 'chapter',
	})
	const both = await command(
		['story', 'update', 'story', '--universe', 'u', '--standalone'],
		env,
	)
	assert.equal(both.code, 1)
	assert.equal(JSON.parse(both.stderr).code, 'BAD_USER_INPUT')
})

test('story creation refuses missing metadata and undisclosed AI models locally', {
	timeout: 30_000,
}, async () => {
	const env = {
		...process.env,
		LU_TOKEN: 'lu_test_fixture',
		LU_BASE_URL: 'http://127.0.0.1:9',
	}
	for (const args of [
		['story', 'create'],
		['story', 'create', '--ai-generated'],
		['story', 'create', '--ai-generated', '--ai-model', '  '],
		['story', 'create', '--genres', ', '],
	]) {
		const run = await command(args, env)
		assert.equal(run.code, 1)
		assert.equal(JSON.parse(run.stderr).code, 'BAD_USER_INPUT')
		assert.equal(run.stdout, '')
	}
})

test('entry publish reads the edition version when none is given and checks --at', {
	timeout: 30_000,
}, async (t) => {
	const requests = []
	const server = createServer(async (req, res) => {
		let body = ''
		for await (const chunk of req) body += chunk
		if (!body) return res.end()
		const request = JSON.parse(body)
		requests.push(request)
		res.setHeader('content-type', 'application/json')
		const result =
			request.operationName === 'LuEncyclopediaEntry'
				? {
						id: 'entry',
						language: 'en',
						editions: [
							{ language: 'en', version: 'ev1' },
							{ language: 'cs', version: 'cv7' },
						],
					}
				: { operation: request.operationName }
		res.end(JSON.stringify({ data: { result } }))
	})
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	t.after(() => new Promise((resolve) => server.close(resolve)))
	const env = {
		...process.env,
		LU_TOKEN: 'lu_test_fixture',
		LU_BASE_URL: `http://127.0.0.1:${server.address().port}`,
	}
	const run = await command(
		['entry', 'publish', 'entry', '--language', 'cs'],
		env,
	)
	assert.equal(run.code, 0, run.stderr)
	assert.deepEqual(
		requests.map((request) => request.operationName),
		['LuEncyclopediaEntry', 'LuPublishEncyclopediaEntry'],
	)
	const { input } = requests[1].variables
	assert.equal(input.expectedVersion, 'cv7')
	assert.equal(input.audience, 'READERS')
	assert.match(input.operationId, /^[0-9a-f-]{36}$/)
	const plan = JSON.parse(run.stderr.split('\n')[0])
	assert.equal(plan.event, 'entry-publish-plan')
	assert.equal(plan.operationId, input.operationId)
	assert.match(plan.note, /current version, read just now/)

	requests.length = 0
	for (const args of [
		['entry', 'publish', 'entry', '--at', '2027-01-01T12:00:00'],
		['entry', 'publish', 'entry', '--audience', 'everyone'],
	]) {
		const refused = await command(args, env)
		assert.equal(refused.code, 1)
		assert.equal(JSON.parse(refused.stderr).code, 'BAD_USER_INPUT')
	}
	assert.equal(requests.length, 0)
})

test('story and universe creation do not retry an ambiguous server failure', {
	timeout: 30_000,
}, async (t) => {
	let requests = 0
	const server = createServer(async (req, res) => {
		let body = ''
		for await (const chunk of req) body += chunk
		if (!body) return res.end()
		requests++
		res.writeHead(503, { 'content-type': 'application/json' })
		res.end(
			JSON.stringify({
				errors: [
					{
						message: 'Unavailable',
						extensions: { code: 'SERVICE_UNAVAILABLE' },
					},
				],
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
	const universe = await command(
		[
			'universe',
			'create',
			'--title',
			'Deep Sea',
			'--slug',
			'deep-sea',
			'--genre',
			'fantasy',
			'--rating',
			'teen',
			'--license',
			'cc-by',
			'--language',
			'en',
			'--description',
			'An ocean world.',
		],
		env,
	)
	assert.equal(universe.code, 1)
	assert.equal(requests, 1)
	assert.equal(
		JSON.parse(universe.stderr.split('\n')[0]).event,
		'universe-create-plan',
	)
	requests = 0
	const run = await command(
		[
			'story',
			'create',
			'--title',
			'Voyages',
			'--slug',
			'voyages',
			'--description',
			'At sea.',
			'--language',
			'en',
			'--genres',
			'fantasy',
			'--rating',
			'universal',
			'--license',
			'cc-by',
		],
		env,
	)
	assert.equal(run.code, 1)
	assert.equal(requests, 1)
})
