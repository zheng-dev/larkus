type Card = Record<string, unknown>

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

export function buildThinkingCard(sessionId?: string): Card {
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
        { tag: "note", elements: [{ tag: "plain_text", content: sessionId }] },
      ] : []),
    ],
  }
}

export function buildStreamingCard(text: string, sessionId?: string): Card {
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
        { tag: "note", elements: [{ tag: "plain_text", content: sessionId }] },
      ] : []),
    ],
  }
}

export function buildResultCard(text: string, sessionId?: string): Card {
  return {
    config: { wide_screen_mode: true, update_multi: true },
    header: {
      title: { tag: "plain_text", content: "✅ opencode" },
      template: "green",
    },
    elements: [
      { tag: "div", text: { tag: "lark_md", content: truncate(text) } },
      ...(sessionId ? [
        { tag: "hr" },
        {
          tag: "note",
          elements: [
            { tag: "plain_text", content: `Session: ${sessionId}` },
          ],
        },
      ] : []),
    ],
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
            "• **/list** — 列出所有 Session",
            "• **/new `[标题]`** — 创建新 Session",
            "• **/switch `<slug>`** — 切换到指定 Session",
            "• **/status** — 查看当前 Session 状态",
            "• **/abort** — 中止正在运行的任务",
            "• **/help** — 显示此帮助",
          ].join("\n"),
        },
      },
    ],
  }
}

export function buildSessionListCard(
  sessions: Array<{ id: string; slug: string; title: string; time: { updated: number } }>,
  bindingKey: string,
): Card {
  const items = sessions.slice(0, 15)
  const text = items.length
    ? items
        .map(
          (s, i) =>
            `${i + 1}. **${s.title}** — \`${s.slug}\` _${timeAgo(s.time.updated * 1000)}_`,
        )
        .join("\n")
    : "暂无 Session"

  const elements: Array<Record<string, unknown>> = [
    { tag: "div", text: { tag: "lark_md", content: text } },
    { tag: "hr" },
    {
      tag: "note",
      elements: [
        { tag: "plain_text", content: "用 /switch <slug> 切换" },
      ],
    },
  ]

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: `📋 Sessions (${items.length})` },
      template: "blue",
    },
    elements,
  }
}

export function buildAbortCard(sessionId: string): Card {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "🛑 已中止" },
      template: "yellow",
    },
    elements: [
      { tag: "div", text: { tag: "lark_md", content: "当前任务已中止" } },
      { tag: "hr" },
      { tag: "note", elements: [{ tag: "plain_text", content: sessionId }] },
    ],
  }
}
