import { readFileSync, statSync } from 'node:fs'
import type { LiteraryUniverseClient } from '@literary-universe/sdk'
import { LiteraryUniverseApiError } from '@literary-universe/sdk'

type CurationArgs = {
	baseUrl: string
	positionals: string[]
	values: {
		title?: string
		description?: string
		genres?: string
		genre?: string
		tags?: string
		rating?: string
		license?: string
		language?: string
		slug?: string
		universe?: string
		standalone?: boolean
		chapters?: string
		stories?: string
		series?: string
		after?: string
		file?: string
		'expected-version'?: string
	}
}
type Command = () => Promise<unknown>

function invalid(message: string): never {
	throw new LiteraryUniverseApiError('BAD_USER_INPUT', message)
}
const required = (value?: string) =>
	value ?? invalid('Missing argument; run lu --help')
const list = (value?: string) =>
	value
		?.split(',')
		.map((item) => item.trim())
		.filter(Boolean)
/** Only the options given; an absent one leaves the field as it is. */
const given = <T extends Record<string, unknown>>(fields: T) =>
	Object.fromEntries(
		Object.entries(fields).filter(([, value]) => value !== undefined),
	) as Partial<T>

function jsonFile(file: string): Record<string, unknown> {
	if (statSync(file).size > 1024 * 1024)
		throw new LiteraryUniverseApiError(
			'PAYLOAD_TOO_LARGE',
			'Input file exceeds the size limit',
		)
	const value = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''))
	if (!value || typeof value !== 'object' || Array.isArray(value))
		invalid('The input file must hold a JSON object')
	return value
}

/** Every write states what it will do on stderr before it runs. */
function planned(args: CurationArgs, event: string, plan: object) {
	return async (write: () => Promise<unknown>) => {
		process.stderr.write(
			`${JSON.stringify({ event: `${event}-plan`, deployment: args.baseUrl, ...plan })}\n`,
		)
		return write()
	}
}

function storyCommands(client: LiteraryUniverseClient, args: CurationArgs) {
	const [, verb, id] = args.positionals
	const v = args.values
	if (verb === 'update') {
		if (v.universe && v.standalone)
			invalid('Use either --universe or --standalone')
		const input = given({
			title: v.title,
			description: v.description,
			genres: list(v.genres),
			tags: list(v.tags),
			rating: v.rating,
			license: v.license,
			language: v.language,
			universeId: v.standalone ? null : v.universe,
		})
		const storyId = required(id)
		return () =>
			planned(args, 'story-update', { storyId, input })(() =>
				client.updateStory({ storyId, input }),
			)
	}
	if (verb === 'hide' || verb === 'show') {
		const storyId = required(id)
		const visibility = verb === 'hide' ? 'PRIVATE' : 'PUBLIC'
		return () =>
			planned(args, `story-${verb}`, { storyId })(() =>
				client.setStoryVisibility({ storyId, visibility }),
			)
	}
}

function chapterCommands(client: LiteraryUniverseClient, args: CurationArgs) {
	const [, verb, id] = args.positionals
	const target = required(id)
	if (verb === 'rename') {
		const input = {
			id: target,
			title: required(args.values.title),
			language: args.values.language,
		}
		return () =>
			planned(args, 'chapter-rename', input)(() => client.renameChapter(input))
	}
	if (verb === 'remove')
		return () =>
			planned(args, 'chapter-remove', { id: target })(() =>
				client.removeChapter({ id: target }),
			)
	if (verb === 'reorder') {
		const input = {
			storyId: target,
			chapterIds: list(required(args.values.chapters)) ?? [],
		}
		return () =>
			planned(
				args,
				'chapter-reorder',
				input,
			)(() => client.reorderChapters(input))
	}
}

function universeCommands(client: LiteraryUniverseClient, args: CurationArgs) {
	const [, verb, id] = args.positionals
	if (verb !== 'update') return
	const v = args.values
	const universeId = required(id)
	const input = given({
		title: v.title,
		slug: v.slug,
		description: v.description,
		genre: v.genre,
		rating: v.rating,
		license: v.license,
		language: v.language,
	})
	return () =>
		planned(args, 'universe-update', { universeId, input })(() =>
			client.updateUniverse({ universeId, input }),
		)
}

const ENTRY_VERBS = new Set([
	'create',
	'update',
	'translate',
	'publish',
	'unpublish',
	'delete',
])

function entryCommands(client: LiteraryUniverseClient, args: CurationArgs) {
	const [, verb, id] = args.positionals
	if (!ENTRY_VERBS.has(verb) || !id)
		return () =>
			client.encyclopediaEntry({
				id: required(verb),
				language: args.values.language,
			})
	const file = () => jsonFile(required(args.values.file))
	switch (verb) {
		case 'create': {
			const input = { ...file(), universeId: id } as Parameters<
				LiteraryUniverseClient['createEncyclopediaEntry']
			>[0]
			return () =>
				planned(args, 'entry-create', {
					universeId: id,
					name: input.name,
				})(() => client.createEncyclopediaEntry(input))
		}
		case 'update': {
			const changes = file() as Parameters<
				LiteraryUniverseClient['updateEncyclopediaEntry']
			>[0]['changes']
			return () =>
				planned(args, 'entry-update', { id, fields: Object.keys(changes) })(
					() => client.updateEncyclopediaEntry({ id, changes }),
				)
		}
		case 'translate': {
			const input = {
				...file(),
				id,
				language: required(args.values.language),
			} as Parameters<LiteraryUniverseClient['translateEncyclopediaEntry']>[0]
			return () =>
				planned(args, 'entry-translate', { id, language: input.language })(() =>
					client.translateEncyclopediaEntry(input),
				)
		}
		case 'publish':
		case 'unpublish':
			return () =>
				planned(args, `entry-${verb}`, { id })(() =>
					client.setEncyclopediaEntryPublication({
						id,
						published: verb === 'publish',
					}),
				)
		default:
			return () =>
				planned(args, 'entry-delete', { id })(() =>
					client.deleteEncyclopediaEntry({ id }),
				)
	}
}

function seriesCommands(client: LiteraryUniverseClient, args: CurationArgs) {
	const [, verb, id] = args.positionals
	if (verb !== 'save' || !id)
		return () => client.series({ universeId: required(verb) })
	const expected = Number(required(args.values['expected-version']))
	if (!Number.isInteger(expected) || expected < 0)
		invalid('--expected-version must be a whole number')
	const input = {
		universeId: id,
		seriesId: args.values.series,
		expectedVersion: expected,
		title: required(args.values.title),
		storyIds: list(required(args.values.stories)) ?? [],
	}
	return () =>
		planned(args, 'series-save', input)(() => client.saveSeries(input))
}

/**
 * Curation commands, or undefined when the arguments are another command.
 * `lu story <id>` and `lu universe <id>` stay reads.
 */
export function curationCommand(
	client: LiteraryUniverseClient,
	args: CurationArgs,
): Command | undefined {
	const [noun, verb] = args.positionals
	if (noun === 'story') return storyCommands(client, args)
	if (noun === 'chapter') return chapterCommands(client, args)
	if (noun === 'universe') return universeCommands(client, args)
	if (noun === 'entries')
		return () =>
			client.encyclopediaEntries({
				universeId: required(verb),
				after: args.values.after,
			})
	if (noun === 'entry') return entryCommands(client, args)
	if (noun === 'series') return seriesCommands(client, args)
}
