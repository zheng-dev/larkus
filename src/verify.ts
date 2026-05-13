import { createHmac } from "node:crypto"
import { Config } from "./config"

export function verifySignature(timestamp: string, signature: string, body: string): boolean {
  if (!Config.webhook.verificationToken) return true
  const hmac = createHmac("sha256", Config.webhook.verificationToken)
  hmac.update(timestamp)
  hmac.update(body)
  return hmac.digest("base64") === signature
}
