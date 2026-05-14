import { join } from "node:path"

const PENDING_FILE = join(import.meta.dirname!, "..", "data", "pending_cards.json")

export interface PendingEntry {
  sessionId: string
  cardMsgId: string
  timestamp: number
}

let pending: Record<string, PendingEntry> = {}

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

export function addPendingCard(key: string, sessionId: string, cardMsgId: string): void {
  pending[key] = { sessionId, cardMsgId, timestamp: Date.now() }
  save().catch(() => {})
}

export function removePendingCard(key: string): void {
  if (pending[key]) {
    delete pending[key]
    save().catch(() => {})
  }
}

export function getPendingEntries(): Array<{ key: string } & PendingEntry> {
  return Object.entries(pending).map(([key, entry]) => ({ key, ...entry }))
}

export function clearPendingCards(): void {
  pending = {}
  save().catch(() => {})
}
