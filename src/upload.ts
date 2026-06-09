import { createHash, randomInt } from 'node:crypto'
import { createRequire } from 'node:module'

import { message as aoMessage } from '@permaweb/aoconnect'
import {
  AoTokenTransferAdapter,
  DEFAULT_AO_TOKEN_ID,
  discoverHyperbeamAoBundlerProfile,
  HyperbalanceClient,
  waitForAoAssignmentSlot,
} from '@permaweb/hyperbalance'

import {
  discoverBundlers,
  type ActivePermawebOSBundler,
} from './permawebos-bundlers.js'
import type {
  LegacyUploadOptions,
  UploadAutoFundOptions,
  UploadOptions,
  UploadResult,
  UploadRetryOptions,
  UploadSigner,
  UploadSignedDataItemOptions,
} from './types.js'

const require = createRequire(import.meta.url)
const { DataItem, createData } = require('@dha-team/arbundles') as {
  DataItem: new (raw: Buffer) => { id: string | Uint8Array }
  createData: (
    data: Buffer,
    signer: UploadSigner,
    opts?: { tags?: Array<{ name: string; value: string }> },
  ) => {
    getRaw: () => Uint8Array
    id?: string
    sign: (signer: UploadSigner) => Promise<void>
  }
}

const ARWEAVE_GATEWAY = 'https://arweave.net'
const ARWEAVE_OWNER_LENGTH = 512
const ARWEAVE_SIGNATURE_LENGTH = 512
const ARWEAVE_SIGNATURE_TYPE = 1
export const DEFAULT_LEGACY_UPLOADER = 'https://up.arweave.net'
const DEFAULT_LEGACY_TOKEN = 'arweave'
const DEFAULT_HYPERBEAM_UPLOAD_PATH =
  '/~bundler@1.0/item?codec-device=ans104@1.0'
const DEFAULT_RETRY_DELAY_MS = 1000
const DEFAULT_RETRY_MAX_DELAY_MS = 30_000
const DEFAULT_RETRY_RETRIES = 3

interface Quote {
  amount: bigint
  ledgerId?: string
  tokenId?: string
}

export async function upload(options: UploadOptions): Promise<UploadResult> {
  const fetchImpl = options.fetch ?? fetch
  const selectionOptions: Parameters<typeof selectBundler>[0] = {
    fetch: fetchImpl,
  }
  if (options.selection?.endpoint)
    selectionOptions.endpoint = options.selection.endpoint
  if (options.selection?.pid) selectionOptions.pid = options.selection.pid

  const uploader = options.uploader ?? (await selectBundler(selectionOptions))
  assertArweaveSigner(options.signer)

  const signed = await signDataItem({
    data: options.data,
    signer: options.signer,
    tags: options.tags,
  })
  const autoFund = normalizeAutoFundOptions(options.autoFund)
  let autoFundUnavailable: string | undefined
  let cost: bigint | undefined
  let quote: Quote | undefined

  if (autoFund) {
    try {
      quote = await quoteUpload({
        autoFund,
        fetch: fetchImpl,
        signedBytes: signed.raw.length,
        uploader,
      })
      cost = quote.amount
    } catch (error) {
      autoFundUnavailable = cleanErrorMessage(error)
    }
  }

  await preflightBundlerArBalance(uploader, fetchImpl)

  if (autoFund && quote) {
    await ensureUploadCredit({
      autoFund,
      fetch: fetchImpl,
      quote,
      signer: options.signer,
      uploader,
    })
  }

  const uploadUrl = hyperbeamUploadUrl(
    uploader,
    options.uploadPath ?? DEFAULT_HYPERBEAM_UPLOAD_PATH,
  )
  const postOptions: Parameters<typeof postDataItem>[2] = {
    fetch: fetchImpl,
    localId: signed.localId,
  }
  if (autoFundUnavailable) postOptions.paymentContext = autoFundUnavailable
  if (options.retry !== undefined) postOptions.retry = options.retry

  const posted = await postDataItem(uploadUrl, signed.raw, postOptions)

  return {
    ...(cost ? { cost, currency: 'AO' as const } : {}),
    id: posted.id || signed.localId,
    uploader,
  }
}

