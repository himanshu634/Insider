import { createHmac } from 'node:crypto';

/**
 * HMAC-SHA256 (lowercase hex, 64 chars) of a sender JID. The plain JID never leaves the Mac.
 *
 * No normalisation: the JID is hashed exactly as WhatsApp stores it. This matches
 * services/api/src/security.ts, which uses the same SENDER_HMAC_KEY.
 */
export function hashSender(jid: string, key: string): string {
  if (!key) throw new Error('SENDER_HMAC_KEY is empty');
  return createHmac('sha256', key).update(jid).digest('hex');
}
