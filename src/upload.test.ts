import { generateKeyPairSync } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import {
  ArweaveSigner,
  legacy_upload,
  legacy_uploadFile,
  legacy_uploadFolder,
  legacy_uploadStream,
  upload,
  uploadFile,
  uploadFolder,
  uploadSignedDataItem,
  uploadStream,
} from './index.js'

interface TestJwk {
  kty: string
  e: string
  n: string
  d?: string
  p?: string
  q?: string
  dp?: string
  dq?: string
  qi?: string
}

function testJwk(): TestJwk {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicExponent: 0x10001,
  })

  return privateKey.export({ format: 'jwk' }) as TestJwk
}

function uploadSize(payloadBytes: number) {
  return {
    payloadBytes,
    signedBytes: expect.any(Number),
  }
}

function anyUploadSize() {
  return {
    payloadBytes: expect.any(Number),
    signedBytes: expect.any(Number),
  }
}

function signedUploadSize() {
  return {
    signedBytes: expect.any(Number),
  }
}

describe('upload', () => {
  it('emits signing and upload progress for buffered HyperBEAM uploads', async () => {
    const progress: Array<{ loaded: number; phase: string; total: number }> = []
    const fetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url)

        if (href === 'https://hyperbeam.test/~meta@1.0/info/address') {
          return new Response('node-address')
        }

        if (href === 'https://arweave.net/wallet/node-address/balance') {
          return new Response('1')
        }

        if (
          href ===
          'https://hyperbeam.test/~bundler@1.0/item?codec-device=ans104@1.0'
        ) {
          expect(init?.method).toBe('POST')
          return new Response(JSON.stringify({ id: 'progress-upload-id' }))
        }

        return new Response('not found', { status: 404 })
      },
    )

    await upload({
      data: 'hello',
      fetch: fetch as typeof globalThis.fetch,
      onProgress: (event) => progress.push(event),
      signer: new ArweaveSigner(testJwk()),
      uploader: 'https://hyperbeam.test',
    })

    expect(progress[0]).toEqual({ loaded: 0, phase: 'signing', total: 5 })
    expect(progress[1]).toEqual({ loaded: 5, phase: 'signing', total: 5 })
    expect(progress[2]).toMatchObject({ loaded: 0, phase: 'uploading' })
    expect(progress.at(-1)).toMatchObject({ phase: 'uploading' })
    expect(progress.at(-1)?.loaded).toBe(progress.at(-1)?.total)
  })

  it('uploads a signed ANS-104 item to a pinned HyperBEAM uploader', async () => {
    const fetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url)

        if (href === 'https://hyperbeam.test/~meta@1.0/info/address') {
          return new Response('node-address')
        }

        if (href === 'https://arweave.net/wallet/node-address/balance') {
          return new Response('1')
        }

        if (
          href ===
          'https://hyperbeam.test/~bundler@1.0/item?codec-device=ans104@1.0'
        ) {
          expect(init?.method).toBe('POST')
          expect(init?.body).toBeDefined()
          return new Response('{}', { headers: { id: 'uploaded-item-id' } })
        }

        return new Response('not found', { status: 404 })
      },
    )

    await expect(
      upload({
        data: 'hello',
        fetch: fetch as typeof globalThis.fetch,
        signer: new ArweaveSigner(testJwk()),
        tags: [{ name: 'Content-Type', value: 'text/plain' }],
        uploader: 'https://hyperbeam.test',
      }),
    ).resolves.toEqual({
      id: 'uploaded-item-id',
      size: uploadSize(5),
      uploader: 'https://hyperbeam.test',
    })
  })

  it('uploads a signed ANS-104 item to the default legacy uploader', async () => {
    const fetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://up.arweave.net/v1/tx/arweave')
        expect(init?.method).toBe('POST')
        expect(init?.body).toBeDefined()
        expect(init?.headers).toMatchObject({
          'content-type': 'application/octet-stream',
        })

        return new Response(JSON.stringify({ id: 'legacy-uploaded-item-id' }))
      },
    )

    await expect(
      legacy_upload({
        data: 'hello',
        fetch: fetch as typeof globalThis.fetch,
        signer: new ArweaveSigner(testJwk()),
        tags: [{ name: 'Content-Type', value: 'text/plain' }],
      }),
    ).resolves.toEqual({
      id: 'legacy-uploaded-item-id',
      size: uploadSize(5),
      uploader: 'https://up.arweave.net',
    })
  })

  it('uploads a signed stream to the default legacy uploader', async () => {
    const fetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://up.arweave.net/v1/tx/arweave')
        expect(init?.method).toBe('POST')
        expect(init?.headers).toMatchObject({
          'content-type': 'application/octet-stream',
        })
        expect(
          Number((init?.headers as Record<string, string>)['content-length']),
        ).toBeGreaterThan('legacy stream'.length)
        expect(init?.body).toBeInstanceOf(Readable)

        return new Response(JSON.stringify({ id: 'legacy-stream-upload-id' }))
      },
    )

    await expect(
      legacy_uploadStream({
        fetch: fetch as typeof globalThis.fetch,
        signer: new ArweaveSigner(testJwk()),
        size: 'legacy stream'.length,
        stream: () => Readable.from(['legacy stream']),
        tags: [{ name: 'Content-Type', value: 'text/plain' }],
      }),
    ).resolves.toEqual({
      id: 'legacy-stream-upload-id',
      size: uploadSize('legacy stream'.length),
      uploader: 'https://up.arweave.net',
    })
  })

  it('uploads a signed file to the default legacy uploader', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bundlers-legacy-upload-file-'))
    const file = join(dir, 'payload.txt')
    await writeFile(file, 'legacy file payload')

    try {
      const fetch = vi.fn(
        async (url: string | URL | Request, init?: RequestInit) => {
          expect(String(url)).toBe('https://up.arweave.net/v1/tx/arweave')
          expect(init?.method).toBe('POST')
          expect(init?.body).toBeInstanceOf(Readable)

          return new Response(JSON.stringify({ id: 'legacy-file-upload-id' }))
        },
      )

      await expect(
        legacy_uploadFile({
          fetch: fetch as typeof globalThis.fetch,
          file,
          signer: new ArweaveSigner(testJwk()),
          tags: [{ name: 'Content-Type', value: 'text/plain' }],
        }),
      ).resolves.toEqual({
        id: 'legacy-file-upload-id',
        size: uploadSize('legacy file payload'.length),
        uploader: 'https://up.arweave.net',
      })
    } finally {
      await rm(dir, { recursive: true })
    }
  })

  it('uploads a folder and Arweave manifest to a pinned HyperBEAM uploader', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bundlers-upload-folder-'))
    await writeFile(join(dir, 'index.html'), '<h1>Hello</h1>')
    const assetDir = join(dir, 'assets')
    await mkdir(assetDir, { recursive: true })
    await writeFile(join(assetDir, 'app.js'), 'console.log("hello")')

    try {
      const uploadIds = ['asset-file-id', 'index-file-id', 'manifest-id']
      const fetch = vi.fn(
        async (url: string | URL | Request, init?: RequestInit) => {
          const href = String(url)

          if (href === 'https://hyperbeam.test/~meta@1.0/info/address') {
            return new Response('node-address')
          }

          if (href === 'https://arweave.net/wallet/node-address/balance') {
            return new Response('1')
          }

          if (
            href ===
            'https://hyperbeam.test/~bundler@1.0/item?codec-device=ans104@1.0'
          ) {
            const uploadAttempts = fetch.mock.calls.filter(
              ([calledUrl]) =>
                String(calledUrl) ===
                'https://hyperbeam.test/~bundler@1.0/item?codec-device=ans104@1.0',
            ).length
            const id = uploadIds[uploadAttempts - 1]
            expect(init?.method).toBe('POST')
            if (uploadAttempts === 3) {
              expect(
                Buffer.from(init?.body as Uint8Array).toString(),
              ).toContain('"manifest":"arweave/paths"')
              expect(
                Buffer.from(init?.body as Uint8Array).toString(),
              ).toContain('"index":{"path":"index.html"}')
              expect(
                Buffer.from(init?.body as Uint8Array).toString(),
              ).toContain('"fallback":{"id":"index-file-id"}')
              expect(
                Buffer.from(init?.body as Uint8Array).toString(),
              ).toContain('"assets/app.js":{"id":"asset-file-id"}')
              expect(
                Buffer.from(init?.body as Uint8Array).toString(),
              ).toContain('"index.html":{"id":"index-file-id"}')
            }
            return new Response(JSON.stringify({ id }))
          }

          return new Response('not found', { status: 404 })
        },
      )

      await expect(
        uploadFolder({
          fetch: fetch as typeof globalThis.fetch,
          folder: dir,
          signer: new ArweaveSigner(testJwk()),
          uploader: 'https://hyperbeam.test',
        }),
      ).resolves.toEqual({
        files: {
          'assets/app.js': 'asset-file-id',
          'index.html': 'index-file-id',
        },
        id: 'manifest-id',
        size: anyUploadSize(),
        uploader: 'https://hyperbeam.test',
      })
    } finally {
      await rm(dir, { recursive: true })
    }
  })

  it('uploads a folder and Arweave manifest to the default legacy uploader', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bundlers-legacy-upload-folder-'))
    const assetDir = join(dir, 'assets')
    await mkdir(assetDir, { recursive: true })
    await writeFile(join(dir, 'index.html'), '<h1>Legacy</h1>')
    await writeFile(join(assetDir, 'style.css'), 'body { color: black }')

    try {
      const uploadIds = [
        'legacy-asset-file-id',
        'legacy-index-file-id',
        'legacy-manifest-id',
      ]
      const fetch = vi.fn(
        async (url: string | URL | Request, init?: RequestInit) => {
          expect(String(url)).toBe('https://up.arweave.net/v1/tx/arweave')
          expect(init?.method).toBe('POST')
          const uploadAttempts = fetch.mock.calls.length
          const id = uploadIds[uploadAttempts - 1]

          if (uploadAttempts === 3) {
            expect(Buffer.from(init?.body as Uint8Array).toString()).toContain(
              '"manifest":"arweave/paths"',
            )
            expect(Buffer.from(init?.body as Uint8Array).toString()).toContain(
              '"assets/style.css":{"id":"legacy-asset-file-id"}',
            )
            expect(Buffer.from(init?.body as Uint8Array).toString()).toContain(
              '"fallback":{"id":"legacy-index-file-id"}',
            )
          }

          return new Response(JSON.stringify({ id }))
        },
      )

      await expect(
        legacy_uploadFolder({
          fetch: fetch as typeof globalThis.fetch,
          folder: dir,
          signer: new ArweaveSigner(testJwk()),
        }),
      ).resolves.toEqual({
        files: {
          'assets/style.css': 'legacy-asset-file-id',
          'index.html': 'legacy-index-file-id',
        },
        id: 'legacy-manifest-id',
        size: anyUploadSize(),
        uploader: 'https://up.arweave.net',
      })
    } finally {
      await rm(dir, { recursive: true })
    }
  })

  it('uploads an already-signed ANS-104 item to a pinned HyperBEAM uploader', async () => {
    const signer = new ArweaveSigner(testJwk())
    const signed = await createSignedDataItem('hello', signer)
    const fetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url)

        if (href === 'https://hyperbeam.test/~meta@1.0/info/address') {
          return new Response('node-address')
        }

        if (href === 'https://arweave.net/wallet/node-address/balance') {
          return new Response('1')
        }

        if (
          href ===
          'https://hyperbeam.test/~bundler@1.0/item?codec-device=ans104@1.0'
        ) {
          expect(init?.method).toBe('POST')
          expect(init?.body).toEqual(signed.raw)
          return new Response(JSON.stringify({ id: 'signed-upload-id' }))
        }

        return new Response('not found', { status: 404 })
      },
    )

    await expect(
      uploadSignedDataItem({
        dataItem: signed.raw,
        fetch: fetch as typeof globalThis.fetch,
        uploader: 'https://hyperbeam.test',
      }),
    ).resolves.toEqual({
      id: 'signed-upload-id',
      size: signedUploadSize(),
      uploader: 'https://hyperbeam.test',
    })
  })

  it('uploads a signed stream without buffering the payload in the SDK', async () => {
    const fetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url)

        if (href === 'https://hyperbeam.test/~meta@1.0/info/address') {
          return new Response('node-address')
        }

        if (href === 'https://arweave.net/wallet/node-address/balance') {
          return new Response('1')
        }

        if (
          href ===
          'https://hyperbeam.test/~bundler@1.0/item?codec-device=ans104@1.0'
        ) {
          expect(init?.method).toBe('POST')
          expect(init?.headers).toMatchObject({
            'content-type': 'application/octet-stream',
          })
          expect(
            Number((init?.headers as Record<string, string>)['content-length']),
          ).toBeGreaterThan('stream payload'.length)
          expect(init?.body).toBeInstanceOf(Readable)
          return new Response('{}')
        }

        return new Response('not found', { status: 404 })
      },
    )

    const result = await uploadStream({
      fetch: fetch as typeof globalThis.fetch,
      signer: new ArweaveSigner(testJwk()),
      size: 'stream payload'.length,
      stream: () => Readable.from(['stream payload']),
      tags: [{ name: 'Content-Type', value: 'text/plain' }],
      uploader: 'https://hyperbeam.test',
    })

    expect(result.id).toMatch(/^[a-zA-Z0-9_-]+$/)
    expect(result.uploader).toBe('https://hyperbeam.test')
  })

  it('emits incremental signing and upload progress for stream uploads', async () => {
    const progress: Array<{ loaded: number; phase: string; total: number }> = []
    const fetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url)

        if (href === 'https://hyperbeam.test/~meta@1.0/info/address') {
          return new Response('node-address')
        }

        if (href === 'https://arweave.net/wallet/node-address/balance') {
          return new Response('1')
        }

        if (
          href ===
          'https://hyperbeam.test/~bundler@1.0/item?codec-device=ans104@1.0'
        ) {
          for await (const _chunk of init?.body as unknown as Readable) {
            // Consume the body so the SDK's upload progress stream is exercised.
          }
          return new Response(JSON.stringify({ id: 'stream-progress-id' }))
        }

        return new Response('not found', { status: 404 })
      },
    )

    await uploadStream({
      fetch: fetch as typeof globalThis.fetch,
      onProgress: (event) => progress.push(event),
      signer: new ArweaveSigner(testJwk()),
      size: 'hello world'.length,
      stream: () => Readable.from(['hello', ' ', 'world']),
      uploader: 'https://hyperbeam.test',
    })

    const signing = progress.filter((event) => event.phase === 'signing')
    const uploading = progress.filter((event) => event.phase === 'uploading')

    expect(signing.map((event) => event.loaded)).toEqual([0, 5, 6, 11])
    expect(signing.every((event) => event.total === 11)).toBe(true)
    expect(uploading[0]?.loaded).toBe(0)
    expect(uploading.at(-1)?.loaded).toBe(uploading.at(-1)?.total)
    expect(uploading.at(-1)?.total).toBeGreaterThan(11)
  })

  it('uploads a signed file using a fresh stream body', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bundlers-upload-file-'))
    const file = join(dir, 'payload.txt')
    await writeFile(file, 'file payload')

    try {
      const fetch = vi.fn(
        async (url: string | URL | Request, init?: RequestInit) => {
          const href = String(url)

          if (href === 'https://hyperbeam.test/~meta@1.0/info/address') {
            return new Response('node-address')
          }

          if (href === 'https://arweave.net/wallet/node-address/balance') {
            return new Response('1')
          }

          if (
            href ===
            'https://hyperbeam.test/~bundler@1.0/item?codec-device=ans104@1.0'
          ) {
            expect(init?.method).toBe('POST')
            expect(init?.body).toBeInstanceOf(Readable)
            return new Response(JSON.stringify({ id: 'file-upload-id' }))
          }

          return new Response('not found', { status: 404 })
        },
      )

      await expect(
        uploadFile({
          fetch: fetch as typeof globalThis.fetch,
          file,
          signer: new ArweaveSigner(testJwk()),
          tags: [{ name: 'Content-Type', value: 'text/plain' }],
          uploader: 'https://hyperbeam.test',
        }),
      ).resolves.toEqual({
        id: 'file-upload-id',
        size: uploadSize('file payload'.length),
        uploader: 'https://hyperbeam.test',
      })
    } finally {
      await rm(dir, { recursive: true })
    }
  })

  it('retries transient HyperBEAM upload failures', async () => {
    const retryEvents: Array<{ attempt: number; status?: number }> = []
    const fetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url)

        if (href === 'https://hyperbeam.test/~meta@1.0/info/address') {
          return new Response('node-address')
        }

        if (href === 'https://arweave.net/wallet/node-address/balance') {
          return new Response('1')
        }

        if (
          href ===
          'https://hyperbeam.test/~bundler@1.0/item?codec-device=ans104@1.0'
        ) {
          expect(init?.method).toBe('POST')
          const uploadAttempts = fetch.mock.calls.filter(
            ([calledUrl]) =>
              String(calledUrl) ===
              'https://hyperbeam.test/~bundler@1.0/item?codec-device=ans104@1.0',
          ).length
          if (uploadAttempts === 1) {
            return new Response('temporary outage', { status: 503 })
          }
          return new Response(JSON.stringify({ id: 'retried-upload-id' }))
        }

        return new Response('not found', { status: 404 })
      },
    )

    await expect(
      upload({
        data: 'hello',
        fetch: fetch as typeof globalThis.fetch,
        retry: {
          delayMs: 0,
          onRetry: ({ attempt, status }) => {
            const event: { attempt: number; status?: number } = { attempt }
            if (status !== undefined) event.status = status
            retryEvents.push(event)
          },
          retries: 1,
        },
        signer: new ArweaveSigner(testJwk()),
        uploader: 'https://hyperbeam.test',
      }),
    ).resolves.toEqual({
      id: 'retried-upload-id',
      size: uploadSize(5),
      uploader: 'https://hyperbeam.test',
    })
    expect(retryEvents).toEqual([{ attempt: 1, status: 503 }])
  })

  it('does not retry payment failures', async () => {
    const signer = new ArweaveSigner(testJwk())
    const signed = await createSignedDataItem('hello', signer)
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const href = String(url)

      if (href === 'https://hyperbeam.test/~meta@1.0/info/address') {
        return new Response('node-address')
      }

      if (href === 'https://arweave.net/wallet/node-address/balance') {
        return new Response('1')
      }

      if (
        href ===
        'https://hyperbeam.test/~bundler@1.0/item?codec-device=ans104@1.0'
      ) {
        return new Response('Insufficient funds', { status: 402 })
      }

      return new Response('not found', { status: 404 })
    })

    await expect(
      uploadSignedDataItem({
        dataItem: signed.raw,
        fetch: fetch as typeof globalThis.fetch,
        retry: { delayMs: 0, retries: 3 },
        uploader: 'https://hyperbeam.test',
      }),
    ).rejects.toThrow(/HTTP 402/)
    expect(
      fetch.mock.calls.filter(
        ([calledUrl]) =>
          String(calledUrl) ===
          'https://hyperbeam.test/~bundler@1.0/item?codec-device=ans104@1.0',
      ),
    ).toHaveLength(1)
  })

  it('passes AbortSignal through to HyperBEAM preflight and upload requests', async () => {
    const signal = new AbortController().signal
    const seenSignals: Array<AbortSignal | null | undefined> = []
    const fetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        seenSignals.push(init?.signal)
        const href = String(url)

        if (href === 'https://hyperbeam.test/~meta@1.0/info/address') {
          return new Response('node-address')
        }

        if (href === 'https://arweave.net/wallet/node-address/balance') {
          return new Response('1')
        }

        if (
          href ===
          'https://hyperbeam.test/~bundler@1.0/item?codec-device=ans104@1.0'
        ) {
          return new Response(JSON.stringify({ id: 'signaled-upload-id' }))
        }

        return new Response('not found', { status: 404 })
      },
    )

    await expect(
      upload({
        data: 'hello',
        fetch: fetch as typeof globalThis.fetch,
        signal,
        signer: new ArweaveSigner(testJwk()),
        uploader: 'https://hyperbeam.test',
      }),
    ).resolves.toMatchObject({ id: 'signaled-upload-id' })

    expect(seenSignals).toEqual([signal, signal, signal])
  })

  it('aborts during retry backoff without another upload attempt', async () => {
    const controller = new AbortController()
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const href = String(url)

      if (href === 'https://hyperbeam.test/~meta@1.0/info/address') {
        return new Response('node-address')
      }

      if (href === 'https://arweave.net/wallet/node-address/balance') {
        return new Response('1')
      }

      if (
        href ===
        'https://hyperbeam.test/~bundler@1.0/item?codec-device=ans104@1.0'
      ) {
        return new Response('temporary outage', { status: 503 })
      }

      return new Response('not found', { status: 404 })
    })

    await expect(
      upload({
        data: 'hello',
        fetch: fetch as typeof globalThis.fetch,
        retry: {
          delayMs: 1_000,
          onRetry: () => controller.abort(),
          retries: 2,
        },
        signal: controller.signal,
        signer: new ArweaveSigner(testJwk()),
        uploader: 'https://hyperbeam.test',
      }),
    ).rejects.toThrow(/aborted/i)

    expect(
      fetch.mock.calls.filter(
        ([calledUrl]) =>
          String(calledUrl) ===
          'https://hyperbeam.test/~bundler@1.0/item?codec-device=ans104@1.0',
      ),
    ).toHaveLength(1)
  })
})

async function createSignedDataItem(
  data: string,
  signer: ArweaveSigner,
): Promise<{ raw: Buffer }> {
  const { createData } = await import('@dha-team/arbundles')
  const item = createData(data, signer)
  await item.sign(signer)
  return { raw: Buffer.from(item.getRaw()) }
}
