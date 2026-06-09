# @permaweb/bundlers

[PermawebOS bundlers](https://ao.arweave.net/#/stake/bundle) funding and data upload SDK.

Published package: [@permaweb/bundlers](https://www.npmjs.com/package/@permaweb/bundlers)

## install

```sh
npm install @permaweb/bundlers
```

## API

### upload data

`upload()` is the main entrypoint. If `uploader` is omitted, it discovers active
PermawebOS bundlers and selects a usable one automatically.

```ts
import { ArweaveSigner, upload } from '@permaweb/bundlers'

const signer = new ArweaveSigner(jwk)

const result = await upload({
  autoFund: true,
  data: new TextEncoder().encode('hello'),
  onProgress: ({ loaded, phase, total }) => {
    console.log(`${phase}: ${loaded}/${total}`)
  },
  signal: AbortSignal.timeout(30_000),
  signer,
  tags: [{ name: 'Content-Type', value: 'text/plain' }],
})

console.log(result.id)
console.log(result.uploader)
console.log(result.cost) // raw AO base units as a bigint
console.log(result.currency) // 'AO'
```

### upload files and streams

Use `uploadFile()` for local files, `uploadStream()` when the payload should
not be buffered fully in memory, and `uploadFolder()` to upload a directory plus
an Arweave manifest. Stream uploads need a fresh readable stream for each call
and the raw payload size in bytes.

```ts
import { uploadFile, uploadFolder, uploadStream } from '@permaweb/bundlers'

await uploadFile({
  autoFund: true,
  file: './video.mp4',
  signer,
  tags: [{ name: 'Content-Type', value: 'video/mp4' }],
})

await uploadStream({
  autoFund: true,
  onProgress: ({ loaded, phase, total }) => {
    console.log(`${phase}: ${loaded}/${total}`)
  },
  signer,
  size,
  stream: () => fs.createReadStream(path),
  tags,
})

const site = await uploadFolder({
  autoFund: true,
  fallbackFile: '404.html',
  folder: './dist',
  indexFile: 'index.html',
  signer,
})

console.log(site.id) // manifest id
console.log(site.files) // path -> uploaded data item id
```

### upload signed dataitem

Upload an already-signed ANS-104 data item:

```ts
import { uploadSignedDataItem } from '@permaweb/bundlers'

const result = await uploadSignedDataItem({
  dataItem: signedDataItemBytes,
  uploader: 'https://lapee.hyperzine.xyz',
})

console.log(result.id)
```

Pinned uploader:

```ts
await upload({
  autoFund: true,
  data,
  retry: true,
  signer,
  tags,
  uploader: 'https://lapee.hyperzine.xyz',
})
```

Retry behavior can be configured per upload. Retries apply to transient upload
POST failures (`408`, `429`, `5xx`, and network errors), not client or payment
errors such as `400` or `402`. If `signal` aborts while waiting between
retries, the upload exits immediately.

```ts
await upload({
  data,
  retry: {
    retries: 3,
    delayMs: 1000,
    maxDelayMs: 30_000,
  },
  signer,
})
```

Apps can call the discovery helper directly when they need to inspect available
bundlers without uploading. Uploads do not need this step; `upload()` runs
selection internally when `uploader` is omitted.

### permawebos bundlers discoverability

```ts
import { discoverBundlers } from '@permaweb/bundlers'

const bundlers = await discoverBundlers()
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

Legacy bundlers are supported through `legacy_upload()`. It does not run HyperBEAM discovery or funding.

```ts
import {
  ArweaveSigner,
  legacy_upload,
  legacy_uploadFile,
  legacy_uploadFolder,
  legacy_uploadStream,
} from '@permaweb/bundlers'

const signer = new ArweaveSigner(jwk)

const result = await legacy_upload({
  data,
  signer,
  tags,
})
```

Legacy file and stream uploads are also available:

```ts
await legacy_uploadFile({
  file: './video.mp4',
  signer,
  tags,
})

await legacy_uploadStream({
  signer,
  size,
  stream: () => fs.createReadStream(path),
  tags,
})

await legacy_uploadFolder({
  fallbackFile: '404.html',
  folder: './dist',
  indexFile: 'index.html',
  signer,
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

## development

```sh
pnpm install
pnpm run typecheck
pnpm test:run
pnpm run build
```

## License

this repository is licensed under the [MIT License](./LICENSE)
