import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { runNpm } from './npm.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
function installedCli(folder, args) {
	return spawnSync(
		process.execPath,
		[join(folder, 'node_modules/@literary-universe/cli/dist/main.js'), ...args],
		{ encoding: 'utf8' },
	)
}
function installPackage(folder) {
	const pack = runNpm(['pack', '--pack-destination', folder], {
		cwd: root,
		encoding: 'utf8',
	})
	assert.equal(pack.status, 0, pack.stderr)
	writeFileSync(
		join(folder, 'package.json'),
		'{"name":"cli-consumer","private":true,"type":"module"}',
	)
	const archive = join(
		folder,
		readdirSync(folder).find((file) => file.endsWith('.tgz')),
	)
	installArchive(folder, archive)
}
function installArchive(folder, archive) {
	const installed = runNpm(
		[
			'install',
			'--offline',
			'--ignore-scripts',
			'--no-audit',
			'--no-fund',
			archive,
		],
		{ cwd: folder, encoding: 'utf8' },
	)
	assert.equal(installed.status, 0, installed.stderr)
}
function assertHelp(folder) {
	const result = installedCli(folder, ['--help'])
	assert.equal(result.status, 0, result.stderr)
	assert.match(result.stdout, /Literary Universe CLI/)
}
function assertInstalledBin(folder) {
	const filename = process.platform === 'win32' ? 'lu.cmd' : 'lu'
	const bin = join(folder, 'node_modules', '.bin', filename)
	const command = process.platform === 'win32' ? '"%LU_TEST_BIN%"' : bin
	const result = spawnSync(command, ['--help'], {
		encoding: 'utf8',
		shell: process.platform === 'win32',
		env: { ...process.env, LU_TEST_BIN: bin },
	})
	assert.equal(result.status, 0, result.stderr)
	assert.match(result.stdout, /Literary Universe CLI/)
}
const preparationArgs = (source, output) => [
	'image',
	'prepare',
	'--file',
	source,
	'--purpose',
	'universe-cover',
	'--format',
	'webp',
	'--output',
	output,
]
const sampleImage = () =>
	sharp({
		create: { width: 10, height: 10, channels: 4, background: '#40709050' },
	})
		.png()
		.toBuffer()
async function assertPreparation(folder, bytes) {
	const source = join(folder, 'original Ω & cover.png')
	const output = join(folder, 'prepared Ω & cover.webp')
	writeFileSync(source, bytes)
	const result = installedCli(folder, preparationArgs(source, output))
	assert.equal(result.status, 0, result.stderr)
	assert.equal(JSON.parse(result.stdout).width, 10)
	assert.equal((await sharp(output).metadata()).hasAlpha, true)
}
async function assertCommonJs(folder, bytes) {
	const require = createRequire(
		join(folder, 'node_modules/@literary-universe/cli/package.json'),
	)
	const { prepareImage } = require('@literary-universe/sdk/images')
	const result = await prepareImage(bytes, 'universe-cover')
	assert.equal(result.width, 10)
	assert.equal((await sharp(result.bytes).metadata()).hasAlpha, true)
}
test('packed CLI installs and runs without a sibling SDK or Meteor application', {
	timeout: 60_000,
}, async () => {
	const folder = mkdtempSync(join(tmpdir(), 'lu CLI Ω & packed-'))
	try {
		installPackage(folder)
		assertHelp(folder)
		assertInstalledBin(folder)
		const bytes = await sampleImage()
		await assertPreparation(folder, bytes)
		await assertCommonJs(folder, bytes)
	} finally {
		rmSync(folder, { recursive: true, force: true })
	}
})
