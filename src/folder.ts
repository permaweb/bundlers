import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

import type { BundlerTag } from './types.js'

export const MANIFEST_CONTENT_TYPE = 'application/x.arweave-manifest+json'

export interface FolderFile {
  absolutePath: string
  path: string
}

export async function folderFiles(folder: string): Promise<FolderFile[]> {
  const root = path.resolve(folder)
  const rootStat = await stat(root)

  if (!rootStat.isDirectory()) {
    throw new TypeError(`uploadFolder expected a directory: ${folder}`)
  }

  const files: FolderFile[] = []
  await collectFolderFiles(root, root, files)
  files.sort((left, right) => left.path.localeCompare(right.path))

  if (files.length === 0) {
    throw new Error(`uploadFolder expected at least one file: ${folder}`)
  }

  return files
}

export function folderManifest(options: {
  fallbackFile: string | undefined
  files: Record<string, string>
  indexFile: string | undefined
}): {
  fallback: { id: string }
  index: { path: string }
  manifest: 'arweave/paths'
  paths: Record<string, { id: string }>
  version: '0.2.0'
} {
  const paths = Object.fromEntries(
    Object.entries(options.files).map(([filePath, id]) => [filePath, { id }]),
  )
  const indexPath = normalizeIndexPath(options.files, options.indexFile)
  const fallbackId = normalizeFallbackId({
    fallbackFile: options.fallbackFile,
    files: options.files,
    indexPath,
  })

  return {
    fallback: { id: fallbackId },
    index: { path: indexPath },
    manifest: 'arweave/paths',
    paths,
    version: '0.2.0',
  }
}

export function tagsWithContentType(
  tags: BundlerTag[] | undefined,
  contentType: string,
): BundlerTag[] {
  if (tags?.some((tag) => tag.name.toLowerCase() === 'content-type')) {
    return tags
  }

  return [...(tags ?? []), { name: 'Content-Type', value: contentType }]
}

export function contentTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase()

  return (
    {
      '.avif': 'image/avif',
      '.css': 'text/css',
      '.gif': 'image/gif',
      '.html': 'text/html',
      '.ico': 'image/x-icon',
      '.jpeg': 'image/jpeg',
      '.jpg': 'image/jpeg',
      '.js': 'text/javascript',
      '.json': 'application/json',
      '.mjs': 'text/javascript',
      '.pdf': 'application/pdf',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.txt': 'text/plain',
      '.wasm': 'application/wasm',
      '.webm': 'video/webm',
      '.webp': 'image/webp',
      '.xml': 'application/xml',
    }[extension] ?? 'application/octet-stream'
  )
}

async function collectFolderFiles(
  root: string,
  current: string,
  files: FolderFile[],
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))

  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name)

    if (entry.isDirectory()) {
      await collectFolderFiles(root, absolutePath, files)
      continue
    }

    if (!entry.isFile()) continue

    files.push({
      absolutePath,
      path: normalizeManifestPath(path.relative(root, absolutePath)),
    })
  }
}

function normalizeIndexPath(
  files: Record<string, string>,
  indexFile: string | undefined,
): string {
  if (indexFile !== undefined) {
    const indexPath = normalizeManifestPath(indexFile)
    if (files[indexPath]) return indexPath
  }

  if (files['index.html']) return 'index.html'

  const [firstPath] = Object.keys(files)
  if (!firstPath)
    throw new Error('Cannot create a manifest for an empty folder')
  return firstPath
}

function normalizeFallbackId(options: {
  fallbackFile: string | undefined
  files: Record<string, string>
  indexPath: string
}): string {
  if (options.fallbackFile !== undefined) {
    const fallbackPath = normalizeManifestPath(options.fallbackFile)
    if (options.files[fallbackPath]) return options.files[fallbackPath]
  }

  return options.files['404.html'] ?? options.files[options.indexPath]
}

function normalizeManifestPath(filePath: string): string {
  return filePath
    .split(path.sep)
    .join('/')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
}
