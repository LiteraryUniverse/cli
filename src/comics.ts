import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { LiteraryUniverseClient } from '@literary-universe/sdk'
import { IMAGE_POLICY, LiteraryUniverseApiError } from '@literary-universe/sdk'

import { readBounded } from './images.js'

type ComicArgs = {
	baseUrl: string
	positionals: string[]
	values: {
		directory?: string
		title?: string
		description?: string
		format?: string
		license?: string
		language?: string
		genres?: string
		tags?: string
		rating?: string
		slug?: string
		universe?: string
		'ai-generated'?: boolean
		chapters?: string
		pages?: string
		alt?: string
		file?: string
		at?: string
		audience?: string
		after?: string
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
function planned(args: ComicArgs, event: string, plan: object) {
	return async (write: () => Promise<unknown>) => {
		process.stderr.write(
			`${JSON.stringify({ event: `${event}-plan`, deployment: args.baseUrl, ...plan })}\n`,
		)
		return write()
	}
}

const PAGE_TYPES = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const byName = new Intl.Collator(undefined, { numeric: true }).compare

/** Page files in reading order: the given files as listed, or a folder's images by name (2 before 10). */
export function pageFiles(files: string[], directory?: string) {
	if (files.length && directory)
		invalid('Use either listed images or --directory')
	const found = files.length
		? files
		: readdirSync(required(directory), { withFileTypes: true })
				.filter(
					(entry) =>
						entry.isFile() && PAGE_TYPES.has(extname(entry.name).toLowerCase()),
				)
				.map((entry) => entry.name)
				.sort(byName)
				.map((name) => join(required(directory), name))
	if (!found.length) invalid(`No PNG, JPEG or WebP images in ${directory}`)
	if (found.length > 300) invalid('Upload at most 300 pages at once')
	// Validate the whole batch before any uploads leave unattached assets.
	for (const file of found) {
		const stat = statSync(file)
		if (!stat.isFile() || stat.size > IMAGE_POLICY.maxSourceBytes)
			invalid('Image input must be a regular file within the byte limit')
	}
	return found
}

function comicDetails(v: ComicArgs['values']) {
	return given({
		title: v.title,
		description: v.description,
		format: v.format,
		language: v.language,
		rating: v.rating,
		genres: list(v.genres),
		tags: list(v.tags),
		isAIGenerated: v['ai-generated'],
	})
}

function create(client: LiteraryUniverseClient, args: ComicArgs) {
	const v = args.values
	const input = {
		...comicDetails(v),
		title: required(v.title),
		description: required(v.description),
		format: required(v.format),
		license: required(v.license),
		...given({ slug: v.slug, universeId: v.universe }),
	}
	return () =>
		planned(args, 'comic-create', { title: input.title, format: input.format })(
			() => client.createComic(input),
		)
}

async function upload(
	client: LiteraryUniverseClient,
	chapterId: string,
	files: string[],
) {
	// sharp is loaded only when pages are uploaded.
	const { uploadComicPageImage } = await import('@literary-universe/sdk/images')
	const pages = []
	for (const file of files)
		pages.push({
			fileId: await uploadComicPageImage(
				client,
				chapterId,
				readBounded(file, IMAGE_POLICY.maxSourceBytes),
			),
		})
	return client.addComicPages({ chapterId, pages })
}

function chapterCommands(client: LiteraryUniverseClient, args: ComicArgs) {
	const [, , verb, id] = args.positionals
	const target = required(id)
	if (verb === 'create') {
		const input = given({ comicId: target, title: args.values.title })
		return () =>
			planned(
				args,
				'comic-chapter-create',
				input,
			)(() => client.createComicChapter(input as { comicId: string }))
	}
	if (verb === 'rename') {
		const input = { title: required(args.values.title) }
		return () =>
			planned(args, 'comic-chapter-rename', { id: target, ...input })(() =>
				client.updateComicChapter({ id: target, input }),
			)
	}
	if (verb === 'remove')
		return () =>
			planned(args, 'comic-chapter-remove', { id: target })(() =>
				client.removeComicChapter({ id: target }),
			)
	if (verb === 'reorder') {
		const input = {
			comicId: target,
			chapterIds: list(required(args.values.chapters)) ?? [],
		}
		return () =>
			planned(
				args,
				'comic-chapter-reorder',
				input,
			)(() => client.reorderComicChapters(input))
	}
	invalid('Use lu comic chapter create, rename, remove or reorder')
}

function pageCommands(client: LiteraryUniverseClient, args: ComicArgs) {
	const [, , verb, id] = args.positionals
	const target = required(id)
	if (verb === 'alt') {
		const input = { id: target, altText: required(args.values.alt) }
		return () =>
			planned(
				args,
				'comic-page-alt',
				input,
			)(() => client.updateComicPage(input))
	}
	if (verb === 'remove')
		return () =>
			planned(args, 'comic-page-remove', { id: target })(() =>
				client.removeComicPage({ id: target }),
			)
	if (verb === 'reorder') {
		const input = {
			chapterId: target,
			pageIds: list(required(args.values.pages)) ?? [],
		}
		return () =>
			planned(
				args,
				'comic-page-reorder',
				input,
			)(() => client.reorderComicPages(input))
	}
	invalid('Use lu comic page alt, remove or reorder')
}

function layerCommands(client: LiteraryUniverseClient, args: ComicArgs) {
	const [, , verb, id] = args.positionals
	const target = required(id)
	if (verb === 'remove')
		return () =>
			planned(args, 'comic-layer-remove', { id: target })(() =>
				client.removeComicLayer({ id: target }),
			)
	if (verb !== 'create' && verb !== 'update')
		invalid('Use lu comic layer create, update or remove')
	const data = jsonFile(required(args.values.file))
	if (verb === 'create') {
		const input = { ...data, pageId: target } as Parameters<
			LiteraryUniverseClient['createComicLayer']
		>[0]
		return () =>
			planned(args, 'comic-layer-create', {
				pageId: target,
				kind: input.kind,
				items: input.items?.length,
			})(() => client.createComicLayer(input))
	}
	const input = { ...data, id: target } as Parameters<
		LiteraryUniverseClient['updateComicLayer']
	>[0]
	return () =>
		planned(args, 'comic-layer-update', { id: target })(() =>
			client.updateComicLayer(input),
		)
}

function publish(client: LiteraryUniverseClient, args: ComicArgs) {
	const audience = args.values.audience ?? 'readers'
	if (audience !== 'readers' && audience !== 'beta')
		invalid('Use --audience readers or beta')
	const input = {
		id: required(args.positionals[2]),
		publishAt: args.values.at,
		audience: audience === 'readers' ? ('READERS' as const) : ('BETA' as const),
	}
	return () =>
		planned(
			args,
			'comic-publish',
			input,
		)(() => client.publishComicChapter(input))
}

/** Comic commands, or undefined when the arguments are another command. */
export function comicCommand(
	client: LiteraryUniverseClient,
	args: ComicArgs,
): Command | undefined {
	const [noun, verb, id] = args.positionals
	if (noun === 'comics')
		return () => client.comics({ after: args.values.after })
	if (noun !== 'comic') return
	switch (verb) {
		case 'create':
			return create(client, args)
		case 'update': {
			const comicId = required(id)
			const input = comicDetails(args.values)
			return () =>
				planned(args, 'comic-update', { id: comicId, input })(() =>
					client.updateComic({ id: comicId, input }),
				)
		}
		case 'chapters':
			return () => client.comicChapters({ comicId: required(id) })
		case 'pages':
			return () => client.comicPages({ chapterId: required(id) })
		case 'upload': {
			const chapterId = required(id)
			const files = pageFiles(args.positionals.slice(3), args.values.directory)
			return () =>
				planned(args, 'comic-upload', { chapterId, pages: files })(() =>
					upload(client, chapterId, files),
				)
		}
		case 'chapter':
			return chapterCommands(client, args)
		case 'page':
			return pageCommands(client, args)
		case 'layer':
			return layerCommands(client, args)
		case 'publish':
			return publish(client, args)
		default:
			return () => client.comic({ id: required(verb) })
	}
}
