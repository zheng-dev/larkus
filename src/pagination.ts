import { join } from "node:path"
import { mkdir } from "node:fs/promises"

const FILE = join(import.meta.dirname!, "..", "data", "pagination.json")
const PAGE_SIZE = 3800
const TTL_MS = 15 * 60 * 1000

interface PageEntry {
  fullText: string
  pageSize: number
  currentPage: number
  createdAt: number
}

let store: Record<string, PageEntry> = {}
let dirty = false

export async function loadPagination(): Promise<void> {
  try {
    const file = Bun.file(FILE)
    if (await file.exists()) {
      const raw: Record<string, PageEntry> = await file.json()
      const now = Date.now()
      for (const [key, entry] of Object.entries(raw)) {
        if (now - entry.createdAt < TTL_MS) {
          store[key] = entry
        }
      }
    }
  } catch {
    store = {}
  }
}

async function save(): Promise<void> {
  if (!dirty) return
  dirty = false
  await mkdir(join(import.meta.dirname!, "..", "data"), { recursive: true })
  await Bun.write(FILE, JSON.stringify(store, null, 2))
}

function totalPages(entry: PageEntry): number {
  return Math.ceil(entry.fullText.length / entry.pageSize)
}

export interface PageResult {
  content: string
  page: number
  total: number
}

export function storeText(key: string, fullText: string, pageSize = PAGE_SIZE): PageResult {
  store[key] = { fullText, pageSize, currentPage: 1, createdAt: Date.now() }
  dirty = true
  save().catch(() => {})
  return getPageResult(store[key], 1)
}

export function getPage(key: string, pageNum?: number): PageResult | null {
  const entry = store[key]
  if (!entry) return null
  if (Date.now() - entry.createdAt > TTL_MS) {
    removePage(key)
    return null
  }
  const total = totalPages(entry)
  const page = pageNum
    ? Math.max(1, Math.min(pageNum, total))
    : Math.min(entry.currentPage + 1, total)
  entry.currentPage = page
  dirty = true
  save().catch(() => {})
  return getPageResult(entry, page)
}

export function removePage(key: string): void {
  delete store[key]
  dirty = true
  save().catch(() => {})
}

function getPageResult(entry: PageEntry, page: number): PageResult {
  const { fullText, pageSize } = entry
  const total = Math.ceil(fullText.length / pageSize)
  const start = (page - 1) * pageSize
  const content = fullText.slice(start, start + pageSize)
  return { content, page, total }
}
