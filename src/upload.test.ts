import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import {
  ArweaveSigner,
  legacy_upload,
  upload,
  uploadFile,
  uploadSignedDataItem,
  uploadStream,
} from './index.js'

function testJwk(): Record<string, unknown> {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicExponent: 0x10001,
  })

  return privateKey.export({ format: 'jwk' }) as Record<string, unknown>
}

describe('upload', () => {
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
      uploader: 'https://up.arweave.net',
    })
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
          onRetry: ({ attempt, status }) =>
            retryEvents.push({ attempt, status }),
          retries: 1,
        },
        signer: new ArweaveSigner(testJwk()),
        uploader: 'https://hyperbeam.test',
      }),
    ).resolves.toEqual({
      id: 'retried-upload-id',
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
