import { Config } from "./config"
import { error } from "./logger"

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

export async function listSessions(): Promise<OcSession[]> {
  const res = await ocFetch("/session")
  return res.json()
}

export async function createSession(title?: string): Promise<OcSession> {
  const res = await ocFetch("/session", {
    method: "POST",
    body: JSON.stringify({ title: title ?? "飞书对话" }),
  })
  return res.json()
}

export async function getSession(id: string): Promise<OcSession | null> {
  const res = await ocFetch(`/session/${id}`)
  return res.json()
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
  tool?: { name: string; description?: string }
  state?: { status: string; title?: string; input?: Record<string, unknown>; output?: Record<string, unknown> }
}
