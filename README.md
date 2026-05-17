# oc-lark

将 [opencode](https://github.com/anomalyco/opencode) AI 编程助手接入飞书群聊，在飞书中与 opencode 对话，支持流式卡片输出、多 Session 管理、命令交互。

## 功能特性

- **飞书群聊接入** — 在飞书群中 @机器人 即可与 opencode 对话
- **流式卡片回复** — AI 回复实时更新到飞书消息卡片，支持显示分析过程、工具调用状态
- **多 Session 管理** — 每个聊天线程独立绑定 opencode Session，支持 /new /switch 等命令
- **长文本分页** — 超长回复自动分页，通过 `/p` 命令翻页
- **两种运行模式** — 轮询模式（无需公网 URL）与 Webhook 模式（实时响应）
- **孤儿卡片恢复** — 服务重启后自动修复挂起的"思考中"卡片
- **按天日志** — 日志持久化到 `data/` 目录

## 环境要求

- [Bun](https://bun.sh/) >= 1.0
- [lark-cli](https://github.com/chyroc/lark) — 轮询模式下需安装，用于拉取群聊消息
- 运行中的 [opencode](http://localhost:4096) 服务

## 快速开始

```bash
# 克隆项目
git clone git@github.com:zheng-dev/larkus.git
cd larkus

# 安装依赖
bun install

# 首次运行（交互式配置向导）
bun run dev
```

首次运行会自动进入配置向导，引导你完成飞书应用凭证、opencode 连接、运行模式等设置。

## 配置说明

配置文件为项目根目录下的 `config.json`（参考 `config.example.json`）：

```json
{
  "feishu": {
    "appId": "你的飞书应用 App ID",
    "appSecret": "你的飞书应用 App Secret"
  },
  "opencode": {
    "url": "http://localhost:4096",
    "password": "opencode 密码（无密码留空）"
  },
  "mode": "polling",
  "polling": {
    "watchChats": ["oc_xxxxxxxxxxxxxxxxxxxxxxxxxx"],
    "interval": 2
  },
  "webhook": {
    "port": 3000,
    "verificationToken": ""
  }
}
```

### 配置项说明

| 字段 | 说明 |
|------|------|
| `feishu.appId` | 飞书开放平台应用的 App ID |
| `feishu.appSecret` | 飞书开放平台应用的 App Secret |
| `opencode.url` | opencode 服务地址，默认 `http://localhost:4096` |
| `opencode.password` | opencode 的访问密码 |
| `mode` | 运行模式：`polling`（轮询）或 `webhook`（推送） |
| `polling.watchChats` | 轮询模式下要监控的群聊 chat_id 列表 |
| `polling.interval` | 轮询间隔（秒），默认 3 |
| `webhook.port` | Webhook 模式监听端口，默认 3000 |
| `webhook.verificationToken` | Webhook 签名验证 Token（飞书开放平台事件订阅处获取） |

## 飞书设置

### 1. 创建飞书应用

1. 打开 [飞书开放平台](https://open.feishu.cn)
2. 进入「开发者后台」→「创建企业自建应用」
3. 填写应用名称（如 opencode）、描述
4. 创建完成后进入应用详情页

### 2. 获取应用凭证

1. 在应用详情页左侧选择「凭证与基础信息」
2. 复制 **App ID** 和 **App Secret**

### 3. 添加应用权限

在应用详情页左侧选择「权限管理」，搜索并添加以下权限：

| 权限 | 说明 |
|------|------|
| `im:message:send_as_bot` | 以机器人的身份发消息 |
| `im:message` | 获取消息内容 |
| `im:message:readonly` | 读取群聊消息 |
| `im:chat` | 获取群聊信息 |
| `im:chat:readonly` | 读取群聊列表 |

> **注意**：添加权限后需要发布应用并等待管理员审批（企业自建应用通常自动通过）。

### 4. 发布应用

1. 在左侧选择「版本管理与发布」
2. 点击「创建版本」，填写版本号和说明
3. 确认后提交发布，等待管理员审核通过

> 企业自建应用一般无需审核，可直接发布。

### 5. 将机器人添加到群聊

1. 打开飞书客户端，进入目标群聊
2. 点击右上角 `···` →「设置」→「群机器人」
3. 搜索你的应用名称，点击「添加」
4. 机器人加入群聊后即可 @它 发送消息

### 6. 获取群聊 chat_id

打开飞书客户端，进入目标群聊 → 右上角设置 → 群 ID → 点击复制。格式为 `oc_xxxxxxxxxxxxxxxxxxxxxxxxxx`。

### 7. Webhook 模式额外配置（选配）

如果使用 Webhook 模式，还需：

1. 在应用详情页左侧选择「事件订阅」
2. 配置请求网址为你的公网地址，如 `https://your-domain.com/webhook`
3. 添加事件订阅：`im.message.receive_v1`（接收消息）
4. 获取 **Verification Token** 填入配置
5. 保存后飞书会发送验证请求，确保服务已启动

> 轮询模式不需要事件订阅和公网 URL，推荐优先使用。

## 运行

```bash
# 开发模式（热重载）
bun run dev

# TypeScript 类型检查
bun run typecheck
```

启动后控制台会显示运行状态：

```
轮询模式启动 { interval: 2, opencode: "http://localhost:4096", chats: ["oc_..."] }
轮询已启动
```

## 飞书命令

在群聊中发送以下命令与机器人交互：

| 命令 | 说明 |
|------|------|
| `@机器人 <消息>` | 发送消息给 opencode，在当前 Session 中继续对话 |
| `/help` | 显示帮助 |
| `/list [数字\|关键词]` | 列出/搜索 Session，支持分页 |
| `/new [标题]` | 创建新 Session |
| `/switch <slug>` | 切换到指定 Session |
| `/status` | 查看当前 Session 状态 |
| `/abort` | 中止正在运行的任务 |
| `/p [页码]` | 翻页查看过长回复 |

## 项目结构

```
src/
├── index.ts          # 应用入口，启动流程编排
├── config.ts         # 配置加载与管理
├── setup.ts          # 交互式配置向导
├── bot.ts            # Webhook 模式消息处理
├── polling.ts        # 轮询模式消息处理
├── feishu.ts         # 飞书开放平台 API 封装
├── opencode.ts       # opencode API 封装（Session/消息/流式）
├── card.ts           # 飞书消息卡片构建器
├── pagination.ts     # 长文本分页
├── session.ts        # 聊天线程 ↔ Session 绑定管理
├── pending_cards.ts  # 孤儿卡片追踪与恢复
├── verify.ts         # Webhook 签名验证
└── logger.ts         # 日志记录
```

## 联系

zheng6655@163.com

## License

MIT
