import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../dist/main.js', import.meta.url))
const { version } = JSON.parse(
	readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)
const bump = version.replace(/\d+$/, (n) => String(Number(n) + 1))

// A stand-in npm on PATH that records its arguments and exits with FAKE_NPM_STATUS.
const bin = mkdtempSync(join(tmpdir(), 'lu-cli-update-')),
	npmLog = join(bin, 'npm.log')
writeFileSync(
	join(bin, 'npm'),
	'#!/bin/sh\necho "$@" > "$FAKE_NPM_LOG"\necho npm progress\nexit "$FAKE_NPM_STATUS"\n',
)
chmodSync(join(bin, 'npm'), 0o755)
writeFileSync(
	join(bin, 'npm.cmd'),
	'@echo %*> "%FAKE_NPM_LOG%"\r\n@echo npm progress\r\n@exit /b %FAKE_NPM_STATUS%\r\n',
)

function update(registry, args = [], status = 0) {
	rmSync(npmLog, { force: true })
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [cli, 'update', ...args], {
			env: {
				...process.env,
				npm_config_registry: registry,
				PATH: `${bin}${delimiter}${process.env.PATH}`,
				FAKE_NPM_LOG: npmLog,
				FAKE_NPM_STATUS: String(status),
			},
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
	t.after(() => {
		server.close()
		rmSync(bin, { recursive: true, force: true })
	})
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
		// Without a terminal to ask, nothing is installed unless --yes says so.
		assert.equal(existsSync(npmLog), false)
	}
	assert.equal(paths[0], '/@literary-universe/cli/latest')

	latest = bump
	const installed = await update(registry, ['--yes'])
	assert.equal(installed.code, 0, installed.stderr)
	assert.equal(JSON.parse(installed.stdout).updated, true)
	assert.match(installed.stderr, /npm progress/)
	assert.equal(
		readFileSync(npmLog, 'utf8').trim(),
		'install --global @literary-universe/cli@latest',
	)
	const refused = await update(registry, ['--yes'], 1)
	assert.equal(refused.code, 1)
	assert.equal(JSON.parse(refused.stdout).updated, false)

	latest = version
	const current = await update(registry, ['--yes'])
	assert.equal(JSON.parse(current.stdout).updated, undefined)
	assert.equal(existsSync(npmLog), false)

	latest = undefined
	const failed = await update(registry)
	assert.equal(failed.code, 1)
	assert.equal(JSON.parse(failed.stderr).code, 'UPDATE_CHECK_FAILED')
})
