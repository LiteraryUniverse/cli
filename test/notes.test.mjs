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

const story = {
	concept: 'A **keeper** of a dead light.',
	settings: null,
	theme: null,
	impact: null,
	outcome: null,
	audience: null,
	audienceAgeGroup: '18to20',
	audienceSex: null,
	pitch: 'One line.\n\nAnd a second paragraph.',
	notes: null,
	version: 'a1',
}
const universe = {
	overview: 'Tides rule the coast.',
	foundation: null,
	society: null,
	conflicts: null,
	keyLocations: '- The Lamp\n- The Drowned Quay',
	storyHooks: null,
	notes: null,
	version: '3',
}

/** A server holding one story's and one universe's notes; writes merge into them. */
async function notesServer(t) {
	const folder = mkdtempSync(join(tmpdir(), 'lu-cli-notes-')),
		requests = []
	const results = {
		LuStoryNotes: () => ({ id: 'story', notes: story }),
		LuUniverseNotes: () => ({ id: 'universe', notes: universe }),
		LuUpdateStoryNotes: ({ input }) => ({ ...story, ...input, version: 'b2' }),
		LuUpdateUniverseNotes: ({ input }) => ({
			...universe,
			...input,
			version: '4',
		}),
	}
	const server = createServer(async (req, res) => {
		let body = ''
		for await (const chunk of req) body += chunk
		// Port scanners (an IDE probing new local ports) send no body; ignore them.
		if (!body) return res.end()
		const request = JSON.parse(body)
		requests.push(request)
		res.setHeader('content-type', 'application/json')
		res.end(
			JSON.stringify({
				data: { result: results[request.operationName](request.variables) },
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
	const run = async (...args) => {
		requests.length = 0
		const result = await command(args, env)
		return { ...result, request: requests[0], sent: requests.length }
	}
	return { run, file: (name) => join(folder, name) }
}

test('lu story notes and lu universe notes print the notes as Markdown', {
	timeout: 30_000,
}, async (t) => {
	const { run } = await notesServer(t)
	const read = await run('story', 'notes', 'story')
	assert.equal(read.code, 0, read.stderr)
	assert.equal(read.request.operationName, 'LuStoryNotes')
	assert.deepEqual(read.request.variables, { id: 'story' })
	assert.deepEqual(JSON.parse(read.stdout), story)
	const world = await run('universe', 'notes', 'universe')
	assert.equal(world.code, 0, world.stderr)
	assert.equal(world.request.operationName, 'LuUniverseNotes')
	assert.deepEqual(JSON.parse(world.stdout), universe)
})

test('notes update sends only the notes given, as options or from a file', {
	timeout: 30_000,
}, async (t) => {
	const { run, file } = await notesServer(t)
	const options = await run(
		'story',
		'notes',
		'update',
		'story',
		'--theme',
		'Duty *after* purpose',
		'--audience-age-group',
		'21to29',
		'--pitch',
		'',
		'--expected-version',
		'a1',
	)
	assert.equal(options.code, 0, options.stderr)
	assert.equal(options.request.operationName, 'LuUpdateStoryNotes')
	assert.deepEqual(options.request.variables, {
		storyId: 'story',
		input: {
			theme: 'Duty *after* purpose',
			audienceAgeGroup: '21to29',
			pitch: '',
		},
		expectedVersion: 'a1',
	})
	// The write is stated on stderr with the note names, not their text.
	const { deployment, ...plan } = JSON.parse(options.stderr.trim())
	assert.match(deployment, /^http:\/\/127\.0\.0\.1:/)
	assert.deepEqual(plan, {
		event: 'story-notes-update-plan',
		storyId: 'story',
		fields: ['theme', 'audienceAgeGroup', 'pitch'],
		expectedVersion: 'a1',
	})
	assert.doesNotMatch(options.stderr, /Duty/)
	assert.equal(JSON.parse(options.stdout).version, 'b2')

	writeFileSync(
		file('world.json'),
		'{"society":"Clans of the quay.","keyLocations":null}',
	)
	const fromFile = await run(
		'universe',
		'notes',
		'update',
		'universe',
		'--file',
		file('world.json'),
		'--story-hooks',
		'The lamp goes dark.',
	)
	assert.equal(fromFile.code, 0, fromFile.stderr)
	assert.equal(fromFile.request.operationName, 'LuUpdateUniverseNotes')
	assert.deepEqual(fromFile.request.variables, {
		universeId: 'universe',
		input: {
			society: 'Clans of the quay.',
			keyLocations: null,
			storyHooks: 'The lamp goes dark.',
		},
	})
})

test('the printed notes go back unchanged as a file, at the version read', {
	timeout: 30_000,
}, async (t) => {
	const { run, file } = await notesServer(t)
	for (const [noun, id, key, operation] of [
		['story', 'story', 'storyId', 'LuUpdateStoryNotes'],
		['universe', 'universe', 'universeId', 'LuUpdateUniverseNotes'],
	]) {
		const read = await run(noun, 'notes', id)
		writeFileSync(file(`${noun}.json`), read.stdout)
		const { version, ...notes } = JSON.parse(read.stdout)
		const write = await run(
			noun,
			'notes',
			'update',
			id,
			'--file',
			file(`${noun}.json`),
		)
		assert.equal(write.code, 0, write.stderr)
		assert.equal(write.request.operationName, operation)
		// Every note as read, multi-line Markdown included, and its version.
		assert.deepEqual(write.request.variables, {
			[key]: id,
			input: notes,
			expectedVersion: version,
		})
		// The option wins over the file's version.
		const pinned = await run(
			noun,
			'notes',
			'update',
			id,
			'--file',
			file(`${noun}.json`),
			'--expected-version',
			'9',
		)
		assert.equal(pinned.request.variables.expectedVersion, '9')
	}
})

test('notes update refuses an unknown note and an empty change before sending', {
	timeout: 30_000,
}, async (t) => {
	const { run, file } = await notesServer(t)
	writeFileSync(file('typo.json'), '{"plot":"A twist."}')
	const typo = await run(
		'story',
		'notes',
		'update',
		'story',
		'--file',
		file('typo.json'),
	)
	assert.equal(typo.code, 1)
	assert.equal(typo.sent, 0)
	assert.match(JSON.parse(typo.stderr).message, /Unknown note plot/)
	// A universe has no concept note; the story option is not sent to it.
	const wrong = await run(
		'universe',
		'notes',
		'update',
		'universe',
		'--concept',
		'x',
	)
	assert.equal(wrong.code, 1)
	assert.equal(wrong.sent, 0)
	const mixed = await run(
		'universe',
		'notes',
		'update',
		'universe',
		'--overview',
		'y',
		'--concept',
		'x',
	)
	assert.equal(mixed.code, 1)
	assert.equal(mixed.sent, 0)
	assert.match(JSON.parse(mixed.stderr).message, /Unknown note concept/)
	// A Markdown list starts with a dash, which only `--option=value` can carry.
	const list = await run(
		'universe',
		'notes',
		'update',
		'universe',
		'--key-locations',
		'- The Lamp',
	)
	assert.equal(list.code, 1)
	assert.equal(list.sent, 0)
	assert.match(JSON.parse(list.stderr).message, /use '--key-locations=-XYZ'/)
	const dashed = await run(
		'universe',
		'notes',
		'update',
		'universe',
		'--key-locations=- The Lamp\n- The Quay',
	)
	assert.equal(dashed.code, 0, dashed.stderr)
	assert.deepEqual(dashed.request.variables.input, {
		keyLocations: '- The Lamp\n- The Quay',
	})
	const empty = await run('story', 'notes', 'update', 'story')
	assert.equal(empty.code, 1)
	assert.equal(empty.sent, 0)
	assert.match(JSON.parse(empty.stderr).message, /at least one note/)
})
