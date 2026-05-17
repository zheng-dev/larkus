/**
 * session - 聊天线程与 opencode Session 绑定管理
 *
 * 维护飞书聊天线程（chatId:rootId）到 opencode Session ID 的映射关系。
 * 绑定关系持久化到 data/bindings.json，支持增删查操作。
 */
import { join } from "node:path"
import { mkdir } from "node:fs/promises"

const BINDINGS_FILE = join(import.meta.dirname!, "..", "data", "bindings.json")

type BindingMap = Record<string, string>

let bindings: BindingMap = {}
/** 标记绑定是否已修改，用于延迟写入 */
let dirty = false

function bindingKey(chatId: string, rootId: string): string {
  return `${chatId}:${rootId || ""}`
}

/** 从 data/bindings.json 加载绑定关系 */
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

/** 获取聊天线程绑定的 Session ID */
export function getBinding(chatId: string, rootId: string): string | undefined {
  return bindings[bindingKey(chatId, rootId)]
}

/** 设置聊天线程与 Session 的绑定（自动持久化） */
export function setBinding(chatId: string, rootId: string, sessionId: string): void {
  bindings[bindingKey(chatId, rootId)] = sessionId
  dirty = true
  saveBindings().catch(err => console.error("保存 bindings 失败:", err))
}

/** 移除聊天线程的 Session 绑定（自动持久化） */
export function removeBinding(chatId: string, rootId: string): void {
  delete bindings[bindingKey(chatId, rootId)]
  dirty = true
  saveBindings().catch(err => console.error("保存 bindings 失败:", err))
}
