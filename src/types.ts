export interface BundlerTag {
  name: string
  value: string
}

export interface UploadResult {
  /** Raw currency base-unit amount returned by Hyperbalance. */
  cost?: bigint
  currency?: 'AO'
  id: string
  uploader: string
}

export interface UploadFolderResult extends UploadResult {
  files: Record<string, string>
}

export interface UploadRetryContext {
  attempt: number
  delayMs: number
  error?: unknown
  status?: number
}

export interface UploadRetryOptions {
  /**
   * Number of retry attempts after the initial request.
   * `retry: true` uses 3 retries.
   */
  retries?: number
  /**
   * Initial backoff delay in milliseconds.
   * `retry: true` uses 1000ms.
   */
  delayMs?: number
  /**
   * Maximum backoff delay in milliseconds.
   * `retry: true` uses 30000ms.
   */
  maxDelayMs?: number
  onRetry?: (context: UploadRetryContext) => void
}

export interface UploadProgressContext {
  loaded: number
  phase: 'signing' | 'uploading'
  total: number
}

export type UploadProgressCallback = (context: UploadProgressContext) => void

export interface UploadAutoFundOptions {
  aoPollMs?: number
  aoStateUrl?: string
  aoTimeoutMs?: number
  ledgerId?: string
  minimumBalance?: bigint
  quoteAction?: string
  tokenId?: string
}

export interface UploadSelectionOptions {
  endpoint?: string
  pid?: string
}

export interface UploadSigner {
  ownerLength: number
  publicKey: Uint8Array
  signatureLength: number
  signatureType: number
  sign(message: Uint8Array): Promise<Uint8Array> | Uint8Array
}

export interface UploadOptions {
  autoFund?: boolean | UploadAutoFundOptions
  data: ArrayBuffer | Uint8Array | string
  fetch?: typeof fetch
  onProgress?: UploadProgressCallback
  retry?: boolean | UploadRetryOptions
  signal?: AbortSignal
  selection?: UploadSelectionOptions
  signer: UploadSigner
  tags?: BundlerTag[]
  uploadPath?: string
  uploader?: string
}

export interface UploadFileOptions extends Omit<UploadOptions, 'data'> {
  file: string
}

export interface UploadFolderOptions extends Omit<UploadOptions, 'data'> {
  fallbackFile?: string
  folder: string
  indexFile?: string
  manifestTags?: BundlerTag[]
}

export interface UploadStreamOptions extends Omit<UploadOptions, 'data'> {
  size: number
  stream: () => NodeJS.ReadableStream
}

export interface UploadSignedDataItemOptions {
  dataItem: ArrayBuffer | Uint8Array
  fetch?: typeof fetch
  id?: string
  onProgress?: UploadProgressCallback
  retry?: boolean | UploadRetryOptions
  signal?: AbortSignal
  selection?: UploadSelectionOptions
  uploadPath?: string
  uploader?: string
}

export interface LegacyUploadOptions {
  data: ArrayBuffer | Uint8Array | string
  fetch?: typeof fetch
  onProgress?: UploadProgressCallback
  retry?: boolean | UploadRetryOptions
  signal?: AbortSignal
  signer: UploadSigner
  tags?: BundlerTag[]
  token?: string
  uploader?: string
}

export interface LegacyUploadFileOptions extends Omit<
  LegacyUploadOptions,
  'data'
> {
  file: string
}

export interface LegacyUploadFolderOptions extends Omit<
  LegacyUploadOptions,
  'data'
> {
  fallbackFile?: string
  folder: string
  indexFile?: string
  manifestTags?: BundlerTag[]
}

export interface LegacyUploadStreamOptions extends Omit<
  LegacyUploadOptions,
  'data'
> {
  size: number
  stream: () => NodeJS.ReadableStream
}
