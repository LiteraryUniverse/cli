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

test('CLI curation commands send the named operation with only the given values', async (t) => {
	const folder = mkdtempSync(join(tmpdir(), 'lu-cli-curation-')),
		requests = []
	const changes = join(folder, 'changes.json')
	writeFileSync(changes, '﻿{"summary":"A captain.","tags":["sea"]}')
	const server = createServer(async (req, res) => {
		let body = ''
		for await (const chunk of req) body += chunk
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
	const runs = [
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
			['entry', 'publish', 'entry'],
			'LuSetEncyclopediaEntryPublication',
			{ id: 'entry', published: true },
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
	]
	for (const [args, operationName, variables] of runs) {
		requests.length = 0
		const run = await command(args, env)
		assert.equal(run.code, 0, run.stderr)
		assert.equal(requests.length, 1)
		assert.equal(requests[0].operationName, operationName)
		assert.deepEqual(requests[0].variables, variables)
		assert.equal(JSON.parse(run.stdout).operation, operationName)
	}
})

test('CLI states each curation write before sending it and refuses contradicting options', async () => {
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
