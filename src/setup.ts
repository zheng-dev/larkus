/**
 * setup - 首次配置向导
 *
 * 交互式引导用户完成飞书应用、opencode 连接、运行模式等配置。
 * 支持自动检测 lark-cli 已配置的应用和用户可访问的群聊列表。
 */
import type { Config } from "./config"

/** 生成配置步骤的标题框 */
const box = (title: string) => `\n${"=".repeat(52)}\n  ${title}\n${"=".repeat(52)}`

function ask(msg: string): string {
  const result = globalThis.prompt?.(msg)
  return result ?? ""
}

function select(msg: string, options: string[]): number {
  console.log(msg)
  options.forEach((o, i) => console.log(`  [${i + 1}] ${o}`))
  const n = parseInt(ask("请选择: "))
  return n >= 1 && n <= options.length ? n - 1 : 0
}

async function larkApi(path: string): Promise<Record<string, unknown> | null> {
  const proc = Bun.spawn(["lark-cli", "api", "GET", path], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const text = await new Response(proc.stdout).text()
  const exitCode = await proc.exited
  if (exitCode !== 0) return null
  try { return JSON.parse(text) } catch { return null }
}

async function detectLarkApps(): Promise<Array<{ appId: string; name: string }>> {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? ""
  const configFile = Bun.file(`${home}/.lark-cli/config.json`)
  const exists = await configFile.exists()
  if (!exists) return []

  try {
    const data = await configFile.json() as Record<string, unknown>
    return ((data.apps ?? []) as Array<Record<string, unknown>>).map(a => ({
      appId: a.appId as string,
      name: (a.name as string) ?? (a.appId as string),
    }))
  } catch {
    return []
  }
}

type ChatInfo = { chatId: string; name: string; kind: string }

async function detectChats(): Promise<ChatInfo[]> {
  const data = await larkApi("/open-apis/im/v1/chats?user_id_type=open_id&page_size=50")
  if (!data?.data) return []

  return ((data.data as Record<string, unknown>).items as Array<Record<string, unknown>> ?? [])
    .map(c => {
      const desc = (c.description as string) ?? ""
      const kind = desc.includes("飞书助手") || desc.includes("官方消息推送") ? "系统" : "群聊"
      return {
        chatId: c.chat_id as string,
        name: (c.name as string) || (c.chat_id as string),
        kind,
      }
    })
}

function showChatIdHelp() {
  console.log("  chat_id 格式: oc_xxxxxxxxxxxxxxxxxxxxxxxxxx")
  console.log("  获取方式:")
  console.log("    飞书 App → 进入目标群聊 → 右上角设置 → 群ID → 复制")
  console.log("    或命令行: lark-cli api GET /open-apis/im/v1/chats?user_id_type=open_id")
}

/**
 * 运行交互式配置向导
 * 依次收集飞书应用、opencode 连接、运行模式等配置，生成 Config 对象。
 */
export async function runSetup(): Promise<Config> {
  console.log(box("oc-lark 首次配置"))

  const config: Config = {
    feishu: { appId: "", appSecret: "" },
    opencode: { url: "http://localhost:4096", password: "" },
    mode: "polling",
    polling: { watchChats: [], interval: 3 },
    webhook: { port: 3000, verificationToken: "" },
  }

  // Step 1: Feishu App
  const apps = await detectLarkApps()
  if (apps.length > 0) {
    console.log("\n检测到 lark-cli 已配置的应用:")
    const labels = apps.map(a => `${a.appId}${a.name ? ` (${a.name})` : ""}`)
    const idx = select("", labels)
    config.feishu.appId = apps[idx].appId
    console.log(`已选择: ${config.feishu.appId}`)
  } else {
    config.feishu.appId = ask("飞书 App ID: ")
  }

  // Step 2: App Secret
  console.log(box("App Secret"))
  console.log("获取方式:")
  console.log(`  https://open.feishu.cn → 应用 ${config.feishu.appId}`)
  console.log("  → 凭证与基础信息 → 复制 App Secret\n")
  const secret = ask("App Secret: ")
  config.feishu.appSecret = secret
  if (!secret) console.log("跳过，稍后可手动编辑 config.json")

  // Step 3: opencode
  console.log(box("opencode 连接"))
  const ocUrl = ask(`opencode 地址 [${config.opencode.url}]: `)
  if (ocUrl) config.opencode.url = ocUrl
  const ocPwd = ask("opencode 密码 (无密码留空): ")
  if (ocPwd) config.opencode.password = ocPwd

  // Step 4: Mode
  console.log(box("运行模式"))
  const modeIdx = select("选择模式:", [
    "polling — 轮询模式，纯出站，不需公网 URL (推荐)",
    "webhook — 推送模式，需事件订阅 + 公网 URL",
  ])
  config.mode = modeIdx === 0 ? "polling" : "webhook"

  // Step 5: Mode-specific
  if (config.mode === "polling") {
    console.log(box("轮询配置"))

    const ival = ask("轮询间隔秒数 [3]: ")
    if (ival) config.polling.interval = parseInt(ival) || 3

    console.log("\nchat_id 是飞书群聊的唯一标识 (oc_开头)。bot 只监控你指定的群聊。")

    const chats = await detectChats()
    if (chats.length > 0) {
      const maxName = Math.max(...chats.map(c => c.name.length), 4)
      const nameW = maxName < 28 ? maxName : 28
      const sep = "\n  " + "─".repeat(nameW + 47)

      console.log(`\n检测到以下群聊（bot 无法加入「系统」类型）:${sep}`)

      chats.forEach((c, i) => {
        const num = String(i + 1).padStart(2)
        const name = c.name.length > 28 ? c.name.slice(0, 26) + "…" : c.name.padEnd(nameW)
        console.log(`  ${num}  ${name}  ${c.chatId}  ${c.kind}`)
      })

      console.log(sep)
      console.log("  [A] 全部群聊   [0] 手动输入 chat_id")
      const choice = ask("\n请选择 (支持逗号多选，如 1,3): ")

      if (choice.toLowerCase() === "a") {
        config.polling.watchChats = chats.map(c => c.chatId)
      } else if (choice !== "0" && choice !== "") {
        const picked = choice.split(",").flatMap(s => {
          const n = parseInt(s.trim())
          return n >= 1 && n <= chats.length ? [chats[n - 1].chatId] : []
        })
        if (picked.length) config.polling.watchChats = picked
      }
    }

    if (config.polling.watchChats.length === 0) {
      console.log()
      showChatIdHelp()
      const raw = ask("\n输入要监控的 chat_id (多个用逗号分隔): ")
      config.polling.watchChats = raw.split(",").map(s => s.trim()).filter(Boolean)
    }

    if (config.polling.watchChats.length > 0) {
      console.log(`\n⚠  请确保 bot 已加入以下群聊，否则轮询将跳过不可达的群聊:`)
      console.log("   飞书群聊 → 设置 → 群机器人 → 添加机器人")
      config.polling.watchChats.forEach(id => console.log(`   ${id}`))
    }
  } else {
    console.log(box("Webhook 配置"))
    const port = ask(`监听端口 [${config.webhook.port}]: `)
    if (port) config.webhook.port = parseInt(port) || 3000
    config.webhook.verificationToken = ask("Verification Token (飞书开放平台→事件订阅→加密策略): ")
  }

  // Confirm
  console.log("\n" + "=".repeat(52))
  console.log(JSON.stringify(config, null, 2))
  console.log("=".repeat(52))
  const ok = ask("\n保存并启动? [Y/n]: ").toLowerCase()
  if (ok === "n") {
    console.log("已取消")
    process.exit(0)
  }

  return config
}