export async function uploadSignedDataItem(
  options: UploadSignedDataItemOptions,
): Promise<UploadResult> {
  const fetchImpl = options.fetch ?? fetch
  const selectionOptions: Parameters<typeof selectBundler>[0] = {
    fetch: fetchImpl,
  }
  if (options.selection?.endpoint)
    selectionOptions.endpoint = options.selection.endpoint
  if (options.selection?.pid) selectionOptions.pid = options.selection.pid

  const uploader = options.uploader ?? (await selectBundler(selectionOptions))
  const raw = toBuffer(options.dataItem)
  const localId = options.id ?? dataItemId(raw)

  await preflightBundlerArBalance(uploader, fetchImpl)

  const uploadUrl = hyperbeamUploadUrl(
    uploader,
    options.uploadPath ?? DEFAULT_HYPERBEAM_UPLOAD_PATH,
  )
  const postOptions: Parameters<typeof postDataItem>[2] = {
    fetch: fetchImpl,
    localId,
  }
  if (options.retry !== undefined) postOptions.retry = options.retry

  const posted = await postDataItem(uploadUrl, raw, postOptions)

  return {
    id: posted.id || localId,
    uploader,
  }
}

export async function legacy_upload(
  options: LegacyUploadOptions,
): Promise<UploadResult> {
  const fetchImpl = options.fetch ?? fetch
  const uploader = options.uploader ?? DEFAULT_LEGACY_UPLOADER
  assertArweaveSigner(options.signer)

  const signed = await signDataItem({
    data: options.data,
    signer: options.signer,
    tags: options.tags,
  })
  const uploadUrl = legacyUploadUrl(
    uploader,
    options.token ?? DEFAULT_LEGACY_TOKEN,
  )
  const postOptions: Parameters<typeof postLegacyDataItem>[2] = {
    fetch: fetchImpl,
    localId: signed.localId,
  }
  if (options.retry !== undefined) postOptions.retry = options.retry

  const posted = await postLegacyDataItem(uploadUrl, signed.raw, postOptions)

  return {
    id: posted.id || signed.localId,
    uploader,
  }
}

export async function selectBundler(options: {
  endpoint?: string
  fetch?: typeof fetch
  pid?: string
}): Promise<string> {
  const uploaders = randomized(await discoverBundlers(options))
  const failures: string[] = []

  for (const uploader of uploaders) {
    try {
      await preflightBundlerArBalance(uploader.url, options.fetch ?? fetch)
      return uploader.url
    } catch (error) {
      failures.push(`${uploader.url}: ${cleanErrorMessage(error)}`)
    }
  }

  throw new Error(
    [
      'No active HyperBEAM uploaders with spendable AR found.',
      failures.length > 0 ? failures.join('\n') : undefined,
    ]
      .filter(Boolean)
      .join('\n'),
  )
}

export async function preflightBundlerArBalance(
  uploader: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const nodeUrl = uploader.replace(/\/+$/, '')
  const addressRes = await fetchImpl(`${nodeUrl}/~meta@1.0/info/address`)
  if (!addressRes.ok) {
    throw new Error(
      `HyperBEAM bundler address check failed with HTTP ${addressRes.status}`,
    )
  }

  const address = (await addressRes.text()).trim()
  if (!address) {
    throw new Error('HyperBEAM bundler address check returned an empty address')
  }

  const balanceRes = await fetchImpl(
    `${ARWEAVE_GATEWAY}/wallet/${encodeURIComponent(address)}/balance`,
  )
  if (!balanceRes.ok) {
    throw new Error(
      `HyperBEAM bundler AR balance check failed with HTTP ${balanceRes.status}`,
    )
  }

  const balance = (await balanceRes.text()).trim()
  if (!/^\d+$/.test(balance)) {
    throw new Error(
      'HyperBEAM bundler AR balance check returned an invalid balance',
    )
  }

  if (BigInt(balance) === 0n) {
    throw new Error(
      `HyperBEAM bundler wallet ${address} has 0 AR; upload aborted because the node cannot seed data to Arweave.`,
    )
  }
}

