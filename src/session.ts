import { join } from "node:path"
import { mkdir } from "node:fs/promises"

const BINDINGS_FILE = join(import.meta.dirname!, "..", "data", "bindings.json")

type BindingMap = Record<string, string>

let bindings: BindingMap = {}
let dirty = false

function bindingKey(chatId: string, rootId: string): string {
  return `${chatId}:${rootId || ""}`
}

export async function loadBindings(): Promise<void> {
  try {
    const file = Bun.file(BINDINGS_FILE)
    if (await file.exists()) {
      bindings = await file.json()
    }
  } catch (err) {
    console.error("加载 bindings 失败:", err)
    bindings = {}
  }
}

async function saveBindings(): Promise<void> {
  if (!dirty) return
  dirty = false
  await mkdir(join(import.meta.dirname!, "..", "data"), { recursive: true })
  await Bun.write(BINDINGS_FILE, JSON.stringify(bindings, null, 2))
}

export function getBinding(chatId: string, rootId: string): string | undefined {
  return bindings[bindingKey(chatId, rootId)]
}

export function setBinding(chatId: string, rootId: string, sessionId: string): void {
  bindings[bindingKey(chatId, rootId)] = sessionId
  dirty = true
  saveBindings().catch(err => console.error("保存 bindings 失败:", err))
}

export function removeBinding(chatId: string, rootId: string): void {
  delete bindings[bindingKey(chatId, rootId)]
  dirty = true
  saveBindings().catch(err => console.error("保存 bindings 失败:", err))
}
