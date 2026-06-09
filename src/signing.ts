import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'

import { emitProgress, progressReadable } from './progress.js'
import type {
  UploadOptions,
  UploadProgressCallback,
  UploadSigner,
} from './types.js'

const require = createRequire(import.meta.url)
const { DataItem, createData, deepHash, stringToBuffer } =
  require('@dha-team/arbundles') as {
    DataItem: new (raw: Buffer) => { id: string | Uint8Array }
    createData: (
      data: Buffer,
      signer: UploadSigner,
      opts?: { tags?: Array<{ name: string; value: string }> },
    ) => {
      getRaw: () => Uint8Array
      id?: string
      sign: (signer: UploadSigner) => Promise<void>
      rawAnchor: Buffer
      rawOwner: Buffer
      rawTags: Buffer
      rawTarget: Buffer
      setSignature: (signature: Buffer) => Promise<void>
      signatureType: number
    }
    deepHash: (
      chunks: Array<Buffer | Readable | Uint8Array>,
    ) => Promise<Uint8Array>
    stringToBuffer: (value: string) => Buffer
  }

export function toBuffer(data: UploadOptions['data']): Buffer {
  if (typeof data === 'string') return Buffer.from(data)
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
}

export function dataItemId(raw: Buffer): string {
  return toBase64Url(new DataItem(raw).id)
}

export async function signDataItem(options: {
  data: UploadOptions['data']
  onProgress: UploadProgressCallback | undefined
  signer: UploadSigner
  tags: Array<{ name: string; value: string }> | undefined
}): Promise<{ localId: string; raw: Buffer }> {
  const data = toBuffer(options.data)
  emitProgress(options.onProgress, 'signing', 0, data.length)
  const item = createData(data, options.signer, {
    tags: options.tags ?? [],
  })
  await item.sign(options.signer)
  emitProgress(options.onProgress, 'signing', data.length, data.length)

  const raw = Buffer.from(item.getRaw())
  const localId = item.id || dataItemId(raw)

  return { localId, raw }
}

export async function signStreamDataItem(options: {
  onProgress: UploadProgressCallback | undefined
  signer: UploadSigner
  size: number
  stream: () => NodeJS.ReadableStream
  tags: Array<{ name: string; value: string }> | undefined
}): Promise<{
  localId: string
  signedBytes: number
  stream: () => Readable
}> {
  if (!Number.isSafeInteger(options.size) || options.size < 0) {
    throw new TypeError('uploadStream size must be a non-negative safe integer')
  }

  const header = createData(Buffer.alloc(0), options.signer, {
    tags: options.tags ?? [],
  })
  const hash = await deepHash([
    stringToBuffer('dataitem'),
    stringToBuffer('1'),
    stringToBuffer(header.signatureType.toString()),
    header.rawOwner,
    header.rawTarget,
    header.rawAnchor,
    header.rawTags,
    progressReadable(
      toReadable(options.stream()),
      'signing',
      options.size,
      options.onProgress,
    ),
  ])
  const sigBytes = Buffer.from(await options.signer.sign(hash))
  await header.setSignature(sigBytes)

  const headerBytes = Buffer.from(header.getRaw())
  const localId =
    header.id || createHash('sha256').update(sigBytes).digest('base64url')

  return {
    localId,
    signedBytes: headerBytes.length + options.size,
    stream: () =>
      progressReadable(
        Readable.from(signedStream(headerBytes, toReadable(options.stream()))),
        'uploading',
        headerBytes.length + options.size,
        options.onProgress,
      ),
  }
}

function toBase64Url(value: string | Uint8Array): string {
  if (typeof value === 'string') return value
  return Buffer.from(value).toString('base64url')
}

function toReadable(stream: NodeJS.ReadableStream): Readable {
  if (stream instanceof Readable) return stream
  return Readable.from(stream)
}

async function* signedStream(
  header: Buffer,
  stream: Readable,
): AsyncGenerator<Buffer | string | Uint8Array> {
  yield header
  for await (const chunk of stream) {
    yield chunk as Buffer | string | Uint8Array
  }
}
