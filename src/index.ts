/**
 * oc-lark 应用入口
 *
 * 负责以下启动流程：
 * 1. 加载/创建配置文件 (config.json)
 * 2. 恢复聊天线程与 opencode Session 的绑定关系
 * 3. 修复因服务重启遗留的"孤儿卡片"（pending cards）
 * 4. 根据配置模式启动 webhook 服务或轮询服务
 */
import { init, load, save, fileExists, Config } from "./config"
import { runSetup } from "./setup"
import { loadBindings } from "./session"
import { info } from "./logger"
import { loadPendingCards, getPendingEntries, clearPendingCards } from "./pending_cards"
import * as Pagination from "./pagination"
import * as Opencode from "./opencode"
import * as Feishu from "./feishu"
import * as Card from "./card"

const cfg = (await fileExists()) ? await load() : await (async () => {
  console.log("config.json 未找到，进入首次配置...\n")
  const c = await runSetup()
  await save(c)
  return c
})()
init(cfg)

await loadBindings()
const now = new Date()

info('已加载 session 绑定 time:' + now.toLocaleString())

await loadPendingCards()
await Pagination.loadPagination()
const orphans = getPendingEntries()
if (orphans.length > 0) {
  info(`发现 ${orphans.length} 个孤儿卡片，正在修复...`)
  for (const entry of orphans) {
    try {
      const msgs = await Opencode.getMessages(entry.sessionId)
      const lastAssistant = msgs?.findLast(m => m.info.role === "assistant")
      if (lastAssistant) {
        const text = lastAssistant.parts.find(p => p.type === "text")?.text
        if (text) {
          await Feishu.updateMessage({
            messageId: entry.cardMsgId,
            content: JSON.stringify(Card.buildResultCard(text, entry.sessionId, Opencode.getCachedSession(entry.sessionId)?.title)),
          })
          info(`已恢复孤儿卡片`, { sessionId: entry.sessionId, key: entry.key })
        } else {
          await Feishu.updateMessage({
            messageId: entry.cardMsgId,
            content: JSON.stringify(Card.buildErrorCard("服务已重启，请重新发送消息")),
          })
        }
      } else {
        info(`孤儿卡片暂无结果，更新为重试提示`, { sessionId: entry.sessionId })
        await Feishu.updateMessage({
          messageId: entry.cardMsgId,
          content: JSON.stringify(Card.buildErrorCard("服务已重启，openCode 仍在处理中，请稍后重试")),
        })
      }
    } catch (err) {
      info(`孤儿卡片修复失败`, { key: entry.key, reason: err instanceof Error ? err.message : String(err) })
    }
  }
  clearPendingCards()
  info("孤儿卡片清理完毕")
}

if (cfg.mode === "webhook") {
  const { handleWebhook } = await import("./bot")

  const server = Bun.serve({
    port: cfg.webhook.port,
    fetch(req) {
      const url = new URL(req.url)
      if (req.method === "GET" && url.pathname === "/health") return new Response("ok")
      if (req.method === "POST" && url.pathname === "/webhook") return handleWebhook(req)
      return new Response("not found", { status: 404 })
    },
    error(err) {
      console.error("服务器错误:", err)
      return new Response("internal error", { status: 500 })
    },
  })

  info(`webhook 模式启动`, { port: server.port, opencode: Config.opencode.url })
} else {
  const { startPolling } = await import("./polling")

  for (const chatId of cfg.polling.watchChats) {
    console.log(`   监控群聊: ${chatId}`)
  }
  info("轮询模式启动", { interval: cfg.polling.interval, opencode: Config.opencode.url, chats: cfg.polling.watchChats })

  startPolling(cfg.polling.watchChats, cfg.polling.interval)
}
