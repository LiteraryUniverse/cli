import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { IMAGE_POLICY } from '@literary-universe/sdk'
import sharp from 'sharp'

const cli = fileURLToPath(new URL('../dist/main.js', import.meta.url))
test('CLI prepares local images without a key and refuses to replace originals or existing output', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'lu CLI Ω & images-'))
	try {
		const source = join(directory, 'original.png'),
			output = join(directory, 'prepared.webp')
		const bytes = await sharp({
			create: { width: 30, height: 30, channels: 4, background: '#12345650' },
		})
			.png()
			.toBuffer()
		writeFileSync(source, bytes)
		const policy = join(directory, 'Windows policy.json')
		writeFileSync(
			policy,
			`\uFEFF${JSON.stringify(IMAGE_POLICY, null, 2).replaceAll('\n', '\r\n')}`,
		)
		const args = [
			cli,
			'image',
			'prepare',
			'--file',
			source,
			'--purpose',
			'universe-cover',
			'--policy-file',
			policy,
			'--output',
			output,
			'--format',
			'webp',
		]
		const env = { ...process.env, LU_TOKEN: '' }
		const run = spawnSync(process.execPath, args, { encoding: 'utf8', env })
		assert.equal(run.status, 0, run.stderr)
		assert.equal(JSON.parse(run.stdout).policyVersion, '1')
		assert.equal((await sharp(output).metadata()).hasAlpha, true)
		const again = spawnSync(process.execPath, args, { encoding: 'utf8', env })
		assert.equal(again.status, 1)
		const original = spawnSync(
			process.execPath,
			[...args.slice(0, -3), source, '--format', 'webp'],
			{ encoding: 'utf8', env },
		)
		assert.equal(original.status, 1)
		assert.deepEqual(readFileSync(source), bytes)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})

test('CLI sets a story cover through the cover route', async (t) => {
	const directory = mkdtempSync(join(tmpdir(), 'lu CLI cover-'))
	const requests = []
	const server = createServer(async (req, res) => {
		let size = 0
		for await (const chunk of req) size += chunk.length
		requests.push({ method: req.method, url: req.url, type: req.headers['content-type'], size })
		res.setHeader('Content-Type', 'application/json')
		res.end(JSON.stringify({ cover: { url: 'https://cdn.test/c.webp', handle: 'h', size } }))
	})
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	t.after(async () => {
		await new Promise((resolve) => server.close(resolve))
		rmSync(directory, { recursive: true, force: true })
	})
	const file = join(directory, 'cover.png')
	const bytes = await sharp({
		create: { width: 20, height: 30, channels: 3, background: '#123456' },
	})
		.png()
		.toBuffer()
	writeFileSync(file, bytes)
	const env = {
		...process.env,
		LU_TOKEN: 'lu_test_fixture',
		LU_BASE_URL: `http://127.0.0.1:${server.address().port}`,
	}
	const child = spawn(process.execPath, [cli, 'image', 'cover', 'story', 'story-1', '--file', file], { env })
	let stdout = ''
	child.stdout.on('data', (data) => {
		stdout += data
	})
	const code = await new Promise((resolve) => child.on('close', resolve))
	assert.equal(code, 0)
	assert.equal(JSON.parse(stdout).handle, 'h')
	assert.deepEqual(requests, [
		{ method: 'PUT', url: '/api/stories/story-1/cover', type: 'image/png', size: bytes.length },
	])
})
