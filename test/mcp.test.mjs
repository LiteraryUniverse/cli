import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const cli = fileURLToPath(new URL('../dist/main.js', import.meta.url))

async function connect(t, args, env) {
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [cli, 'mcp', ...args],
		env: { ...process.env, LU_BASE_URL: 'https://example.test', ...env },
		stderr: 'pipe',
	})
	let stderr = ''
	transport.stderr.on('data', (chunk) => {
		stderr += chunk
	})
	const client = new Client({ name: 'test', version: '0' })
	await client.connect(transport)
	t.after(() => client.close())
	return { client, stderr: () => stderr }
}

test('lu mcp serves the selected tools over stdio with annotations', async (t) => {
	const { client, stderr } = await connect(t, ['--tools', 'stories,docs'], {
		LU_TOKEN: 'lu_test_fixture',
	})
	const { tools } = await client.listTools()
	const names = tools.map((tool) => tool.name).sort()
	assert.ok(names.includes('list-stories'), names.join())
	assert.ok(names.includes('fetch-lu-docs'))
	assert.ok(!names.includes('publish-chapter'))
	assert.ok(!names.includes('save-chapter-draft'))
	for (const tool of tools)
		assert.equal(typeof tool.annotations?.readOnlyHint, 'boolean', tool.name)
	assert.match(stderr(), /"event":"mcp"/)
})

test('lu mcp reads LU_MCP_TOOLS and reports a missing login per call', async (t) => {
	const { client } = await connect(t, [], { LU_MCP_TOOLS: 'account', LU_TOKEN: '' })
	const { tools } = await client.listTools()
	assert.deepEqual(
		tools.map((tool) => tool.name),
		['get-identity'],
	)
	const result = await client.callTool({ name: 'get-identity', arguments: {} })
	assert.equal(result.isError, true)
	assert.match(result.content[0].text, /lu login/)
})

test('lu mcp refuses an unknown tool selection before serving', async () => {
	const { spawnSync } = await import('node:child_process')
	const result = spawnSync(process.execPath, [cli, 'mcp', '--tools', 'nope'], {
		encoding: 'utf8',
		env: { ...process.env, LU_BASE_URL: 'https://example.test' },
	})
	assert.equal(result.status, 1)
	assert.equal(result.stdout, '')
	assert.equal(JSON.parse(result.stderr).code, 'INVALID_CONFIGURATION')
})
