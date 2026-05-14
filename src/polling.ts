import * as Opencode from "./opencode"
import * as Feishu from "./feishu"
import * as Card from "./card"
import * as Pagination from "./pagination"
import { Config } from "./config"
import { getBinding, setBinding, removeBinding } from "./session"
import { error, warn, debug } from "./logger"
import { addPendingCard, removePendingCard } from "./pending_cards"

const activeStreams = new Map<string, AbortController>()
const lastPosition = new Map<string, number>()
const unreachable = new Set<string>()
let pollCycle = 0

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
        lastPosition.set(chatId, msgs[0].position - 1)
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
    pollCycle++
    debug(`轮询心跳 #${pollCycle}`, { chats: chatIds.filter(c => !unreachable.has(c)).length })

    // 每 5 个周期清空 unreachable，给之前失败的群聊一次重试机会
    if (pollCycle % 5 === 0 && unreachable.size > 0) {
      warn("清除 unreachable 状态，重新尝试", { chats: [...unreachable] })
      unreachable.clear()
    }

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
    error("lark-cli 获取消息失败，标记 unreachable（每 5 周期重试）", { chatId })
    unreachable.add(chatId)
    return
  }
  if (!msgs.length) return

  const since = lastPosition.get(chatId) ?? 0
  const newMsgs = msgs.filter(m => m.position > since)

  // 记录被过滤掉的消息，方便排查误过滤
  const skipped = msgs.filter(
    m => m.position > since && (m.senderType === "app" || m.msgType === "system" || !parseContent(m.content)),
  )
  if (skipped.length > 0) {
    debug("轮询跳过消息", {
      chatId,
      skipped: skipped.map(m => ({ pos: m.position, sender: m.senderType, type: m.msgType })),
    })
  }

  if (!newMsgs.length) return

  lastPosition.set(chatId, newMsgs[0].position)

  for (const msg of newMsgs.reverse()) {
    if (msg.senderType === "app" || msg.msgType === "system") continue
    const text = parseContent(msg.content)
    if (!text) continue
    debug("轮询处理消息", { chatId, pos: msg.position, senderType: msg.senderType, msgType: msg.msgType, text: text.slice(0, 100) })
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
      let page: number | undefined
      let keyword: string | undefined
      if (cmd.args) {
        const num = parseInt(cmd.args, 10)
        if (!isNaN(num) && String(num) === cmd.args) {
          page = num
        } else {
          keyword = cmd.args
        }
      }
      await Feishu.replyMessage({
        messageId,
        content: JSON.stringify(Card.buildSessionListCard(sessions, key, { page, keyword })),
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
        content: JSON.stringify(Card.buildAbortCard(sessionId, Opencode.getCachedSession(sessionId)?.title)),
      })
      break
    }
    case "p": {
      const pageNum = cmd.args ? parseInt(cmd.args, 10) : undefined
      if (cmd.args && (isNaN(pageNum!) || String(pageNum) !== cmd.args)) {
        await Feishu.replyText(messageId, "用法: `/p` 翻下页 或 `/p <数字>` 跳转指定页")
        return
      }
      const result = Pagination.getPage(key, pageNum)
      if (!result) {
        await Feishu.replyText(messageId, "内容已过期，请重新发送消息")
        return
      }
      const pageText = [
        `📄 **第 ${result.page}/${result.total} 页**`,
        "",
        result.content,
        ...(result.page < result.total ? ["", `回复 **/p** 翻下一页`] : []),
      ].join("\n")
      await Feishu.replyText(messageId, pageText)
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

  const sessionTitle = Opencode.getCachedSession(sessionId)?.title

  const existing = activeStreams.get(key)
  if (existing) {
    existing.abort()
    activeStreams.delete(key)
    Opencode.abortSession(sessionId).catch(() => {})
  }

  const cardMsgId = await Feishu.replyMessage({
    messageId,
    content: JSON.stringify(Card.buildThinkingCard(sessionId, sessionTitle)),
  })

  if (!cardMsgId) {
    await Feishu.replyText(messageId, "发送消息失败，请稍后重试")
    return
  }

  addPendingCard(key, sessionId, cardMsgId)

  await streamResponse(sessionId, text, cardMsgId, key, sessionTitle)
}

async function streamResponse(
  sessionId: string,
  userText: string,
  cardMsgId: string,
  bindingKey: string,
  sessionTitle?: string,
) {
  const abortController = new AbortController()
  activeStreams.set(bindingKey, abortController)

  let finalText = ""

  try {
    finalText = await Opencode.streamPrompt(
      sessionId,
      userText,
      async (display) => {
        await Feishu.updateMessage({
          messageId: cardMsgId,
          content: JSON.stringify(Card.buildStreamingCard(display, sessionId, sessionTitle)),
        }).catch(() => {})
      },
      abortController.signal,
    )

    const fullText = finalText || "无返回内容"
    const firstPage = Pagination.storeText(bindingKey, fullText)

    await Feishu.updateMessage({
      messageId: cardMsgId,
      content: JSON.stringify(Card.buildResultCard(firstPage.content, sessionId, sessionTitle, { page: firstPage.page, total: firstPage.total })),
    }).catch(() => {})

  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    if (reason === "Aborted") {
      // 正常中断：用户发了新消息，主动取消旧的 stream
      removePendingCard(bindingKey)
      activeStreams.delete(bindingKey)
      return
    }
    error("streamResponse 失败", { sessionId, userText: userText.slice(0, 200), reason })
    const display = reason.includes("fetch") || reason.includes("connect") || reason.includes("ECONN")
      ? "无法连接到 opencode 服务"
      : "opencode 处理出错（详情见日志）"
    await Feishu.updateMessage({
      messageId: cardMsgId,
      content: JSON.stringify(Card.buildErrorCard(display)),
    }).catch(() => {})
  }

  removePendingCard(bindingKey)
  activeStreams.delete(bindingKey)
}
