/**
 * pagination - 长文本分页
 *
 * 当 opencode 返回的文本过长时，将其按固定大小分页存储。
 * 用户可通过 /p 命令逐页查看。数据在 15 分钟后自动过期。
 */
import { join } from "node:path"
import { mkdir } from "node:fs/promises"

const FILE = join(import.meta.dirname!, "..", "data", "pagination.json")
/** 每页字符数 */
const PAGE_SIZE = 3800
/** 分页数据有效期（毫秒） */
const TTL_MS = 15 * 60 * 1000

interface PageEntry {
  fullText: string
  pageSize: number
  currentPage: number
  createdAt: number
}

let store: Record<string, PageEntry> = {}
let dirty = false

/** 从 data/pagination.json 加载分页数据，自动清理过期条目 */
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

/** 分页查询结果 */
export interface PageResult {
  content: string
  page: number
  total: number
}

/** 存储文本并返回第一页内容 */
export function storeText(key: string, fullText: string, pageSize = PAGE_SIZE): PageResult {
  store[key] = { fullText, pageSize, currentPage: 1, createdAt: Date.now() }
  dirty = true
  save().catch(() => {})
  return getPageResult(store[key], 1)
}

/** 获取指定页内容，未指定页码时返回下一页 */
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

/** 删除指定 key 的分页数据 */
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
