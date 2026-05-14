import { Config } from "./config"
import { error, debug } from "./logger"

function url() {
  return Config.opencode.url.replace(/\/$/, "")
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" }
  if (Config.opencode.password) {
    h["Authorization"] = `Basic ${btoa(`opencode:${Config.opencode.password}`)}`
  }
  if (extra) Object.assign(h, extra)
  return h
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function ocFetch(path: string, opts: RequestInit = {}) {
  const fullUrl = `${url()}${path}`
  let res: Response
  try {
    res = await fetch(fullUrl, {
      ...opts,
      headers: authHeaders(opts.headers as Record<string, string> | undefined),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    error("opencode 连接失败", { url: fullUrl, reason: msg })
    throw err
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    const errMsg = `opencode API 错误 [${path}]: ${res.status} ${text.slice(0, 500)}`
    error(errMsg, { url: fullUrl, status: res.status, body: text.slice(0, 500) })
    throw new Error(errMsg)
  }
  return res
}

const sessionCache = new Map<string, OcSession>()

export function getCachedSession(id: string): OcSession | undefined {
  return sessionCache.get(id)
}

export async function listSessions(): Promise<OcSession[]> {
  const res = await ocFetch("/session")
  const sessions: OcSession[] = await res.json()
  for (const s of sessions) {
    sessionCache.set(s.id, s)
  }
  return sessions
}

export async function createSession(title?: string): Promise<OcSession> {
  const res = await ocFetch("/session", {
    method: "POST",
    body: JSON.stringify({ title: title ?? "飞书对话" }),
  })
  const session: OcSession = await res.json()
  sessionCache.set(session.id, session)
  return session
}

export async function getSession(id: string): Promise<OcSession | null> {
  const cached = sessionCache.get(id)
  if (cached) return cached
  const res = await ocFetch(`/session/${id}`)
  const session: OcSession | null = await res.json()
  if (session) {
    sessionCache.set(session.id, session)
  }
  return session
}

export async function getMessages(sessionId: string): Promise<Array<{ info: OcMessage; parts: OcPart[] }>> {
  const res = await ocFetch(`/session/${sessionId}/message`)
  return res.json()
}

export async function prompt(
  sessionId: string,
  text: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await ocFetch(`/session/${sessionId}/message`, {
    method: "POST",
    body: JSON.stringify({ parts: [{ type: "text", text }] }),
    signal,
  })
  const data = await res.json()
  for (const part of data.parts ?? []) {
    if (part.type === "text") return part.text as string
  }
  return ""
}

export async function promptAsync(
  sessionId: string,
  text: string,
): Promise<void> {
  await ocFetch(`/session/${sessionId}/prompt_async`, {
    method: "POST",
    body: JSON.stringify({ parts: [{ type: "text", text }] }),
  })
}

export function buildStreamContent(parts: OcPart[]): { display: string; rawText: string; isFinal: boolean } {
  const reasoning = parts.find(p => p.type === "reasoning")
  const text = parts.find(p => p.type === "text")
  const toolParts = parts.filter(p => p.type === "tool")
  const finish = parts.find(p => p.type === "step-finish")

  let display = ""
  let rawText = text?.text ?? ""

  if (reasoning?.text) {
    display += `🤔 **分析中...**\n${reasoning.text.slice(0, 2000)}\n\n`
  }
  for (const tp of toolParts) {
    const name = tp.tool?.name ?? "unknown"
    const status = tp.state?.status ?? "running"
    const title = tp.state?.title ?? name
    display += `🔧 **${status === "completed" ? "已完成" : "执行中"}:** ${title}\n`
  }
  if (display) display += "\n"
  if (rawText) {
    display += rawText
  }

  if (!display) {
    display = "🔄 正在思考中..."
  }

  const isFinal = finish?.reason === "stop"

  return { display, rawText, isFinal }
}

export async function streamPrompt(
  sessionId: string,
  userText: string,
  onUpdate: (display: string) => Promise<void>,
  signal?: AbortSignal,
): Promise<string> {
  await promptAsync(sessionId, userText)

  let lastDisplay = "🔄 正在思考中..."
  let finalText = ""

  while (!signal?.aborted) {
    await sleep(2000)

    let msgs: Array<{ info: OcMessage; parts: OcPart[] }>
    try {
      msgs = await getMessages(sessionId)
    } catch {
      continue
    }

    const assistantMsgs = msgs.filter(m => m.info.role === "assistant")
    if (assistantMsgs.length === 0) continue

    const lastMsg = assistantMsgs[assistantMsgs.length - 1]
    const { display, rawText, isFinal } = buildStreamContent(lastMsg.parts)

    if (display !== lastDisplay) {
      lastDisplay = display
      await onUpdate(display).catch(() => {})
    }

    if (rawText) finalText = rawText

    if (isFinal) {
      debug("streamPrompt 完成", { sessionId })
      return finalText
    }
  }

  if (signal?.aborted) throw new Error("Aborted")
  return finalText
}

export async function abortSession(sessionId: string): Promise<void> {
  await ocFetch(`/session/${sessionId}/abort`, { method: "POST" })
}

export interface OcSession {
  id: string
  slug: string
  title: string
  projectID: string
  time: { created: number; updated: number }
  summary?: { additions: number; deletions: number; files: number }
  share?: { url: string }
}

export interface OcMessage {
  id: string
  sessionID: string
  role: string
  time: { created: number }
}

export interface OcPart {
  id: string
  sessionID: string
  messageID: string
  type: string
  text?: string
  reason?: string
  tool?: { name: string; description?: string }
  state?: { status: string; title?: string; input?: Record<string, unknown>; output?: Record<string, unknown> }
}
