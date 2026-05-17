/**
 * verify - 飞书 Webhook 签名验证
 *
 * 使用 HMAC-SHA256 验证飞书开放平台推送的请求签名，
 * 确保消息确实来自飞书服务器。
 */
import { createHmac } from "node:crypto"
import { Config } from "./config"

/**
 * 验证飞书请求签名
 * @param timestamp X-Lark-Request-Timestamp 请求头
 * @param signature X-Lark-Signature 请求头
 * @param body 原始请求体字符串
 * @returns 签名是否有效（未配置 verificationToken 时始终返回 true）
 */
export function verifySignature(timestamp: string, signature: string, body: string): boolean {
  if (!Config.webhook.verificationToken) return true
  const hmac = createHmac("sha256", Config.webhook.verificationToken)
  hmac.update(timestamp)
  hmac.update(body)
  return hmac.digest("base64") === signature
}