export function hyperbeamUploadUrl(base: string, uploadPath: string): string {
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  const cleanPath = uploadPath.startsWith('/')
    ? uploadPath.slice(1)
    : uploadPath
  return new URL(cleanPath, normalizedBase).toString()
}

export function legacyUploadUrl(
  base: string,
  token = DEFAULT_LEGACY_TOKEN,
): string {
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  return new URL(`v1/tx/${token}`, normalizedBase).toString()
}

function randomized(
  uploaders: ActivePermawebOSBundler[],
): ActivePermawebOSBundler[] {
  const candidates = [...uploaders]

  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1)
    const current = candidates[index]
    const replacement = candidates[swapIndex]
    candidates[index] = replacement
    candidates[swapIndex] = current
  }

  return candidates
}

function normalizeAutoFundOptions(
  autoFund: UploadOptions['autoFund'],
): UploadAutoFundOptions | undefined {
  if (!autoFund) return undefined
  return typeof autoFund === 'boolean' ? {} : autoFund
}

function toBuffer(data: UploadOptions['data']): Buffer {
  if (typeof data === 'string') return Buffer.from(data)
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
}

function toBase64Url(value: string | Uint8Array): string {
  if (typeof value === 'string') return value
  return Buffer.from(value).toString('base64url')
}

async function signDataItem(options: {
  data: UploadOptions['data']
  signer: UploadSigner
  tags: Array<{ name: string; value: string }> | undefined
}): Promise<{ localId: string; raw: Buffer }> {
  const item = createData(toBuffer(options.data), options.signer, {
    tags: options.tags ?? [],
  })
  await item.sign(options.signer)

  const raw = Buffer.from(item.getRaw())
  const localId = item.id || dataItemId(raw)

  return { localId, raw }
}

function dataItemId(raw: Buffer): string {
  return toBase64Url(new DataItem(raw).id)
}

async function quoteUpload(options: {
  autoFund: UploadAutoFundOptions
  fetch: typeof fetch
  signedBytes: number
  uploader: string
}): Promise<Quote> {
  const profileOptions: {
    ledgerId?: string
    nodeUrl: string
    tokenId?: string
  } = {
    nodeUrl: options.uploader,
  }
  if (options.autoFund.ledgerId)
    profileOptions.ledgerId = options.autoFund.ledgerId
  if (options.autoFund.tokenId)
    profileOptions.tokenId = options.autoFund.tokenId

  const profile = await discoverHyperbeamAoBundlerProfile(profileOptions)
  const quote = await new HyperbalanceClient({
    fetch: options.fetch,
    nodeUrl: options.uploader,
  }).quoteAuto({
    action: options.autoFund.quoteAction ?? 'hyperbeam-upload',
    params: { bytes: options.signedBytes },
    profile,
  })

  return {
    amount: quote.amount,
    ...(quote.ledgerId ? { ledgerId: quote.ledgerId } : {}),
    ...(quote.tokenId ? { tokenId: quote.tokenId } : {}),
  }
}

