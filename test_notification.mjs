import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import webPush from 'web-push';

const PRIVATE_KEY_PEM = process.env.PRIVATE_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const ACCOUNTS_FILE = resolve(process.argv[2] || 'accounts/public.json');

if (!PRIVATE_KEY_PEM) {
  console.error('PRIVATE_KEY environment variable not set');
  process.exit(1);
}
if (!VAPID_PRIVATE_KEY) {
  console.error('VAPID_PRIVATE_KEY environment variable not set');
  process.exit(1);
}
if (!existsSync(ACCOUNTS_FILE)) {
  console.error(`Accounts file not found: ${ACCOUNTS_FILE}`);
  process.exit(1);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function importPrivateKey(pem) {
  const pemContents = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const binary = atob(pemContents);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return crypto.subtle.importKey('pkcs8', bytes, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
}

async function rsaDecrypt(encryptedData, privateKey) {
  const combined = base64ToBytes(encryptedData);
  const encryptedAesKey = combined.slice(0, 256);
  const iv = combined.slice(256, 268);
  const data = combined.slice(268);
  const decryptedAesKey = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, encryptedAesKey);
  const aesKey = await crypto.subtle.importKey('raw', decryptedAesKey, { name: 'AES-GCM' }, false, ['decrypt']);
  const decryptedData = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, data);
  return new TextDecoder().decode(decryptedData);
}

async function sendTestNotification() {
  const accounts = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf-8'));
  const privateKey = await importPrivateKey(PRIVATE_KEY_PEM);

  // web-push expects VAPID keys as base64url-encoded strings
  // The VAPID_PRIVATE_KEY from secrets should be the base64url private key
  webPush.setVapidDetails(
    'mailto:test@piu-piu.top',
    VAPID_PRIVATE_KEY, // public key (base64url)
    VAPID_PRIVATE_KEY  // private key (base64url) - web-push derives public from private
  );

  let sent = 0;
  let failed = 0;

  for (const account of accounts) {
    if (!account.subscription) {
      console.log(`Skipping ${account.username} - no subscription`);
      continue;
    }

    try {
      const decrypted = await rsaDecrypt(account.subscription, privateKey);
      const subscription = JSON.parse(decrypted);
      const payload = JSON.stringify({
        title: 'Piu-Piu Test',
        body: `Test notification for @${account.username}`,
        data: { test: true, timestamp: Date.now() }
      });
      await webPush.sendNotification(subscription, payload);
      console.log(`Sent test notification to @${account.username}`);
      sent++;
    } catch (error) {
      console.error(`Failed to send to @${account.username}:`, error.message);
      failed++;
    }
  }

  console.log(`Done: ${sent} sent, ${failed} failed`);
}

sendTestNotification().catch(console.error);