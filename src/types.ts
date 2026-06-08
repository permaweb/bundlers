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
  selection?: UploadSelectionOptions
  signer: UploadSigner
  tags?: BundlerTag[]
  uploadPath?: string
  uploader?: string
}