async function ensureUploadCredit(options: {
  autoFund: UploadAutoFundOptions
  fetch: typeof fetch
  quote: Quote
  signer: UploadSigner
  uploader: string
}): Promise<void> {
  const ledgerId = options.autoFund.ledgerId ?? options.quote.ledgerId
  const tokenId = options.autoFund.tokenId ?? options.quote.tokenId
  const profileOptions: {
    ledgerId?: string
    nodeUrl: string
    tokenId?: string
  } = {
    nodeUrl: options.uploader,
  }
  if (ledgerId) profileOptions.ledgerId = ledgerId
  if (tokenId) profileOptions.tokenId = tokenId

  const profile = await discoverHyperbeamAoBundlerProfile(profileOptions)
  const recipient = arweaveAddressFromSigner(options.signer)
  const signer = createAoDataItemSigner(options.signer)
  const adapter = new AoTokenTransferAdapter({
    async inferSender() {
      return recipient
    },
    async message(input) {
      return aoMessage({
        data: input.data ?? '',
        process: input.process,
        signer,
        tags: input.tags,
      })
    },
    async waitForAssignmentSlot(messageId, context) {
      const waitOptions: {
        messageId: string
        pollMs?: number
        processId: string
        stateUrl?: string
        timeoutMs?: number
      } = {
        messageId,
        processId: context.processId,
      }
      if (options.autoFund.aoPollMs !== undefined)
        waitOptions.pollMs = options.autoFund.aoPollMs
      if (options.autoFund.aoStateUrl)
        waitOptions.stateUrl = options.autoFund.aoStateUrl
      if (options.autoFund.aoTimeoutMs !== undefined) {
        waitOptions.timeoutMs = options.autoFund.aoTimeoutMs
      }

      return waitForAoAssignmentSlot(waitOptions)
    },
  })

  const request: Parameters<HyperbalanceClient['ensureCreditAuto']>[0] = {
    minimumBalance: options.autoFund.minimumBalance ?? options.quote.amount,
    profile,
    recipient,
    tokenId: tokenId ?? DEFAULT_AO_TOKEN_ID,
    transferAdapter: adapter,
  }
  if (ledgerId) request.ledgerId = ledgerId

  await new HyperbalanceClient({
    fetch: options.fetch,
    nodeUrl: options.uploader,
  }).ensureCreditAuto(request)
}

function assertArweaveSigner(signer: UploadSigner): void {
  if (
    signer.signatureType !== ARWEAVE_SIGNATURE_TYPE ||
    signer.ownerLength !== ARWEAVE_OWNER_LENGTH ||
    signer.signatureLength !== ARWEAVE_SIGNATURE_LENGTH
  ) {
    throw new TypeError(
      'Only Arweave ANS-104 signers are supported. Use new ArweaveSigner(jwk).',
    )
  }
}

function arweaveAddressFromSigner(signer: UploadSigner): string {
  return createHash('sha256')
    .update(Buffer.from(signer.publicKey))
    .digest('base64url')
}

function createAoDataItemSigner(
  signer: UploadSigner,
): (...args: unknown[]) => Promise<{ address: string; signature: Buffer }> {
  const address = arweaveAddressFromSigner(signer)
  const publicKey = Buffer.from(signer.publicKey)

  return async (...args: unknown[]) => {
    const [create, kind] = args
    if (typeof create !== 'function') {
      throw new TypeError('AO signer create callback is missing')
    }
    if (kind !== 'ans104') {
      throw new Error(`signer kind unknown "${kind}"`)
    }

    const deepHash = (await create({
      alg: 'rsa-v1_5-sha256',
      publicKey,
      type: ARWEAVE_SIGNATURE_TYPE,
    })) as Uint8Array
    const signature = await signer.sign(deepHash)

    return { address, signature: Buffer.from(signature) }
  }
}

async function postDataItem(
  uploadUrl: string,
  raw: Buffer,
  options: {
    fetch: typeof fetch
    localId: string
    paymentContext?: string
    retry?: boolean | UploadRetryOptions
  },
): Promise<{ id?: string }> {
  return withRetry(options.retry, async () => {
    const res = await options.fetch(uploadUrl, {
      body: raw as unknown as BodyInit,
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/octet-stream',
      },
      method: 'POST',
    })
    const body = await res.text()

    if (!res.ok) {
      const context = options.paymentContext
        ? `\n\nAuto-fund compatibility check failed: ${options.paymentContext}\nAttempted direct upload instead.`
        : ''
      throw new UploadRequestError(
        `HyperBEAM bundler upload failed for local data item ${options.localId} with HTTP ${res.status}${responsePreview(body)}${context}`,
        res.status,
      )
    }

    const id = responseId(res.headers, body)
    return id ? { id } : {}
  })
}

