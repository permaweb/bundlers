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
        ring: 'permawebos-v0.1-gold',
        stake: '25000000000000',
        url: 'https://lapee.hyperzine.xyz',
      },
    ])
  })

  it('uses the configured endpoint and pid', async () => {
    const fetch = createFetch({ active: {}, registered: {} })

    await discoverBundlers({
      endpoint: 'https://push.example/',
      fetch,
      pid: 'staking-process',
    })

    expect(fetch).toHaveBeenCalledWith(
      'https://push.example/staking-process/compute/active?require-codec=application/json&accept-bundle=true',
      expect.any(Object),
    )
    expect(fetch).toHaveBeenCalledWith(
      'https://push.example/staking-process/compute/registered?require-codec=application/json&accept-bundle=true',
      expect.any(Object),
    )
  })
})
