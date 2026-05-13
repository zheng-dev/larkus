import * as Opencode from "./opencode"
import * as Feishu from "./feishu"
import * as Card from "./card"
import { Config } from "./config"
import { getBinding, setBinding, removeBinding } from "./session"

const activeStreams = new Map<string, AbortController>()
const lastPosition = new Map<string, number>()
const unreachable = new Set<string>()

function streamKey(chatId: string, rootId: string): string {
  return `${chatId}:${rootId || ""}`
}

function parseContent(text: string): string {
  // lark-cli normalizes content to plain text already
  return text.replace(/<at[^>]*>.*?<\/at>/g, "").trim()
}

function parseCommand(text: string): { name: string; args: string } | null {
  const m = text.match(/^\/(\w+)\s*(.*)/)
  if (!m) return null
  return { name: m[1].toLowerCase(), args: m[2].trim() }
}

export async function startPolling(chatIds: string[], intervalSec: number) {
  while (true) {
    unreachable.clear()
    for (const chatId of chatIds) {
      const msgs = await Feishu.listMessages(chatId, { pageSize: 3, sortType: "ByCreateTimeDesc" })
      if (msgs === null) {
        unreachable.add(chatId)
        continue
      }
      if (msgs.length) {
        lastPosition.set(chatId, msgs[0].position)
      }
    }

    if (unreachable.size > 0 && unreachable.size < chatIds.length) {
      console.log(`\n   ${unreachable.size} 个群聊 bot 未加入（已跳过），重启后如需修复可:`)
      unreachable.forEach(id => console.log(`     ${id}`))
      console.log(`   飞书群 → 设置 → 群机器人 → 搜索添加: ${Config.feishu.appId}`)
    }

    if (unreachable.size === chatIds.length) {
      console.error(`\n所有 ${chatIds.length} 个群聊 bot 均未加入:`)
      chatIds.forEach(id => console.error(`    ${id}`))
      const choice = ask("\n[1] 去添加机器人   [2] 换 chat_id   [3] 退出\n请选择: ")

      if (choice === "1") {
        console.log("\n━━━ 添加机器人步骤 ━━━")
        console.log(`  1. 打开飞书，进入目标群聊`)
        console.log(`  2. 右上角 ··· → 设置 → 群机器人`)
        console.log(`  3. 搜索应用: ${Config.feishu.appId}`)
        console.log(`  4. 点击「添加」`)
        console.log(`  5. 回到这里按回车重试\n`)
        ask("完成后按回车重试...")
        continue
      }

      if (choice === "2") {
        const newChats = await reconfigChats(chatIds)
        if (newChats.length) chatIds = newChats
        continue
      }

      if (choice === "3") {
        console.log("已退出")
        process.exit(0)
      }
      continue
    }

    break
  }

  console.log("轮询已启动")

  setInterval(() => {
    for (const chatId of chatIds) {
      if (unreachable.has(chatId)) continue
      pollChat(chatId).catch(err =>
        console.error(`轮询失败 [${chatId}]:`, err instanceof Error ? err.message : err),
      )
    }
  }, intervalSec * 1000)
}

function ask(msg: string): string {
  const result = globalThis.prompt?.(msg)
  return result ?? ""
}

async function reconfigChats(current: string[]): Promise<string[]> {
  console.log("\n━━━ 如何获取 chat_id ━━━")
  console.log("  飞书 App → 目标群聊 → 右上角 ··· → 设置 → 群ID → 复制")
  console.log("  或: lark-cli api GET /open-apis/im/v1/chats?user_id_type=open_id\n")
  console.log(`当前配置: ${current.join(", ")}`)
  const raw = ask("输入新的 chat_id (多个用逗号分隔): ")
  const ids = raw.split(",").map(s => s.trim()).filter(Boolean)
  if (ids.length === 0) return current

  const configFile = Bun.file("config.json")
  if (await configFile.exists()) {
    const config = await configFile.json() as Record<string, unknown>
    const polling = config.polling as Record<string, unknown>
    polling.watchChats = ids
    await Bun.write("config.json", JSON.stringify(config, null, 2))
    console.log("已更新 config.json\n")
  }
  return ids
}

async function pollChat(chatId: string) {
  const msgs = await Feishu.listMessages(chatId, { pageSize: 10, sortType: "ByCreateTimeDesc" })
  if (msgs === null) {
    unreachable.add(chatId)
    return
  }
  if (!msgs.length) return

  const since = lastPosition.get(chatId) ?? 0
  const newMsgs = msgs.filter(m => m.position > since)
  if (!newMsgs.length) return

  lastPosition.set(chatId, newMsgs[0].position)

  for (const msg of newMsgs.reverse()) {
    if (msg.msgType === "system") continue
    const text = parseContent(msg.content)
    if (!text) continue
    await processPollMessage(text, msg.chatId, msg.rootId, msg.messageId)
  }
}

async function processPollMessage(
  text: string,
  chatId: string,
  rootId: string,
  messageId: string,
) {
  const cmd = parseCommand(text)

  if (cmd) {
    await processCommand(cmd, chatId, rootId, messageId)
    return
  }

  await processChatMessage(text, chatId, rootId, messageId)
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
      await Feishu.replyText(messageId, `已创建新 Session: **${session.title}**`)
      break
    }
    case "switch": {
      if (!cmd.args) {
        await Feishu.replyText(messageId, "用法: `/switch <session-slug>`")
        return
      }
      const sessions = (await Opencode.listSessions()) ?? []
      const target = sessions.find(s => s.slug === cmd.args || s.id === cmd.args)
      if (!target) {
        await Feishu.replyText(messageId, `未找到 Session: ${cmd.args}`)
        return
      }
      setBinding(chatId, rootId, target.id)
      await Feishu.replyText(messageId, `已切换到 Session: **${target.title}**\n\`${target.slug}\``)
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
      const ago = diff < 60000 ? "刚刚" : `${Math.floor(diff / 60000)}分钟前`
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
      await Feishu.replyText(messageId, `未知命令: /${cmd.name}。输入 **/help** 查看可用命令`)
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

  const decoder = new TextDecoder()
  let cardText = ""
  let lastUpdate = 0
  const UPDATE_MS = 800

  const stream = await Opencode.prompt(sessionId, userText, abortController.signal).catch(
    () => null,
  )

  if (!stream) {
    await Feishu.updateMessage({
      messageId: cardMsgId,
      content: JSON.stringify(Card.buildErrorCard("无法连接到 opencode 服务")),
    })
    activeStreams.delete(bindingKey)
    return
  }

  const reader = stream.getReader()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }))
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      if (!line.startsWith("data:")) continue
      try {
        const event = JSON.parse(line.slice(5).trim())
        if (event.type === "message.part.delta") {
          const delta = event.properties?.delta
          if (typeof delta === "string") cardText += delta
        }
      } catch {
        // ignore malformed SSE
      }
    }

    const now = Date.now()
    if (now - lastUpdate > UPDATE_MS) {
      await Feishu.updateMessage({
        messageId: cardMsgId,
        content: JSON.stringify(Card.buildStreamingCard(cardText, sessionId)),
      }).catch(() => {})
      lastUpdate = now
    }
  }

  // Final update
  await Feishu.updateMessage({
    messageId: cardMsgId,
    content: JSON.stringify(Card.buildResultCard(cardText || "无返回内容", sessionId)),
  }).catch(() => {})

  activeStreams.delete(bindingKey)
}
