import { createHash, createHmac, randomBytes } from 'node:crypto';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const newDeviceToken = () => randomBytes(32).toString('base64url');

/** HMAC-SHA256 of a sender JID. The collector computes the same value on the Mac. */
export const senderHash = (jid: string, key: string) =>
  createHmac('sha256', key).update(jid).digest('hex');
