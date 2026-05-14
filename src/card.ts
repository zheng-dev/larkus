type Card = Record<string, unknown>

function sessionLabel(sessionId: string, sessionTitle?: string): string {
  return sessionTitle
    ? `Session: ${sessionTitle} | ${sessionId}`
    : `Session: ${sessionId}`
}

function timeAgo(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000)
  if (seconds < 60) return "刚刚"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  return `${Math.floor(hours / 24)}天前`
}

function truncate(text: string, maxLen = 4000): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + "\n\n...内容过长已截断"
}

export function buildThinkingCard(sessionId?: string, sessionTitle?: string): Card {
  return {
    config: { wide_screen_mode: true, update_multi: true },
    header: {
      title: { tag: "plain_text", content: "opencode" },
      template: "blue",
    },
    elements: [
      { tag: "div", text: { tag: "lark_md", content: "🔄 正在思考中..." } },
      ...(sessionId ? [
        { tag: "hr" },
        { tag: "note", elements: [{ tag: "plain_text", content: sessionLabel(sessionId, sessionTitle) }] },
      ] : []),
    ],
  }
}

export function buildStreamingCard(text: string, sessionId?: string, sessionTitle?: string): Card {
  const display = text || "🔄 正在思考中..."
  return {
    config: { wide_screen_mode: true, update_multi: true },
    header: {
      title: { tag: "plain_text", content: "opencode" },
      template: "blue",
    },
    elements: [
      { tag: "div", text: { tag: "lark_md", content: truncate(display) } },
      ...(sessionId ? [
        { tag: "hr" },
        { tag: "note", elements: [{ tag: "plain_text", content: sessionLabel(sessionId, sessionTitle) }] },
      ] : []),
    ],
  }
}

export function buildResultCard(
  text: string,
  sessionId?: string,
  sessionTitle?: string,
  pageInfo?: { page: number; total: number },
): Card {
  const elements: Array<Record<string, unknown>> = [
    { tag: "div", text: { tag: "lark_md", content: text } },
  ]

  if (sessionId) {
    elements.push({ tag: "hr" })
    if (pageInfo && pageInfo.total > 1) {
      elements.push({
        tag: "note",
        elements: [
          { tag: "plain_text", content: `📄 第 ${pageInfo.page}/${pageInfo.total} 页  |  ${sessionLabel(sessionId, sessionTitle)}  |  回复 /p 翻页` },
        ],
      })
    } else {
      elements.push({
        tag: "note",
        elements: [{ tag: "plain_text", content: sessionLabel(sessionId, sessionTitle) }],
      })
    }
  }

  return {
    config: { wide_screen_mode: true, update_multi: true },
    header: {
      title: { tag: "plain_text", content: "✅ opencode" },
      template: "green",
    },
    elements,
  }
}

export function buildErrorCard(message: string): Card {
  return {
    config: { wide_screen_mode: true, update_multi: true },
    header: {
      title: { tag: "plain_text", content: "❌ 出错了" },
      template: "red",
    },
    elements: [
      { tag: "div", text: { tag: "lark_md", content: message.slice(0, 2000) } },
      { tag: "hr" },
      { tag: "note", elements: [{ tag: "plain_text", content: "请重试或联系管理员" }] },
    ],
  }
}

export function buildHelpCard(): Card {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "opencode 飞书机器人" },
      template: "blue",
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: [
            "**命令列表:**",
            "",
              "• **@opencode `<消息>`** — 在当前 Session 中继续对话",
              "",
              "• **/list `[数字|关键词]`** — 列出/搜索 Session",
              "• **/new `[标题]`** — 创建新 Session",
              "• **/switch `<slug>`** — 切换到指定 Session",
              "• **/status** — 查看当前 Session 状态",
              "• **/abort** — 中止正在运行的任务",
              "• **/p `[页码]`** — 翻页查看过长回复",
              "• **/help** — 显示此帮助",
          ].join("\n"),
        },
      },
    ],
  }
}

const PAGE_SIZE = 15

export function buildSessionListCard(
  sessions: Array<{ id: string; slug: string; title: string; time: { updated: number } }>,
  bindingKey: string,
  opts?: { page?: number; keyword?: string },
): Card {
  let filtered = sessions
  if (opts?.keyword) {
    const kw = opts.keyword.toLowerCase()
    filtered = sessions.filter(
      s => s.title.toLowerCase().includes(kw) || s.slug.toLowerCase().includes(kw),
    )
  }

  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const page = Math.max(1, Math.min(opts?.page ?? 1, totalPages))
  const start = (page - 1) * PAGE_SIZE
  const items = filtered.slice(start, start + PAGE_SIZE)

  const kwLabel = opts?.keyword ? ` 搜索: ${opts.keyword}` : ""
  const pageLabel = totalPages > 1 ? ` 第 ${page}/${totalPages} 页` : ""

  const text = items.length
    ? items
        .map(
          (s, i) =>
            `${start + i + 1}. **${s.title}** — \`${s.slug}\` _${timeAgo(s.time.updated * 1000)}_`,
        )
        .join("\n")
    : (opts?.keyword ? `没有匹配 "${opts.keyword}" 的 Session` : "暂无 Session")

  const elements: Array<Record<string, unknown>> = [
    { tag: "div", text: { tag: "lark_md", content: text } },
    { tag: "hr" },
  ]

  if (totalPages > 1) {
    const hasNext = page < totalPages
    const nextPage = hasNext ? page + 1 : 1
    const prevPage = page > 1 ? page - 1 : totalPages
    elements.push({
      tag: "note",
      elements: [
        {
          tag: "plain_text",
          content: `第 ${page}/${totalPages} 页 (共 ${total} 个)  |  /list ${prevPage} 上一页  |  /list ${nextPage} 下一页`,
        },
      ],
    })
  }

  elements.push({
    tag: "note",
    elements: [
      {
        tag: "plain_text",
        content: `/list <数字> 翻页  |  /list <关键词> 模糊搜索  |  /switch <slug> 切换`,
      },
    ],
  })

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: `📋 Sessions (${total})${kwLabel}${pageLabel}` },
      template: "blue",
    },
    elements,
  }
}

export function buildAbortCard(sessionId: string, sessionTitle?: string): Card {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "🛑 已中止" },
      template: "yellow",
    },
    elements: [
      { tag: "div", text: { tag: "lark_md", content: "当前任务已中止" } },
      { tag: "hr" },
      { tag: "note", elements: [{ tag: "plain_text", content: sessionLabel(sessionId, sessionTitle) }] },
    ],
  }
}
