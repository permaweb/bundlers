import { describe, expect, it, vi } from 'vitest'

import { discoverBundlers } from './permawebos-bundlers.js'

const lapeeAddressKey = 'lapee_address'

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: vi.fn(async () => JSON.stringify(body)),
  }
}

function createFetch(state: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const match = url.match(/\/compute\/([^?]+)/)
    const path = match?.[1] ?? ''
    return jsonResponse(state[path])
  })
}

describe('discoverBundlers', () => {
  it('returns active registered bundlers and excludes dev-1', async () => {
    const fetch = createFetch({
      active: {
        'owner-a': {
          [lapeeAddressKey]: 'node-a',
          ring: 'permawebos-v0.1-gold',
          stake: '25000000000000',
        },
        'owner-b': {
          [lapeeAddressKey]: 'node-b',
          ring: 'permawebos-v0.1-gold',
          stake: '25000000000000',
        },
      },
      registered: {
        'node-a': {
          location: 'https://dev-1.forward.computer/',
          owner: 'owner-a',
        },
        'node-b': {
          location: 'https://lapee.hyperzine.xyz',
          owner: 'owner-b',
        },
      },
    })

    await expect(discoverBundlers({ fetch })).resolves.toEqual([
      {
        address: 'node-b',
        owner: 'owner-b',
        registeredAt: undefined,
        ring: 'permawebos-v0.1-gold',
        stake: '25000000000000',
        stakedAt: undefined,
        url: 'https://lapee.hyperzine.xyz',
      },
    ])
  })
}
