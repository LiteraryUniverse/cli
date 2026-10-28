import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../dist/main.js', import.meta.url))
const tool = `#!/usr/bin/env node
const fs = require('node:fs');
const [action, ...args] = process.argv.slice(2);
fs.appendFileSync(process.env.LU_TEST_ARGS, JSON.stringify(args) + '\\n');
const path = process.env.LU_TEST_STORE;
const records = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path)) : {};
const profile = args.at(-1);
if (action === 'store') records[profile] = fs.readFileSync(0, 'utf8').trim();
else if (!records[profile]) process.exit(1);
else if (action === 'clear') delete records[profile];
else process.stdout.write(records[profile]);
fs.writeFileSync(path, JSON.stringify(records));
`

test('CLI stores keys through stdin, binds them to a deployment and keeps them out of process arguments', {
	skip: process.platform !== 'linux',
	timeout: 30_000,
}, () => {
	const directory = mkdtempSync(join(tmpdir(), 'lu-cli-keystore-'))
	const env = {
		...process.env,
		PATH: `${directory}${delimiter}${process.env.PATH}`,
		LU_TEST_STORE: join(directory, 'store.json'),
		LU_TEST_ARGS: join(directory, 'args.jsonl'),
	}
	delete env.LU_TOKEN
	try {
		writeFileSync(join(directory, 'secret-tool'), tool, { mode: 0o700 })
		const run = (action, url, input) =>
			spawnSync(process.execPath, [cli, 'auth', action, '--url', url], {
				env,
				input,
				encoding: 'utf8',
			})
		const stored = run('store', 'https://one.example.test', 'lu_test_fixture\n')
		assert.equal(stored.status, 0, stored.stderr)
		assert.equal(JSON.parse(stored.stdout).status, 'stored')
		assert.ok(
			!readFileSync(env.LU_TEST_ARGS, 'utf8').includes('lu_test_fixture'),
		)
		const other = run('remove', 'https://two.example.test')
		assert.equal(other.status, 1)
		assert.equal(JSON.parse(other.stderr).code, 'KEYSTORE_UNAVAILABLE')
		assert.equal(run('remove', 'https://one.example.test/').status, 0)
		assert.deepEqual(JSON.parse(readFileSync(env.LU_TEST_STORE, 'utf8')), {})
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})
