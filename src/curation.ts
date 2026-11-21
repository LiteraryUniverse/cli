import { randomUUID } from 'node:crypto'
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
		first?: string
		after?: string
		file?: string
		'ai-generated'?: boolean
		'ai-model'?: string
		'expected-version'?: string
		'operation-id'?: string
		audience?: string
		at?: string
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
	if (verb === 'creation-options') return () => client.storyCreationOptions()
	if (verb === 'create') {
		const isAIGenerated = v['ai-generated'] ?? false
		if (isAIGenerated && !v['ai-model']?.trim())
			invalid('AI-generated stories require --ai-model')
		const genres = list(required(v.genres)) ?? []
		if (!genres.length) invalid('Provide at least one --genres value')
		const input = {
			title: required(v.title),
			slug: required(v.slug),
			description: required(v.description),
			language: required(v.language),
			genres,
			rating: required(v.rating),
			license: required(v.license),
			isAIGenerated,
			...given({ aiModel: v['ai-model'], universeId: v.universe }),
		}
		return () =>
			planned(args, 'story-create', { title: input.title, slug: input.slug })(
				() => client.createStory(input),
			)
	}
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
			aiModel: v['ai-model'],
		})
		const storyId = required(id)
		const expectedVersion = v['expected-version']
		return () =>
			planned(args, 'story-update', { storyId, input, expectedVersion })(() =>
				client.updateStory({ storyId, input, expectedVersion }),
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
	const v = args.values
	if (verb === 'create') {
		const input = {
			title: required(v.title),
			slug: required(v.slug),
			genre: required(v.genre),
			rating: required(v.rating),
			license: required(v.license),
			language: required(v.language),
			description: required(v.description),
			...given({ aiModel: v['ai-model'] }),
		}
		// The SDK never retries creation: a repeat would make a second universe.
		return () =>
			planned(
				args,
				'universe-create',
				input,
			)(() => client.createUniverse(input))
	}
	if (verb !== 'update') return
	const universeId = required(id)
	const input = given({
		title: v.title,
		slug: v.slug,
		description: v.description,
		genre: v.genre,
		rating: v.rating,
		license: v.license,
		language: v.language,
		aiModel: v['ai-model'],
	})
	const expectedVersion = v['expected-version']
	return () =>
		planned(args, 'universe-update', { universeId, input, expectedVersion })(
			() => client.updateUniverse({ universeId, input, expectedVersion }),
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
			const input = {
				...file(),
				...given({ aiModel: args.values['ai-model'] }),
				universeId: id,
			} as Parameters<LiteraryUniverseClient['createEncyclopediaEntry']>[0]
			return () =>
				planned(args, 'entry-create', {
					universeId: id,
					name: input.name,
				})(() => client.createEncyclopediaEntry(input))
		}
		case 'update': {
			const changes = {
				...file(),
				...given({ aiModel: args.values['ai-model'] }),
			} as Parameters<
				LiteraryUniverseClient['updateEncyclopediaEntry']
			>[0]['changes']
			const expectedVersion = args.values['expected-version']
			return () =>
				planned(args, 'entry-update', {
					id,
					fields: Object.keys(changes),
					expectedVersion,
				})(() =>
					client.updateEncyclopediaEntry({ id, changes, expectedVersion }),
				)
		}
		case 'translate': {
			const input = {
				...file(),
				...given({ expectedVersion: args.values['expected-version'] }),
				id,
				language: required(args.values.language),
			} as Parameters<LiteraryUniverseClient['translateEncyclopediaEntry']>[0]
			return () =>
				planned(args, 'entry-translate', {
					id,
					language: input.language,
					expectedVersion: input.expectedVersion,
				})(() => client.translateEncyclopediaEntry(input))
		}
		case 'publish':
			return entryRelease(client, args, id)
		case 'unpublish':
			return () =>
				planned(args, 'entry-unpublish', { id })(() =>
					client.setEncyclopediaEntryPublication({ id, published: false }),
				)
		default:
			return () =>
				planned(args, 'entry-delete', { id })(() =>
					client.deleteEncyclopediaEntry({ id }),
				)
	}
}

/** Releases one edition at the version given, or at the one it has now. */
function entryRelease(
	client: LiteraryUniverseClient,
	args: CurationArgs,
	id: string,
) {
	const v = args.values
	const audience = v.audience ?? 'readers'
	if (audience !== 'readers' && audience !== 'beta')
		invalid('Use --audience readers or beta')
	if (v.at && !(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(v.at) && Date.parse(v.at)))
		invalid(
			'--at needs an ISO time with a timezone, such as 2027-01-01T12:00:00Z',
		)
	return async () => {
		let expectedVersion = v['expected-version']
		const read = !expectedVersion
		if (read) {
			const entry = await client.encyclopediaEntry({ id })
			if (!entry)
				throw new LiteraryUniverseApiError('NOT_FOUND', 'Entry not found')
			const language = v.language ?? entry.language
			expectedVersion =
				entry.editions.find((edition) => edition.language === language)
					?.version ?? invalid(`The entry has no ${language} edition`)
		}
		const input = {
			id,
			...given({ language: v.language, publishAt: v.at }),
			audience:
				audience === 'readers' ? ('READERS' as const) : ('BETA' as const),
			expectedVersion: expectedVersion as string,
			operationId: v['operation-id'] ?? randomUUID(),
		}
		return planned(args, 'entry-publish', {
			...input,
			...(read
				? {
						note: "expectedVersion is the edition's current version, read just now",
					}
				: {}),
		})(() => client.publishEncyclopediaEntry(input))
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

function blogCommands(client: LiteraryUniverseClient, args: CurationArgs) {
	const [, verb, id] = args.positionals
	const blogId = required(id)
	if (verb === 'pages') {
		const first =
			args.values.first === undefined ? undefined : Number(args.values.first)
		if (
			first !== undefined &&
			(!Number.isInteger(first) || first < 1 || first > 100)
		)
			invalid('--first must be a whole number between 1 and 100')
		return () => client.blogPages({ blogId, first, after: args.values.after })
	}
	if (verb === 'menus') return () => client.blogMenus({ blogId })
	if (verb !== 'mutate') invalid('Use lu blog pages, menus or mutate')
	const data = jsonFile(required(args.values.file))
	if (data.blogId !== undefined && data.blogId !== blogId)
		invalid('The file blogId must match the command blog ID')
	if (!Object.hasOwn(data, 'expectedVersion'))
		invalid(
			'Provide expectedVersion in the file; use null only for a new document',
		)
	const input = { ...data, blogId } as Parameters<
		LiteraryUniverseClient['mutateBlog']
	>[0]
	return () =>
		planned(args, 'blog-mutation', {
			blogId,
			action: input.action,
			operationId: input.operationId,
			expectedVersion: input.expectedVersion,
			pageId: input.pageId,
			location: input.location,
		})(() => client.mutateBlog(input))
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
	if (noun === 'blog') return blogCommands(client, args)
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
