import { joinRoom } from 'trystero';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { RTCPeerConnection } from 'werift';

const APP_ID = 'piu-piu';
const ROOM_NAME = 'piu-piu';
const CONNECT_TIMEOUT = 30000; // 30 seconds to connect

// Parse command line arguments
// Usage: node pull_accounts.mjs [outputPath] [collectionTimeMs]
// Default: outputPath = 'accounts/public.json', collectionTimeMs = 10000 (10 seconds)
const args = process.argv.slice(2);
const OUTPUT_PATH = resolve(args[0] || 'accounts/public.json');
const COLLECTION_TIME = parseInt(args[1] || '10000', 10);

/**
 * @typedef {Object} SignerInfo
 * @property {string} username
 * @property {string} account
 * @property {string} publicKey
 * @property {string} authenticatorData
 * @property {string} clientData
 * @property {string} signature
 * @property {string} profileUrl
 * @property {string} [subscription]
 */

/**
 * @typedef {Object} AccountEntry
 * @property {string} username
 * @property {string} account
 * @property {string} publicKey
 * @property {string} profileUrl
 * @property {string} [subscription]
 * @property {number} lastSeen
 */

async function loadExistingAccounts() {
  const map = new Map();
  if (existsSync(OUTPUT_PATH)) {
    try {
      const data = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
      for (const entry of data.accounts || []) {
        map.set(entry.account, entry);
      }
    } catch {
      console.warn('Failed to parse existing accounts file');
    }
  }
  return map;
}

function saveAccounts(accounts) {
  const dir = resolve(OUTPUT_PATH, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const sorted = Array.from(accounts.values()).sort((a, b) => b.lastSeen - a.lastSeen);
  const data = {
    updatedAt: Date.now(),
    count: sorted.length,
    accounts: sorted,
  };
  writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2));
  console.log(`Saved ${sorted.length} accounts to ${OUTPUT_PATH}`);
}

async function main() {
  console.log(`Connecting to ${APP_ID}/${ROOM_NAME}...`);
  console.log(`Output: ${OUTPUT_PATH}, Collection time: ${COLLECTION_TIME}ms`);

  // Use trystero with rtcPolyfill = RTCPeerConnection (werift)
  const room = joinRoom(
    { appId: APP_ID, rtcPolyfill: RTCPeerConnection },
    ROOM_NAME
  );

  const whoamiAction = room.makeAction('whoami');

  const accounts = await loadExistingAccounts();
  let collected = 0;
  let peerJoins = 0;

  whoamiAction.onMessage((data, context) => {
    collected++;
    const signerInfo = data.signerInfo;
    if (!signerInfo) {
      console.warn('[whoami] missing signerInfo in payload:', data);
      return;
    }
    const entry = {
      username: signerInfo.username,
      account: signerInfo.account,
      publicKey: signerInfo.publicKey,
      profileUrl: signerInfo.profileUrl,
      subscription: signerInfo.subscription,
      lastSeen: Date.now(),
    };
    accounts.set(signerInfo.account, entry);
    console.log(`[whoami] @${signerInfo.account} (${signerInfo.username}) from peer ${context.peerId}${signerInfo.subscription ? ' [subscription]' : ''}`);
  });

  room.onPeerJoin((context) => {
    peerJoins++;
    console.log(`[peerJoin] peer ${context.peerId} joined (userId: ${context.userId})`);
  });

  room.onPeerLeave((context) => {
    console.log(`[peerLeave] peer ${context.peerId} left`);
  });

  room.onError((error) => {
    console.error(`[error]`, error);
  });

  // Wait for room to be ready with timeout
  try {
    await Promise.race([
      room.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), CONNECT_TIMEOUT)),
    ]);
    console.log('Room ready.');
  } catch (err) {
    console.error('Failed to connect:', err.message);
    room.leave();
    process.exit(1);
  }

  // Wait a bit more for peer discovery
  console.log('Waiting 10s for peer discovery...');
  await new Promise(resolve => setTimeout(resolve, 10000));

  console.log(`Collecting whoami for ${COLLECTION_TIME}ms...`);

  // Wait for collection period
  await new Promise(resolve => setTimeout(resolve, COLLECTION_TIME));

  room.leave();
  console.log(`Collection complete. Total unique accounts: ${accounts.size} (${collected} whoami, ${peerJoins} peer joins)`);

  saveAccounts(accounts);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});