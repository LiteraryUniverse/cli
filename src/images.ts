import {
	closeSync,
	fstatSync,
	openSync,
	readSync,
	writeFileSync,
} from 'node:fs'
import type {
	ImagePolicy,
	ImagePurpose,
	LiteraryUniverseClient,
} from '@literary-universe/sdk'
import { IMAGE_POLICY, LiteraryUniverseApiError } from '@literary-universe/sdk'
import { type ImageCrop, prepareImage } from '@literary-universe/sdk/images'

type ImageArgs = {
	baseUrl?: string
	positionals: string[]
	values: {
		file?: string
		purpose?: string
		output?: string
		crop?: string
		format?: string
		'policy-file'?: string
		'policy-version'?: string
		'operation-id'?: string
	}
}
function invalid(message: string): never {
	throw new LiteraryUniverseApiError('BAD_USER_INPUT', message)
}
const required = (value?: string) =>
	value ?? invalid('Missing image argument; run lu --help')
function purpose(value?: string): ImagePurpose {
	if (!value || !Object.hasOwn(IMAGE_POLICY.purposes, value))
		invalid('Unknown image purpose')
	return value as ImagePurpose
}

function readBounded(file: string, max: number) {
	const fd = openSync(file, 'r')
	try {
		const stat = fstatSync(fd)
		if (!stat.isFile() || stat.size > max)
			invalid('Image input must be a regular file within the byte limit')
		const bytes = Buffer.alloc(stat.size + 1)
		let count = 0
		for (let read = 1; read > 0 && count < bytes.length; count += read)
			read = readSync(fd, bytes, count, bytes.length - count, count)
		if (count !== stat.size || fstatSync(fd).size !== stat.size)
			invalid('Image input changed while reading')
		return bytes.subarray(0, count)
	} finally {
		closeSync(fd)
	}
}

function crop(value?: string): ImageCrop | undefined {
	if (!value) return
	if (!/^\d+,\d+,\d+,\d+$/.test(value))
		invalid('Use --crop left,top,width,height in oriented source pixels')
	const [left, top, width, height] = value.split(',').map(Number)
	return { left, top, width, height }
}
function preparationOptions(args: ImageArgs) {
	const format = args.values.format
	if (format && !['jpeg', 'png', 'webp'].includes(format))
		invalid('Use --format jpeg, png or webp')
	const policy = args.values['policy-file']
		? (JSON.parse(
				readBounded(args.values['policy-file'], 32_768)
					.toString('utf8')
					.replace(/^\uFEFF/, ''),
			) as ImagePolicy)
		: IMAGE_POLICY
	return {
		crop: crop(args.values.crop),
		format: format as 'jpeg' | 'png' | 'webp' | undefined,
		policy,
	}
}

async function prepare(args: ImageArgs) {
	const bytes = readBounded(
		required(args.values.file),
		IMAGE_POLICY.maxSourceBytes,
	)
	const image = await prepareImage(
		bytes,
		purpose(args.values.purpose),
		preparationOptions(args),
	)
	const { bytes: prepared, ...info } = image
	const destination = required(args.values.output)
	writeFileSync(destination, prepared, { flag: 'wx', mode: 0o600 })
	return { ...info, file: destination, size: prepared.byteLength }
}

const imageType = (bytes: Buffer) =>
	bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
		? 'image/png'
		: bytes[0] === 255 && bytes[1] === 216
			? 'image/jpeg'
			: 'image/webp'

function uploadInput(args: ImageArgs) {
	const bytes = readBounded(required(args.values.file), 5 * 1024 * 1024)
	const type = imageType(bytes)
	return {
		targetId: required(args.positionals[2]),
		purpose: purpose(args.values.purpose),
		operationId: required(args.values['operation-id']),
		policyVersion: required(args.values['policy-version']),
		bytes,
		type,
	}
}
async function upload(client: LiteraryUniverseClient, args: ImageArgs) {
	const input = uploadInput(args)
	process.stderr.write(
		`${JSON.stringify({
			event: 'image-upload-plan',
			deployment: args.baseUrl,
			purpose: input.purpose,
			targetId: input.targetId,
			operationId: input.operationId,
			size: input.bytes.length,
		})}\n`,
	)
	return client.uploadImage(input)
}

async function cover(client: LiteraryUniverseClient, args: ImageArgs) {
	const kind = args.positionals[2]
	if (kind !== 'story' && kind !== 'universe')
		invalid('Use lu image cover story|universe <id> --file <image>')
	const bytes = readBounded(required(args.values.file), 5 * 1024 * 1024)
	const id = required(args.positionals[3])
	process.stderr.write(
		`${JSON.stringify({ event: 'cover-plan', deployment: args.baseUrl, kind, id, size: bytes.length })}\n`,
	)
	return client.setCover({ kind, id, bytes, type: imageType(bytes) })
}

export async function imageCommand(
	client: LiteraryUniverseClient,
	args: ImageArgs,
) {
	if (args.positionals[1] === 'prepare') return prepare(args)
	if (args.positionals[1] === 'policy') return client.imagePolicy()
	if (args.positionals[1] === 'upload') return upload(client, args)
	if (args.positionals[1] === 'cover') return cover(client, args)
	invalid('Use lu image prepare, policy, upload or cover')
}
