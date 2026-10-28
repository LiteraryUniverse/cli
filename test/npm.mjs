import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { basename, delimiter, join } from 'node:path'

function npmEntry() {
	const candidates = (process.env.PATH ?? '')
		.split(delimiter)
		.flatMap((directory) => [
			join(directory, 'npm'),
			join(directory, 'node_modules/npm/bin/npm-cli.js'),
			join(directory, '../lib/node_modules/npm/bin/npm-cli.js'),
		])
	const file = [process.env.npm_execpath, ...candidates].find(
		(path) =>
			path && existsSync(path) && basename(realpathSync(path)) === 'npm-cli.js',
	)
	if (!file) throw new Error('Install npm to run the packed-package checks')
	return realpathSync(file)
}

// Invoke npm's JavaScript entry point so paths never pass through cmd.exe.
export function runNpm(args, options) {
	return spawnSync(process.execPath, [npmEntry(), ...args], options)
}
