import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { selectTools } from '@literary-universe/sdk/mcp'

const root = new URL('../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const plugin = JSON.parse(read('plugin/.claude-plugin/plugin.json'))
// Served by the hosted endpoint itself, not by the SDK.
const HOSTED = ['load-writing-skill', 'load-universe-skill']
const skills = readdirSync(new URL('plugin/skills', root))

test('the plugin connects to hosted tool categories the SDK knows', () => {
	const url = new URL(plugin.mcpServers['literary-universe'].url)
	assert.equal(url.origin + url.pathname, 'https://literaryuniverse.com/mcp')
	const selection = url.searchParams.get('tools').split(',')
	assert.ok(selection.includes('assistant'))
	const tools = selectTools(selection.filter((entry) => entry !== 'assistant'))
	assert.ok(tools.includes('create-story') && tools.includes('publish-chapter'))
	const marketplace = JSON.parse(read('.claude-plugin/marketplace.json'))
	assert.equal(marketplace.plugins[0].name, plugin.name)
})

test('plugin skills upload to claude.ai and name only real tools and skills', () => {
	const known = new Set([
		...selectTools(['all']),
		...HOSTED,
		...skills,
		plugin.name,
	])
	for (const name of skills) {
		const text = read(`plugin/skills/${name}/SKILL.md`)
		const [, frontmatter, body] = text.match(
			/^---\n([\s\S]*?)\n---\n([\s\S]*)$/,
		)
		const fields = Object.fromEntries(
			frontmatter.split('\n').map((line) => {
				const at = line.indexOf(': ')
				return [line.slice(0, at), line.slice(at + 2)]
			}),
		)
		// claude.ai rejects other keys, a name unlike its folder, and long descriptions.
		assert.deepEqual(Object.keys(fields), ['name', 'description'], name)
		assert.equal(fields.name, name)
		assert.ok(fields.description.length <= 1024, name)
		for (const [, mention] of body.matchAll(/`([a-z]+(?:-[a-z]+)+)`/g))
			assert.ok(known.has(mention), `${name} mentions unknown ${mention}`)
	}
})
