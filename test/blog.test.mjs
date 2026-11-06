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

test('CLI reads private blog documents and sends all five mutation actions without changing concurrency input', async (t) => {
	const folder = mkdtempSync(join(tmpdir(), 'lu-blog-'))
	const requests = []
	const server = createServer(async (req, res) => {
		let body = ''
		for await (const chunk of req) body += chunk
		if (!body) return res.end()
		requests.push(JSON.parse(body))
		res.setHeader('content-type', 'application/json')
		res.end(
			JSON.stringify({
				data: { result: { id: 'page', version: 'new', data: {} } },
			}),
		)
	})
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	t.after(async () => {
		await new Promise((resolve) => server.close(resolve))
		rmSync(folder, { recursive: true, force: true })
	})
	const env = {
		...process.env,
		LU_TOKEN: 'lu_test_fixture',
		LU_BASE_URL: `http://127.0.0.1:${server.address().port}`,
	}
	const pages = await command(
		['blog', 'pages', 'blog', '--first', '10', '--after', 'cursor'],
		env,
	)
	assert.equal(pages.code, 0, pages.stderr)
	assert.equal(requests[0].operationName, 'LuBlogPages')
	assert.deepEqual(requests[0].variables, {
		blogId: 'blog',
		first: 10,
		after: 'cursor',
	})
	const menus = await command(['blog', 'menus', 'blog'], env)
	assert.equal(menus.code, 0, menus.stderr)
	assert.equal(requests[1].operationName, 'LuBlogMenus')
	const file = join(folder, 'mutation.json')
	const payloads = [
		{
			action: 'savePage',
			expectedVersion: null,
			page: { title: 'Author', slug: 'author' },
		},
		{
			action: 'translatePage',
			expectedVersion: 'a'.repeat(64),
			pageId: 'page',
			language: 'cs',
			page: { title: 'Autor', slug: 'author' },
		},
		{
			action: 'publishPage',
			expectedVersion: 'b'.repeat(64),
			pageId: 'page',
			published: true,
		},
		{ action: 'saveMenu', expectedVersion: null, location: 'top', items: [] },
		{
			action: 'translateMenu',
			expectedVersion: 'c'.repeat(64),
			location: 'top',
			language: 'cs',
			entries: { authors: { label: 'Autoři' } },
		},
	]
	for (const [index, payload] of payloads.entries()) {
		const input = { ...payload, operationId: `operation-${index}` }
		writeFileSync(file, JSON.stringify(input))
		const result = await command(
			['blog', 'mutate', 'blog', '--file', file],
			env,
		)
		assert.equal(result.code, 0, result.stderr)
		assert.equal(requests.at(-1).operationName, 'LuMutateBlog')
		assert.deepEqual(requests.at(-1).variables, {
			input: { ...input, blogId: 'blog' },
		})
		assert.equal(JSON.parse(result.stdout).version, 'new')
		assert.equal(JSON.parse(result.stderr).event, 'blog-mutation-plan')
	}
	for (const data of [
		{ action: 'savePage', operationId: 'missing-version' },
		{
			blogId: 'other',
			action: 'saveMenu',
			operationId: 'wrong-blog',
			expectedVersion: null,
		},
		[],
	]) {
		writeFileSync(file, JSON.stringify(data))
		const count = requests.length
		const result = await command(
			['blog', 'mutate', 'blog', '--file', file],
			env,
		)
		assert.equal(result.code, 1)
		assert.equal(JSON.parse(result.stderr).code, 'BAD_USER_INPUT')
		assert.equal(requests.length, count)
	}

	const count = requests.length
	const invalid = await command(
		['blog', 'pages', 'blog', '--first', '101'],
		env,
	)
	assert.equal(invalid.code, 1)
	assert.equal(requests.length, count)
})
