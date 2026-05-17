/**
 * pending_cards - 孤儿卡片追踪
 *
 * 服务发出消息卡片后，若在结果返回前重启，卡片将处于"思考中"状态。
 * 本模块将未完成的卡片记录持久化，供启动时恢复。
 */
import { join } from "node:path"

/** 孤儿卡片持久化文件路径 */
const PENDING_FILE = join(import.meta.dirname!, "..", "data", "pending_cards.json")

/** 孤儿卡片记录 */
export interface PendingEntry {
  sessionId: string
  cardMsgId: string
  timestamp: number
}

let pending: Record<string, PendingEntry> = {}

/** 从 data/pending_cards.json 加载未完成的卡片记录 */
export async function loadPendingCards(): Promise<void> {
  try {
    const file = Bun.file(PENDING_FILE)
    if (await file.exists()) {
      pending = await file.json()
    }
  } catch {
    pending = {}
  }
}

async function save(): Promise<void> {
  await Bun.write(PENDING_FILE, JSON.stringify(pending, null, 2))
}

/** 记录一个待完成的卡片 */
export function addPendingCard(key: string, sessionId: string, cardMsgId: string): void {
  pending[key] = { sessionId, cardMsgId, timestamp: Date.now() }
  save().catch(() => {})
}

/** 移除已完成的卡片记录 */
export function removePendingCard(key: string): void {
  if (pending[key]) {
    delete pending[key]
    save().catch(() => {})
  }
}

/** 获取所有未完成的卡片条目（含 key） */
export function getPendingEntries(): Array<{ key: string } & PendingEntry> {
  return Object.entries(pending).map(([key, entry]) => ({ key, ...entry }))
}

/** 清空所有待完成的卡片记录 */
export function clearPendingCards(): void {
  pending = {}
  save().catch(() => {})
}
