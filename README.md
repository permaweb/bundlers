# @permaweb/bundlers

[PermawebOS bundlers](https://ao.arweave.net/#/stake/bundle) funding and data upload SDK.

## API

`upload()` is the main entrypoint. If `uploader` is omitted, it discovers active
PermawebOS bundlers and selects a usable one automatically.

```ts
import { ArweaveSigner, upload } from '@permaweb/bundlers'

const signer = new ArweaveSigner(jwk)

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

Apps can call the discovery helper directly when they need to inspect available
bundlers without uploading. Uploads do not need this step; `upload()` runs
selection internally when `uploader` is omitted.

```ts
import { discoverBundlers } from '@permaweb/bundlers'

const bundlers = await discoverBundlers({
  endpoint: 'https://push-9.forward.computer',
  pid: 'Xv7dvev8_dJVwW7k_VGGdHpRqWpgSCgK4vzJmnBkg5M',
})
```

Automatic selection can be narrowed from `upload()`:

```ts
await upload({
  autoFund: true,
  data,
  selection: {
    endpoint: 'https://push-9.forward.computer',
    pid: 'Xv7dvev8_dJVwW7k_VGGdHpRqWpgSCgK4vzJmnBkg5M',
  },
  signer,
  tags,
})
```

The upload API accepts an Arweave signer:

```ts
await upload({
  autoFund: true,
  data,
  signer,
  tags,
})
```

The SDK also re-exports `ArweaveSigner` as the ANS-104 signing primitive used
by `upload()`. Auto-fund uses the same signer to create AO transfer messages
through `@permaweb/aoconnect`.

### legacy bundlers

Legacy bundlers are supported through `legacy_upload()`.it does not run HyperBEAM discovery or funding.

```ts
import { ArweaveSigner, legacy_upload } from '@permaweb/bundlers'

const signer = new ArweaveSigner(jwk)

const result = await legacy_upload({
  data,
  signer,
  tags,
})
```

The default legacy bundler is `https://up.arweave.net`. A custom
legacy uploader can be pinned:

```ts
await legacy_upload({
  data,
  signer,
  tags,
  uploader: 'https://upload.example.com',
})
```

## Development

```sh
pnpm install
pnpm run typecheck
pnpm test:run
pnpm run build
```

## License
this repository is licensed under the [MIT License](./LICENSE)