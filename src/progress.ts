import { Readable } from 'node:stream'

import type { UploadProgressCallback } from './types.js'

export function progressReadable(
  stream: Readable,
  phase: 'signing' | 'uploading',
  total: number,
  onProgress: UploadProgressCallback | undefined,
): Readable {
  if (!onProgress) return stream

  async function* track(): AsyncGenerator<Buffer | string | Uint8Array> {
    let loaded = 0
    emitProgress(onProgress, phase, loaded, total)

    for await (const chunk of stream) {
      loaded += chunkByteLength(chunk)
      emitProgress(onProgress, phase, Math.min(loaded, total), total)
      yield chunk as Buffer | string | Uint8Array
    }

    if (loaded < total) {
      emitProgress(onProgress, phase, total, total)
    }
  }

  return Readable.from(track())
}

export function emitProgress(
  onProgress: UploadProgressCallback | undefined,
  phase: 'signing' | 'uploading',
  loaded: number,
  total: number,
): void {
  onProgress?.({ loaded, phase, total })
}

function chunkByteLength(chunk: unknown): number {
  if (typeof chunk === 'string') return Buffer.byteLength(chunk)
  if (chunk instanceof ArrayBuffer) return chunk.byteLength
  if (ArrayBuffer.isView(chunk)) return chunk.byteLength
  return Buffer.byteLength(String(chunk))
}
