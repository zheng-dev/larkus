/**
 * logger - 日志记录模块
 *
 * 按天分割日志文件到 data/ 目录，支持 INFO/ERROR/WARN/DEBUG 四个级别。
 * INFO/WARN/ERROR 同时输出到控制台。
 */
import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"

/** 日志文件存放目录 */
const LOG_DIR = join(import.meta.dirname!, "..", "data")

function logPath(): string {
  const d = new Date()
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  return join(LOG_DIR, `${date}.log`)
}

function timestamp(): string {
  const d = new Date()
  return d.toISOString().replace("T", " ").replace("Z", "")
}

async function write(line: string) {
  await mkdir(LOG_DIR, { recursive: true }).catch(() => {})
  await appendFile(logPath(), line + "\n").catch(() => {})
}

/** 底层日志写入（仅写文件，不输出控制台） */
export function log(level: string, msg: string, ctx?: Record<string, unknown>) {
  const ts = timestamp()
  const extra = ctx ? " " + JSON.stringify(ctx) : ""
  const line = `[${ts}] [${level}] ${msg}${extra}`
  write(line)
}

/** INFO 级别日志（同时输出控制台） */
export function info(msg: string, ctx?: Record<string, unknown>) {
  console.log(msg)
  log("INFO", msg, ctx)
}

/** ERROR 级别日志（同时输出 stderr） */
export function error(msg: string, ctx?: Record<string, unknown>) {
  const display = ctx ? `${msg} ${JSON.stringify(ctx)}` : msg
  console.error(display)
  log("ERROR", msg, ctx)
}

/** WARN 级别日志（同时输出控制台） */
export function warn(msg: string, ctx?: Record<string, unknown>) {
  console.warn(msg)
  log("WARN", msg, ctx)
}

/** DEBUG 级别日志（仅写文件，不输出控制台） */
export function debug(msg: string, ctx?: Record<string, unknown>) {
  log("DEBUG", msg, ctx)
}
