import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

test('CLI creates a draft from an untouched file and publishes its exact version only on an explicit command', async (t) => {
	const folder = mkdtempSync(join(tmpdir(), 'lu-cli-lifecycle-')),
		requests = []
	const file = join(folder, 'source.json'),
		source = '\uFEFF{"type":"doc","content":[{"type":"paragraph"}]}\r\n'
	writeFileSync(file, source)
	const server = createServer(async (req, res) => {
		let body = ''
		for await (const chunk of req) body += chunk
		// Port scanners (an IDE probing new local ports) send no body; ignore them.
		if (!body) return res.end()
		const request = JSON.parse(body)
		requests.push(request)
		const result =
			request.operationName === 'LuCreateChapter'
				? { id: 'chapter', version: 'v1' }
				: {
						id: 'chapter',
						revisionId: 'revision',
						version: 'v2',
						publishedAt: request.variables.input.publishAt,
					}
		res.setHeader('content-type', 'application/json')
		res.end(JSON.stringify({ data: { result } }))
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
	const created = await command(
		[
			'create',
			'story',
			'--title',
			'New chapter',
			'--file',
			file,
			'--operation-id',
			'create-once',
		],
		env,
	)
	assert.equal(created.code, 0, created.stderr)
	assert.equal(JSON.parse(created.stdout).id, 'chapter')
	assert.equal(requests.length, 1)
	assert.equal(requests[0].operationName, 'LuCreateChapter')
	assert.equal(readFileSync(file, 'utf8'), source)
	const published = await command(
		[
			'publish',
			'chapter',
			'--expected-version',
			'v1',
			'--operation-id',
			'publish-once',
			'--at',
			'2027-01-01T12:00:00Z',
		],
		env,
	)
	assert.equal(published.code, 0, published.stderr)
	assert.equal(requests[1].operationName, 'LuPublishChapter')
	assert.equal(requests[1].variables.input.expectedVersion, 'v1')
	assert.equal(JSON.parse(published.stdout).revisionId, 'revision')
	assert.match(published.stderr, /publish-plan/)
})
