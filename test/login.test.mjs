import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../dist/main.js', import.meta.url))
const keyringTool = `#!/usr/bin/env node
const fs = require('node:fs');
const [action, ...args] = process.argv.slice(2);
const path = process.env.LU_TEST_STORE;
const records = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path)) : {};
const profile = args.at(-1);
if (action === 'store') records[profile] = fs.readFileSync(0, 'utf8').trim();
else if (!records[profile]) process.exit(1);
else if (action === 'clear') delete records[profile];
else process.stdout.write(records[profile]);
fs.writeFileSync(path, JSON.stringify(records));
`
// Stands in for the system browser: first knocks on the callback with a forged
// state (which must be ignored), then visits the authorization URL and follows
// the redirect back to the CLI's loopback callback.
const browser = `#!/usr/bin/env node
const fs = require('node:fs');
const url = new URL(process.argv[2]);
const forged = new URL(url.searchParams.get('redirect_uri'));
forged.searchParams.set('code', 'forged');
forged.searchParams.set('state', 'wrong');
fetch(forged)
	.then((r) => fs.writeFileSync(process.env.LU_TEST_FORGED, String(r.status)))
	.then(() => fetch(url))
	.then((r) => r.text())
	.then((t) => fs.writeFileSync(process.env.LU_TEST_PAGE, t));
`
function command(args, env) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [cli, ...args], {
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
			timeout: 20_000,
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
const sha256 = (value) => createHash('sha256').update(value).digest('base64url')

function oauthServer(state) {
	return createServer(async (req, res) => {
		let body = ''
		for await (const chunk of req) body += chunk
		const url = new URL(req.url, 'http://127.0.0.1')
		const json = (status, value) => {
			res.writeHead(status, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify(value))
		}
		const origin = `http://127.0.0.1:${state.port}`
		if (url.pathname === '/.well-known/oauth-authorization-server')
			return json(200, {
				issuer: origin,
				authorization_endpoint: `${origin}/oauth/authorize`,
				token_endpoint: `${origin}/oauth/token`,
				registration_endpoint: `${origin}/oauth/register`,
				revocation_endpoint: `${origin}/oauth/revoke`,
			})
		if (url.pathname === '/oauth/register') {
			state.registration = JSON.parse(body)
			return json(201, { client_id: 'client-1', ...state.registration })
		}
		if (url.pathname === '/oauth/authorize') {
			state.authorize = Object.fromEntries(url.searchParams)
			const back = new URL(state.authorize.redirect_uri)
			back.searchParams.set('code', 'code-1')
			back.searchParams.set('state', state.authorize.state)
			res.writeHead(302, { Location: back.href })
			return res.end()
		}
		if (url.pathname === '/oauth/token')
			return token(state, JSON.parse(body), json)
		if (url.pathname === '/oauth/revoke') {
			state.revoked.push(JSON.parse(body))
			return json(200, {})
		}
		if (url.pathname === '/graphql') {
			state.bearers.push(req.headers.authorization)
			return json(200, { data: { result: { id: 'user-1' } } })
		}
		json(404, {})
	})
}

function token(state, body, json) {
	const grant = () => {
		state.tokens++
		state.refreshToken = `lur_${state.tokens}`
		return {
			access_token: `lu_test_access${state.tokens}`,
			token_type: 'Bearer',
			expires_in: 86400,
			refresh_token: state.refreshToken,
		}
	}
	if (body.grant_type === 'authorization_code') {
		if (
			body.code !== 'code-1' ||
			body.client_id !== 'client-1' ||
			body.redirect_uri !== state.authorize.redirect_uri ||
			sha256(body.code_verifier) !== state.authorize.code_challenge
		)
			return json(400, { error: 'invalid_grant', error_description: 'PKCE' })
		return json(200, grant())
	}
	if (body.grant_type === 'refresh_token') {
		state.refreshes.push(body.refresh_token)
		if (
			body.refresh_token !== state.refreshToken ||
			body.client_id !== 'client-1'
		)
			return json(400, { error: 'invalid_grant', error_description: 'Reused' })
		return json(200, grant())
	}
	json(400, { error: 'unsupported_grant_type' })
}

async function fixture(t) {
	const directory = mkdtempSync(join(tmpdir(), 'lu-cli-login-'))
	const state = { tokens: 0, refreshes: [], revoked: [], bearers: [] }
	const server = oauthServer(state)
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	state.port = server.address().port
	writeFileSync(join(directory, 'secret-tool'), keyringTool, { mode: 0o700 })
	writeFileSync(join(directory, 'browser.js'), browser, { mode: 0o700 })
	const env = {
		...process.env,
		PATH: `${directory}${delimiter}${process.env.PATH}`,
		LU_TEST_STORE: join(directory, 'store.json'),
		LU_BROWSER: join(directory, 'browser.js'),
		LU_TEST_FORGED: join(directory, 'forged.txt'),
		LU_TEST_PAGE: join(directory, 'page.html'),
		LU_BASE_URL: `http://127.0.0.1:${state.port}`,
	}
	delete env.LU_TOKEN
	t.after(async () => {
		await new Promise((resolve) => server.close(resolve))
		rmSync(directory, { recursive: true, force: true })
	})
	const run = (...args) => command(args, env)
	const stored = () =>
		Object.values(JSON.parse(readFileSync(env.LU_TEST_STORE, 'utf8')))
	const setSession = (session) => {
		const [profile] = Object.keys(
			JSON.parse(readFileSync(env.LU_TEST_STORE, 'utf8')),
		)
		writeFileSync(
			env.LU_TEST_STORE,
			JSON.stringify({ [profile]: JSON.stringify(session) }),
		)
	}
	const read = (name) => readFileSync(env[name], 'utf8')
	return { run, state, stored, setSession, read }
}

test('lu login registers the runtime loopback URL, proves PKCE and stores a session; refresh rotates; logout revokes', {
	skip: process.platform !== 'linux',
	timeout: 60_000,
}, async (t) => {
	const { run, state, stored, setSession, read } = await fixture(t)
	const login = await run('login')
	assert.equal(login.code, 0, login.stderr)
	assert.equal(JSON.parse(login.stdout).status, 'logged-in')
	assert.equal(read('LU_TEST_FORGED'), '404')
	assert.match(read('LU_TEST_PAGE'), /close this window/)
	assert.match(login.stderr, /Open this URL to sign in:\nhttp:\/\/127\.0\.0\.1/)
	assert.match(
		state.registration.redirect_uris[0],
		/^http:\/\/127\.0\.0\.1:\d+\/callback$/,
	)
	assert.equal(state.registration.client_name, 'Literary Universe CLI')
	assert.equal(state.authorize.code_challenge_method, 'S256')
	const [session] = stored().map((value) => JSON.parse(value))
	assert.deepEqual(Object.keys(session).sort(), [
		'accessExpiresAt',
		'accessToken',
		'clientId',
		'refreshToken',
	])
	assert.equal(session.accessToken, 'lu_test_access1')
	assert.ok(!login.stdout.includes('lu_test_access1'))

	const identity = await run('identity')
	assert.equal(identity.code, 0, identity.stderr)
	assert.equal(state.bearers.at(-1), 'Bearer lu_test_access1')
	assert.equal(state.refreshes.length, 0)

	setSession({
		...session,
		accessExpiresAt: new Date(Date.now() + 60_000).toISOString(),
	})
	const refreshed = await run('identity')
	assert.equal(refreshed.code, 0, refreshed.stderr)
	assert.deepEqual(state.refreshes, ['lur_1'])
	assert.equal(state.bearers.at(-1), 'Bearer lu_test_access2')
	assert.equal(JSON.parse(stored()[0]).refreshToken, 'lur_2')

	setSession({ ...session, accessExpiresAt: new Date().toISOString() })
	const reused = await run('identity')
	assert.equal(reused.code, 1)
	assert.equal(
		JSON.parse(reused.stderr.trim().split('\n').at(-1)).code,
		'INVALID_GRANT',
	)

	setSession(JSON.parse(stored()[0]))
	const logout = await run('logout')
	assert.equal(logout.code, 0, logout.stderr)
	assert.deepEqual(state.revoked, [
		{ token: 'lur_1', token_type_hint: 'refresh_token', client_id: 'client-1' },
	])
	assert.deepEqual(stored(), [])
})
