import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../dist/main.js', import.meta.url))
const { version } = JSON.parse(
	readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)
const bump = version.replace(/\d+$/, (n) => String(Number(n) + 1))

function update(registry) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [cli, 'update'], {
			env: { ...process.env, npm_config_registry: registry },
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

test('lu update compares the installed version with the npm latest tag', async (t) => {
	let latest
	const paths = []
	const server = createServer((req, res) => {
		paths.push(req.url)
		if (!latest) return res.writeHead(503).end()
		res.setHeader('content-type', 'application/json')
		res.end(JSON.stringify({ name: '@literary-universe/cli', version: latest }))
	})
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	t.after(() => server.close())
	const registry = `http://127.0.0.1:${server.address().port}/`

	for (const [published, updateAvailable] of [
		[version, false],
		[bump, true],
		['0.0.1', false],
		[`${version}-beta.1`, false],
	]) {
		latest = published
		const result = await update(registry)
		assert.equal(result.code, 0, result.stderr)
		assert.deepEqual(JSON.parse(result.stdout), {
			current: version,
			latest: published,
			updateAvailable,
			...(updateAvailable && {
				command: 'npm install --global @literary-universe/cli@latest',
			}),
		})
	}
	assert.equal(paths[0], '/@literary-universe/cli/latest')

	latest = undefined
	const failed = await update(registry)
	assert.equal(failed.code, 1)
	assert.equal(JSON.parse(failed.stderr).code, 'UPDATE_CHECK_FAILED')
})
