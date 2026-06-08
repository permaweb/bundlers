# @permaweb/bundlers

Permaweb bundler discovery, funding, and ANS-104 upload SDK.

The package is intended to expose the reusable HyperBEAM upload path currently used by
`permaweb-deploy`:

1. Discover active PermawebOS bundlers.
2. Select a usable bundler.
3. Check that the bundler can seed data to Arweave.
4. Optionally top up local upload credit with `@permaweb/hyperbalance`.
5. Post signed ANS-104 data items to HyperBEAM.

## Planned API

```ts
import { discoverBundlers, upload } from '@permaweb/bundlers'

const bundlers = await discoverBundlers({
  ring: 'permawebos-v0.1-gold',
})

const result = await upload({
  autoFund: true,
  data: new TextEncoder().encode('hello'),
  signer,
  tags: [{ name: 'Content-Type', value: 'text/plain' }],
})

console.log(result.id)
console.log(result.uploader)
console.log(result.cost)
```

Pinned uploader:

```ts
await upload({
  autoFund: true,
  data,
  signer,
  tags,
  uploader: 'https://lapee.hyperzine.xyz',
})
```

## Development

```sh
pnpm install
pnpm run typecheck
pnpm test:run
pnpm run build
```

