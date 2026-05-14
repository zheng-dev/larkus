import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"

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

export function log(level: string, msg: string, ctx?: Record<string, unknown>) {
  const ts = timestamp()
  const extra = ctx ? " " + JSON.stringify(ctx) : ""
  const line = `[${ts}] [${level}] ${msg}${extra}`
  write(line)
}

export function info(msg: string, ctx?: Record<string, unknown>) {
  console.log(msg)
  log("INFO", msg, ctx)
}

export function error(msg: string, ctx?: Record<string, unknown>) {
  const display = ctx ? `${msg} ${JSON.stringify(ctx)}` : msg
  console.error(display)
  log("ERROR", msg, ctx)
}

export function warn(msg: string, ctx?: Record<string, unknown>) {
  console.warn(msg)
  log("WARN", msg, ctx)
}

export function debug(msg: string, ctx?: Record<string, unknown>) {
  log("DEBUG", msg, ctx)
}
