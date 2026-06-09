import { generateKeyPairSync } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import {
  ArweaveSigner,
  legacy_upload,
  upload,
  uploadSignedDataItem,
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
