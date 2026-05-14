import { verifySignature } from "./verify"
import { getBinding, setBinding, removeBinding } from "./session"
import * as Opencode from "./opencode"
import * as Feishu from "./feishu"
import * as Card from "./card"
import { error } from "./logger"

const activeStreams = new Map<string, AbortController>()

function streamKey(chatId: string, rootId: string): string {
  return `${chatId}:${rootId || ""}`
}

function parseContent(text: string): string {
  const parsed = JSON.parse(text)
  const raw = parsed.text ?? parsed.content ?? ""
  return raw.replace(/<at[^>]*>.*?<\/at>/g, "").trim()
}

function parseCommand(text: string): { name: string; args: string } | null {
  const m = text.match(/^\/(\w+)\s*(.*)/)
  if (!m) return null
  return { name: m[1].toLowerCase(), args: m[2].trim() }
}

export async function handleWebhook(req: Request): Promise<Response> {
  const body = await req.text()

  const parsed = JSON.parse(body)

  if (parsed.type === "url_verification") {
    return Response.json({ challenge: parsed.challenge })
  }

  const timestamp = req.headers.get("X-Lark-Request-Timestamp") ?? ""
  const signature = req.headers.get("X-Lark-Signature") ?? ""
  if (!verifySignature(timestamp, signature, body)) {
    return new Response("signature mismatch", { status: 403 })
  }

  const eventType = parsed.header?.event_type

  if (eventType === "im.message.receive_v1") {
    handleMessageEvent(parsed.event).catch(err =>
      console.error("处理消息失败:", err),
    )
    return Response.json({ code: 0 })
  }

  return Response.json({ code: 0 })
}

async function handleMessageEvent(event: Record<string, unknown>) {
  const msg = event.message as Record<string, unknown>
  if (!msg) return

  const chatType = msg.chat_type as string
  const chatId = msg.chat_id as string
  const rootId = (msg.root_id as string) ?? ""
  const messageId = msg.message_id as string
  const contentStr = msg.content as string
  const contentText = parseContent(contentStr)

  if (!contentText) return

  const cmd = parseCommand(contentText)

  if (cmd) {
    await processCommand(cmd, chatId, rootId, messageId)
    return
  }

  await processChatMessage(contentText, chatId, rootId, messageId)
}

async function processCommand(
  cmd: { name: string; args: string },
  chatId: string,
  rootId: string,
  messageId: string,
) {
  const key = streamKey(chatId, rootId)

  switch (cmd.name) {
    case "list": {
      const sessions = (await Opencode.listSessions()) ?? []
      await Feishu.replyMessage({
        messageId,
        content: JSON.stringify(Card.buildSessionListCard(sessions, key)),
      })
      break
    }
    case "new": {
      const session = await Opencode.createSession(cmd.args || undefined)
      setBinding(chatId, rootId, session.id)
      await Feishu.replyText(messageId, `✅ 已创建新 Session: **${session.title}**`)
      break
    }
    case "switch": {
      if (!cmd.args) {
        await Feishu.replyText(messageId, "用法: `/switch <session-slug>`")
        return
      }
      const sessions = (await Opencode.listSessions()) ?? []
      const target = sessions.find(
        s => s.slug === cmd.args || s.id === cmd.args,
      )
      if (!target) {
        await Feishu.replyText(messageId, `未找到 Session: ${cmd.args}`)
        return
      }
      setBinding(chatId, rootId, target.id)
      await Feishu.replyText(
        messageId,
        `✅ 已切换到 Session: **${target.title}**\n\`${target.slug}\``,
      )
      break
    }
    case "status": {
      const sessionId = getBinding(chatId, rootId)
      if (!sessionId) {
        await Feishu.replyText(messageId, "当前线程未绑定 Session，请发消息自动创建或用 /switch")
        return
      }
      const session = await Opencode.getSession(sessionId)
      if (!session) {
        removeBinding(chatId, rootId)
        await Feishu.replyText(messageId, "Session 不存在，绑定已清除")
        return
      }
      const diff = Date.now() - session.time.updated * 1000
      const ago =
        diff < 60000
          ? "刚刚"
          : `${Math.floor(diff / 60000)}分钟前`
      await Feishu.replyText(
        messageId,
        [
          `**${session.title}**`,
          `更新时间: ${ago}`,
          `Slug: \`${session.slug}\``,
          session.share?.url ? `链接: ${session.share.url}` : "",
        ].filter(Boolean).join("\n"),
      )
      break
    }
    case "abort": {
      const sessionId = getBinding(chatId, rootId)
      if (!sessionId) {
        await Feishu.replyText(messageId, "当前线程未绑定 Session")
        return
      }
      const ctrl = activeStreams.get(key)
      if (ctrl) {
        ctrl.abort()
        activeStreams.delete(key)
      }
      await Opencode.abortSession(sessionId)
      await Feishu.replyMessage({
        messageId,
        content: JSON.stringify(Card.buildAbortCard(sessionId)),
      })
      break
    }
    case "help": {
      await Feishu.replyMessage({
        messageId,
        content: JSON.stringify(Card.buildHelpCard()),
      })
      break
    }
    default: {
      await Feishu.replyText(
        messageId,
        `未知命令: /${cmd.name}。输入 **/help** 查看可用命令`,
      )
    }
  }
}

async function processChatMessage(
  text: string,
  chatId: string,
  rootId: string,
  messageId: string,
) {
  const key = streamKey(chatId, rootId)
  let sessionId = getBinding(chatId, rootId)

  if (!sessionId) {
    const session = await Opencode.createSession()
    sessionId = session.id
    setBinding(chatId, rootId, sessionId)
  }

  // Abort any existing stream for this thread
  const existing = activeStreams.get(key)
  if (existing) {
    existing.abort()
    activeStreams.delete(key)
  }

  const cardMsgId = await Feishu.replyMessage({
    messageId,
    content: JSON.stringify(Card.buildThinkingCard(sessionId)),
  })

  if (!cardMsgId) {
    await Feishu.replyText(messageId, "发送消息失败，请稍后重试")
    return
  }

  await streamResponse(sessionId, text, cardMsgId, key)
}

async function streamResponse(
  sessionId: string,
  userText: string,
  cardMsgId: string,
  bindingKey: string,
) {
  const abortController = new AbortController()
  activeStreams.set(bindingKey, abortController)

  let promptErr: string | null = null
  const text = await Opencode.prompt(sessionId, userText, abortController.signal).catch(
    (err) => {
      promptErr = err instanceof Error ? err.message : String(err)
      return null
    },
  )

  if (text === null) {
    const reason = promptErr ?? "未知错误"
    error("streamResponse 失败", { sessionId, userText: userText.slice(0, 200), reason })
    const display = reason.includes("fetch") || reason.includes("connect") || reason.includes("ECONN")
      ? "无法连接到 opencode 服务"
      : "opencode 处理出错（详情见日志）"
    await Feishu.updateMessage({
      messageId: cardMsgId,
      content: JSON.stringify(Card.buildErrorCard(display)),
    })
    activeStreams.delete(bindingKey)
    return
  }

  await Feishu.updateMessage({
    messageId: cardMsgId,
    content: JSON.stringify(Card.buildResultCard(text || "无返回内容", sessionId)),
  }).catch(() => {})

  activeStreams.delete(bindingKey)
}
