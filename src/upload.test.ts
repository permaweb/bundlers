import { generateKeyPairSync } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { ArweaveSigner, upload } from './index.js'

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
})
