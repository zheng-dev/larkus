/**
 * config - 应用配置管理
 *
 * 定义配置结构，提供 config.json 的加载、保存与只读访问。
 * 运行时配置通过 `Config` 代理对象获取。
 */
import { join } from "node:path"

/** 应用配置类型 */
export type Config = {
  feishu: { appId: string; appSecret: string }
  opencode: { url: string; password: string }
  mode: "polling" | "webhook"
  polling: { watchChats: string[]; interval: number }
  webhook: { port: number; verificationToken: string }
}

let _c: Config

/** 运行时配置的只读代理 */
export const Config = {
  get feishu() { return _c.feishu },
  get opencode() { return _c.opencode },
  get mode() { return _c.mode },
  get polling() { return _c.polling },
  get webhook() { return _c.webhook },
}

const CONFIG_PATH = join(import.meta.dirname!, "..", "config.json")

/** 初始化运行时配置 */
export function init(c: Config) { _c = c }

/** 从 config.json 加载配置 */
export async function load(): Promise<Config> {
  return Bun.file(CONFIG_PATH).json()
}

/** 将配置写入 config.json */
export async function save(c: Config): Promise<void> {
  await Bun.write(CONFIG_PATH, JSON.stringify(c, null, 2))
}

/** 检测 config.json 是否存在 */
export async function fileExists(): Promise<boolean> {
  return Bun.file(CONFIG_PATH).exists()
}
