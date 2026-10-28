import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../dist/main.js', import.meta.url))
function command(args, env, input = '') {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [cli, ...args], {
			env,
			stdio: 'pipe',
		})
		let stdout = '',
			stderr = ''
		child.stdout.on('data', (data) => {
			stdout += data
		})
		child.stderr.on('data', (data) => {
			stderr += data
		})
		child.once('error', reject)
		child.once('close', (code) => resolve({ code, stdout, stderr }))
		child.stdin.end(input)
	})
}
function assertNoKey(result, key) {
	assert.ok(!result.stdout.includes(key))
	assert.ok(!result.stderr.includes(key))
}
const errorCode = (result) => JSON.parse(result.stderr).code
async function nativeFixture(t) {
	const key = `lu_test_${randomUUID().replaceAll('-', '')}`
	const server = createServer((req, res) => {
		assert.equal(req.headers.authorization, `Bearer ${key}`)
		res.setHeader('Content-Type', 'application/json')
		res.end(JSON.stringify({ data: { result: { id: 'native-keyring-user' } } }))
	})
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	const baseUrl = `http://127.0.0.1:${server.address().port}/keystore-${randomUUID()}`
	const env = { ...process.env, LU_BASE_URL: baseUrl }
	delete env.LU_TOKEN
	const run = (args, input) => command(args, env, input)
	t.after(async () => {
		await run(['auth', 'remove'])
		await new Promise((resolve) => server.close(resolve))
	})
	return { key, baseUrl, run }
}

test('native OS keystore stores, loads and removes only the selected deployment key', {
	skip: process.env.LU_TEST_NATIVE_KEYSTORE !== '1',
	timeout: 60_000,
}, async (t) => {
	const { key, baseUrl, run } = await nativeFixture(t)
	const stored = await run(['auth', 'store'], `${key}\n`)
	assert.equal(stored.code, 0, stored.stderr)
	assertNoKey(stored, key)
	await assertStoredIdentity(run, baseUrl, key)
	await assertOtherDeployment(run, baseUrl)
	await assertRemoval(run, key)
})
async function assertStoredIdentity(run, baseUrl, key) {
	const identity = await run(['identity', '--url', `${baseUrl}/`])
	assert.equal(identity.code, 0, identity.stderr)
	assert.equal(JSON.parse(identity.stdout).id, 'native-keyring-user')
	assertNoKey(identity, key)
}
async function assertRemoval(run, key) {
	const removed = await run(['auth', 'remove'])
	assert.equal(removed.code, 0, removed.stderr)
	const missing = await run(['identity'])
	assert.equal(missing.code, 1)
	assert.equal(errorCode(missing), 'KEYSTORE_UNAVAILABLE')
	assertNoKey(missing, key)
}
async function assertOtherDeployment(run, baseUrl) {
	const other = await run(['identity', '--url', `${baseUrl}-other`])
	assert.equal(other.code, 1)
	assert.equal(errorCode(other), 'KEYSTORE_UNAVAILABLE')
	const original = await run(['identity'])
	assert.equal(original.code, 0, original.stderr)
}
