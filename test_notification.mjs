import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { sendNotification, setVapidDetails, generateVAPIDKeys } from 'web-push';
import elliptic from 'elliptic';

const PRIVATE_KEY_PEM = process.env.PRIVATE_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const ACCOUNTS_FILE = resolve(process.argv[2] || 'accounts/public.json');
const TEST_MESSAGE = process.env.TEST_MESSAGE;
const TEST_ACCOUNT = process.env.TEST_ACCOUNT;

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

// Derive VAPID public key from private key using elliptic
function deriveVapidPublicKey(privateKeyBase64Url) {
  // Convert base64url to base64
  const base64 = privateKeyBase64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const privateKeyHex = Buffer.from(base64 + padding, 'base64').toString('hex');
  
  const EC = elliptic.ec;
  const ec = new EC('p256');
  const keyPair = ec.keyFromPrivate(privateKeyHex, 'hex');
  const publicKey = keyPair.getPublic('hex'); // uncompressed 04 + x + y (130 hex chars = 65 bytes)
  
  // Convert to base64url
  const publicKeyBytes = Buffer.from(publicKey, 'hex');
  return publicKeyBytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
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
  const data = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf-8'));
  const accounts = data.accounts || [];
  const privateKey = await importPrivateKey(PRIVATE_KEY_PEM);

  // Derive VAPID public key from private key
  const vapidPublicKey = deriveVapidPublicKey(VAPID_PRIVATE_KEY);

  setVapidDetails(
    'mailto:test@piu-piu.top',
    vapidPublicKey,
    VAPID_PRIVATE_KEY
  );

  let sent = 0;
  let failed = 0;

  const filteredAccounts = TEST_ACCOUNT
    ? accounts.filter(a => a.username === TEST_ACCOUNT)
    : accounts;

  if (filteredAccounts.length === 0 && TEST_ACCOUNT) {
    console.log(`Account @${TEST_ACCOUNT} not found`);
    process.exit(1);
  }

  for (const account of filteredAccounts) {
    if (!account.subscription) {
      console.log(`Skipping ${account.username} - no subscription`);
      continue;
    }

    try {
      const decrypted = await rsaDecrypt(account.subscription, privateKey);
      const subscription = JSON.parse(decrypted);
      const payload = JSON.stringify({
        title: 'Piu-Piu Test',
        body: TEST_MESSAGE || `Test notification for @${account.username}`,
        data: { test: true, timestamp: Date.now() }
      });
      await sendNotification(subscription, payload);
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