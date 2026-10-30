import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from 'node:http'
import { LiteraryUniverseApiError } from '@literary-universe/sdk'

export type Session = {
	clientId: string
	accessToken: string
	accessExpiresAt: string
	refreshToken: string
}
type Metadata = {
	authorization_endpoint: string
	token_endpoint: string
	registration_endpoint: string
	revocation_endpoint: string
}
type TokenResponse = {
	access_token: string
	expires_in: number
	refresh_token: string
}
const LOGIN_TIMEOUT_MS = 5 * 60_000
const base64url = (bytes: Buffer) => bytes.toString('base64url')
const canonical = (baseUrl: string) => {
	const url = new URL(baseUrl)
	return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

function oauthError(status: number, json: Record<string, string>) {
	return new LiteraryUniverseApiError(
		(json.error ?? 'OAUTH_ERROR').toUpperCase(),
		json.error_description ?? 'The deployment refused the OAuth request',
		undefined,
		status,
	)
}

async function oauthFetch<T>(
	url: string,
	body: Record<string, string | string[]>,
	signal?: AbortSignal,
) {
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
		signal,
	})
	const json = await response.json().catch(() => ({}))
	if (!response.ok) throw oauthError(response.status, json)
	return json as T
}

export async function discover(baseUrl: string, signal?: AbortSignal) {
	const response = await fetch(
		`${canonical(baseUrl)}/.well-known/oauth-authorization-server`,
		{ signal },
	)
	if (!response.ok)
		throw new LiteraryUniverseApiError(
			'OAUTH_UNAVAILABLE',
			'This deployment does not offer browser sign-in; store an API key with lu auth store',
		)
	return (await response.json()) as Metadata
}

const session = (clientId: string, token: TokenResponse): Session => ({
	clientId,
	accessToken: token.access_token,
	accessExpiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
	refreshToken: token.refresh_token,
})

export async function refreshSession(
	baseUrl: string,
	current: Session,
	signal?: AbortSignal,
) {
	const metadata = await discover(baseUrl, signal)
	const token = await oauthFetch<TokenResponse>(
		metadata.token_endpoint,
		{
			grant_type: 'refresh_token',
			refresh_token: current.refreshToken,
			client_id: current.clientId,
		},
		signal,
	)
	return session(current.clientId, token)
}

export async function revokeSession(baseUrl: string, current: Session) {
	const metadata = await discover(baseUrl)
	await oauthFetch(metadata.revocation_endpoint, {
		token: current.refreshToken,
		token_type_hint: 'refresh_token',
		client_id: current.clientId,
	})
}

const page =
	'<!doctype html><title>Literary Universe</title><p>Signed in. You can close this window.</p>'
type Callback = {
	resolve: (code: string) => void
	reject: (error: Error) => void
}
/** Answers the browser's redirect; a wrong state or path is ignored. */
function callbackHandler(state: string, { resolve, reject }: Callback) {
	return (request: IncomingMessage, response: ServerResponse) => {
		const url = new URL(request.url ?? '/', 'http://127.0.0.1')
		if (url.pathname !== '/callback' || url.searchParams.get('state') !== state)
			return response.writeHead(404).end()
		response.writeHead(200, { 'Content-Type': 'text/html' }).end(page)
		const code = url.searchParams.get('code')
		if (code) return resolve(code)
		reject(
			new LiteraryUniverseApiError(
				(url.searchParams.get('error') ?? 'ACCESS_DENIED').toUpperCase(),
				url.searchParams.get('error_description') ?? 'Sign-in was denied',
			),
		)
	}
}

/** Binds the loopback redirect first so the registered URI carries the real port (RFC 8252 §7.3). */
function listen(state: string) {
	const server = createServer()
	let timer: ReturnType<typeof setTimeout>
	const code = new Promise<string>((resolve, reject) => {
		timer = setTimeout(
			() =>
				reject(new LiteraryUniverseApiError('TIMEOUT', 'Sign-in timed out')),
			LOGIN_TIMEOUT_MS,
		)
		const settle = (value: string | Error) => {
			clearTimeout(timer)
			return value instanceof Error ? reject(value) : resolve(value)
		}
		server.on(
			'request',
			callbackHandler(state, { resolve: settle, reject: settle }),
		)
	})
	code.catch(() => {})
	const port = new Promise<number>((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', () => {
			const address = server.address()
			resolve(typeof address === 'object' && address ? address.port : 0)
		})
	})
	return {
		code,
		port,
		close: () => {
			clearTimeout(timer)
			server.close()
		},
	}
}

function openBrowser(url: string) {
	const custom = process.env.LU_BROWSER ?? process.env.BROWSER
	const command: string[] = custom
		? [custom, url]
		: process.platform === 'win32'
			? ['cmd', '/c', 'start', '', url]
			: process.platform === 'darwin'
				? ['open', url]
				: ['xdg-open', url]
	process.stderr.write(`Open this URL to sign in:\n${url}\n`)
	spawn(command[0], command.slice(1), { stdio: 'ignore', detached: true })
		.on('error', () => {})
		.unref()
}

async function register(metadata: Metadata, redirectUri: string) {
	const client = await oauthFetch<{ client_id: string }>(
		metadata.registration_endpoint,
		{ client_name: 'Literary Universe CLI', redirect_uris: [redirectUri] },
	)
	return client.client_id
}

function authorizeUrl(
	metadata: Metadata,
	params: {
		clientId: string
		redirectUri: string
		state: string
		verifier: string
	},
) {
	const url = new URL(metadata.authorization_endpoint)
	url.search = new URLSearchParams({
		response_type: 'code',
		client_id: params.clientId,
		redirect_uri: params.redirectUri,
		state: params.state,
		code_challenge: base64url(
			createHash('sha256').update(params.verifier).digest(),
		),
		code_challenge_method: 'S256',
	}).toString()
	return url.href
}

export async function login(baseUrl: string): Promise<Session> {
	const metadata = await discover(baseUrl)
	const state = base64url(randomBytes(16))
	const verifier = base64url(randomBytes(32))
	const callback = listen(state)
	try {
		const redirectUri = `http://127.0.0.1:${await callback.port}/callback`
		const clientId = await register(metadata, redirectUri)
		openBrowser(
			authorizeUrl(metadata, { clientId, redirectUri, state, verifier }),
		)
		const token = await oauthFetch<TokenResponse>(metadata.token_endpoint, {
			grant_type: 'authorization_code',
			code: await callback.code,
			client_id: clientId,
			redirect_uri: redirectUri,
			code_verifier: verifier,
		})
		return session(clientId, token)
	} finally {
		callback.close()
	}
}
