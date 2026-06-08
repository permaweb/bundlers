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

export interface UploadOptions {
  autoFund?: boolean
  data: ArrayBuffer | Uint8Array | string
  signer: unknown
  tags?: BundlerTag[]
  uploader?: string
}

