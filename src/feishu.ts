/**
 * feishu - 飞书开放平台 API 封装
 *
 * 提供 tenant_access_token 获取与缓存、消息发送/回复/更新，
 * 以及通过 lark-cli 拉取群聊消息列表的能力。
 */
import { Config } from "./config"
import { error } from "./logger"

const BASE = "https://open.feishu.cn/open-apis"

/** 缓存的 tenant_access_token，提前 5 分钟过期 */
let cachedToken: { token: string; expiresAt: number } | null = null

async function getTenantAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token

  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: Config.feishu.appId,
      app_secret: Config.feishu.appSecret,
    }),
  })
  const data = await res.json()
  if (data.code !== 0) throw new Error(`获取飞书 token 失败: ${data.msg}`)

  cachedToken = {
    token: data.tenant_access_token,
    expiresAt: Date.now() + (data.expire - 300) * 1000,
  }
  return cachedToken.token
}

async function feishuFetch(path: string, opts: RequestInit = {}) {
  const token = await getTenantAccessToken()
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...opts.headers as Record<string, string>,
    },
  })
  const data = await res.json()
  if (data.code !== 0) {
    console.error(`飞书 API 错误 [${path}]:`, data.code, data.msg)
    return null
  }
  return data
}

/** 向指定群聊发送消息，返回消息 ID */
export async function sendMessage(params: {
  chatId: string
  content: string
  msgType?: string
}): Promise<string | null> {
  const data = await feishuFetch(
    `/im/v1/messages?receive_id_type=chat_id`,
    {
      method: "POST",
      body: JSON.stringify({
        receive_id: params.chatId,
        msg_type: params.msgType ?? "interactive",
        content: params.content,
      }),
    },
  )
  return data?.data?.message_id ?? null
}

/** 回复指定消息（用于消息卡片），返回新消息 ID */
export async function replyMessage(params: {
  messageId: string
  content: string
  msgType?: string
}): Promise<string | null> {
  const data = await feishuFetch(
    `/im/v1/messages/${params.messageId}/reply`,
    {
      method: "POST",
      body: JSON.stringify({
        content: params.content,
        msg_type: params.msgType ?? "interactive",
      }),
    },
  )
  return data?.data?.message_id ?? null
}

/** 更新已发送的消息卡片内容 */
export async function updateMessage(params: {
  messageId: string
  content: string
}): Promise<void> {
  await feishuFetch(
    `/im/v1/messages/${params.messageId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        content: params.content,
      }),
    },
  )
}

/** 以纯文本方式回复消息 */
export async function replyText(messageId: string, text: string): Promise<string | null> {
  return replyMessage({
    messageId,
    content: JSON.stringify({ text }),
    msgType: "text",
  })
}

/** 通过 lark-cli 拉取群聊消息列表 */
export async function listMessages(
  chatId: string,
  opts?: { pageSize?: number; pageToken?: string; sortType?: string },
): Promise<FeishuMessage[] | null> {
  const pageSize = opts?.pageSize ?? 10
  const sortDir = opts?.sortType?.includes("Desc") ? "desc" : "asc"

  const proc = Bun.spawn([
    "lark-cli", "im", "+chat-messages-list",
    "--chat-id", chatId,
    "--page-size", String(pageSize),
    "--sort", sortDir,
    "--format", "json",
  ], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const outText = await new Response(proc.stdout).text()
  const errText = await new Response(proc.stderr).text()
  const exitCode = await proc.exited

  if (exitCode !== 0) {
    error("lark-cli 退出非零", { chatId, exitCode, stderr: errText.slice(0, 500) })
    return null
  }

  try {
    const data = JSON.parse(outText)
    if (!data?.ok || !data.data?.messages) {
      error("lark-cli 返回异常", { chatId, ok: data?.ok, stderr: errText.slice(0, 300) })
      return null
    }

    return data.data.messages.map((m: Record<string, unknown>) => ({
      messageId: m.message_id as string,
      rootId: (m.root_id as string) ?? "",
      parentId: (m.parent_id as string) ?? "",
      chatId: m.chat_id as string,
      chatType: m.chat_type as string,
      createTime: (m.create_time as string).replace(" ", "T"),
      msgType: m.msg_type as string,
      content: m.content as string,
      mentions: (m.mentions as Array<Record<string, unknown>>) ?? [],
      position: parseInt((m.message_position as string) ?? "0"),
      senderType: ((m.sender as Record<string, unknown>)?.sender_type as string) ?? "",
    }))
  } catch {
    error("lark-cli JSON 解析失败", { chatId, raw: outText.slice(0, 500), stderr: errText.slice(0, 300) })
    return null
  }
}

export interface FeishuMessage {
  messageId: string
  rootId: string
  parentId: string
  chatId: string
  chatType: string
  createTime: string
  msgType: string
  content: string
  mentions: Array<Record<string, unknown>>
  position: number
  senderType: string
}
