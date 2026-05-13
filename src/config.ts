import { join } from "node:path"

export type Config = {
  feishu: { appId: string; appSecret: string }
  opencode: { url: string; password: string }
  mode: "polling" | "webhook"
  polling: { watchChats: string[]; interval: number }
  webhook: { port: number; verificationToken: string }
}

let _c: Config

export const Config = {
  get feishu() { return _c.feishu },
  get opencode() { return _c.opencode },
  get mode() { return _c.mode },
  get polling() { return _c.polling },
  get webhook() { return _c.webhook },
}

const CONFIG_PATH = join(import.meta.dirname!, "..", "config.json")

export function init(c: Config) { _c = c }

export async function load(): Promise<Config> {
  return Bun.file(CONFIG_PATH).json()
}

export async function save(c: Config): Promise<void> {
  await Bun.write(CONFIG_PATH, JSON.stringify(c, null, 2))
}

export async function fileExists(): Promise<boolean> {
  return Bun.file(CONFIG_PATH).exists()
}
