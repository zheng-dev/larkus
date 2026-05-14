import { init, load, save, fileExists, Config } from "./config"
import { runSetup } from "./setup"
import { loadBindings } from "./session"
import { info } from "./logger"

const cfg = (await fileExists()) ? await load() : await (async () => {
  console.log("config.json 未找到，进入首次配置...\n")
  const c = await runSetup()
  await save(c)
  return c
})()
init(cfg)

await loadBindings()
info("已加载 session 绑定")

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
