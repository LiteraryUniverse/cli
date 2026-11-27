import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
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

test('lu assistant calls the hosted skill loaders and reports refusals', {
	timeout: 30_000,
}, async (t) => {
	const requests = []
	const server = createServer(async (req, res) => {
		let body = ''
		for await (const chunk of req) body += chunk
		if (!body) return res.end()
		const call = JSON.parse(body)
		requests.push({ url: req.url, auth: req.headers.authorization, call })
		const refused = call.params.arguments.entryName === 'Nobody'
		res.setHeader('content-type', 'application/json')
		res.end(
			JSON.stringify({
				jsonrpc: '2.0',
				id: call.id,
				result: {
					isError: refused,
					content: [
						{
							type: 'text',
							text: refused
								? 'You must be a collaborator of this universe.'
								: JSON.stringify({
										skill: call.params.arguments.skill,
										instructions: 'Check spelling.',
									}),
						},
					],
				},
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

	const writing = await command(
		['assistant', 'writing', 'story', '--skill', 'proofreading', '--chapter', 'ch1'],
		env,
	)
	assert.equal(writing.code, 0, writing.stderr)
	assert.deepEqual(JSON.parse(writing.stdout), {
		skill: 'proofreading',
		instructions: 'Check spelling.',
	})
	assert.equal(requests[0].url, '/mcp?tools=assistant')
	assert.equal(requests[0].auth, 'Bearer lu_test_fixture')
	assert.equal(requests[0].call.method, 'tools/call')
	assert.deepEqual(requests[0].call.params, {
		name: 'load-writing-skill',
		arguments: { storyId: 'story', skill: 'proofreading', chapterId: 'ch1' },
	})

	const universe = await command(
		['assistant', 'universe', 'world', '--entry', 'e1', '--chapter-offset', '24'],
		env,
	)
	assert.equal(universe.code, 0, universe.stderr)
	assert.deepEqual(requests[1].call.params, {
		name: 'load-universe-skill',
		arguments: {
			universeId: 'world',
			skill: 'discrepancies',
			entryId: 'e1',
			chapterOffset: 24,
		},
	})

	const refused = await command(
		['assistant', 'universe', 'world', '--entry-name', 'Nobody'],
		env,
	)
	assert.equal(refused.code, 1)
	assert.deepEqual(JSON.parse(refused.stderr), {
		code: 'ASSISTANT_REFUSED',
		message: 'You must be a collaborator of this universe.',
	})

	const unknown = await command(
		['assistant', 'writing', 'story', '--skill', 'grammar'],
		env,
	)
	assert.equal(unknown.code, 1)
	assert.equal(requests.length, 3)
})
