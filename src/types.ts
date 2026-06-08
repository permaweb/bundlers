export interface BundlerTag {
  name: string
  value: string
}

export interface UploadCost {
  amount: bigint
  token: 'AO'
}

export interface UploadResult {
  cost?: UploadCost
  id: string
  uploader: string
}

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

export interface UploadOptions {
  autoFund?: boolean | UploadAutoFundOptions
  data: ArrayBuffer | Uint8Array | string
  fetch?: typeof fetch
  jwk: Record<string, unknown>
  selection?: UploadSelectionOptions
  tags?: BundlerTag[]
  uploadPath?: string
  uploader?: string
}