async function postLegacyDataItem(
  uploadUrl: string,
  raw: Buffer,
  options: {
    fetch: typeof fetch
    localId: string
    retry?: boolean | UploadRetryOptions
  },
): Promise<{ id?: string }> {
  return withRetry(options.retry, async () => {
    const res = await options.fetch(uploadUrl, {
      body: raw as unknown as BodyInit,
      headers: {
        'content-length': String(raw.length),
        'content-type': 'application/octet-stream',
      },
      method: 'POST',
    })
    const body = await res.text()

    if (!res.ok) {
      throw new UploadRequestError(
        `Legacy bundler upload failed for local data item ${options.localId} with HTTP ${res.status}${responsePreview(body)}`,
        res.status,
      )
    }

    const id = responseId(res.headers, body)
    return id ? { id } : {}
  })
}

class UploadRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'UploadRequestError'
  }
}

async function withRetry<T>(
  retry: boolean | UploadRetryOptions | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  const config = normalizeRetryOptions(retry)
  let attempt = 0

  for (;;) {
    try {
      return await operation()
    } catch (error) {
      if (
        !config ||
        attempt >= config.retries ||
        !isRetryableUploadError(error)
      ) {
        throw error
      }

      attempt += 1
      const delayMs = retryDelayMs(config, attempt)
      config.onRetry?.({
        attempt,
        delayMs,
        error,
        ...(error instanceof UploadRequestError
          ? { status: error.status }
          : {}),
      })
      await sleep(delayMs)
    }
  }
}

function normalizeRetryOptions(
  retry: boolean | UploadRetryOptions | undefined,
): NormalizedRetryOptions | undefined {
  if (!retry) return undefined
  if (retry === true) {
    return {
      delayMs: DEFAULT_RETRY_DELAY_MS,
      maxDelayMs: DEFAULT_RETRY_MAX_DELAY_MS,
      retries: DEFAULT_RETRY_RETRIES,
    }
  }

  const normalized: NormalizedRetryOptions = {
    delayMs: retry.delayMs ?? DEFAULT_RETRY_DELAY_MS,
    maxDelayMs: retry.maxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS,
    retries: retry.retries ?? DEFAULT_RETRY_RETRIES,
  }
  if (retry.onRetry) normalized.onRetry = retry.onRetry
  return normalized
}

interface NormalizedRetryOptions {
  delayMs: number
  maxDelayMs: number
  onRetry?: UploadRetryOptions['onRetry']
  retries: number
}

function retryDelayMs(retry: NormalizedRetryOptions, attempt: number): number {
  return Math.min(retry.delayMs * 2 ** (attempt - 1), retry.maxDelayMs)
}

function isRetryableUploadError(error: unknown): boolean {
  if (error instanceof UploadRequestError) {
    return (
      error.status === 408 ||
      error.status === 429 ||
      (error.status >= 500 && error.status < 600)
    )
  }

  return error instanceof Error
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function responseId(headers: Headers, body: string): string | undefined {
  const headerId = headers.get('id')
  if (headerId) return headerId

  try {
    const parsed = JSON.parse(body) as { body?: { id?: string }; id?: string }
    return parsed.id || parsed.body?.id
  } catch {
    return undefined
  }
}

function responsePreview(body: string): string {
  const preview = body.replaceAll(/\s+/g, ' ').trim()
  if (!preview) return ''
  if (/^(<!doctype html\b|<html\b)/i.test(preview))
    return ': HTML error response'
  return `: ${preview.slice(0, 300)}`
}

function cleanErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const jsonStart = message.indexOf('{')
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(message.slice(jsonStart)) as { error?: string }
      if (parsed.error) return parsed.error.replace(/^Error:\s*/, '')
    } catch {
      return message
    }
  }

  return message
}
