import { joinRoom } from 'trystero';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { RTCPeerConnection } from 'werift';

const APP_ID = 'piu-piu';
const ROOM_NAME = 'piu-piu';
const CONNECT_TIMEOUT = 60000; // 60 seconds to connect
const PEER_DISCOVERY_WAIT = 15000; // 15 seconds for peer discovery
const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

const args = process.argv.slice(2);
const OUTPUT_PATH = resolve(args[0] || 'accounts/test.json');
const COLLECTION_TIME = parseInt(args[1] || '10000', 10);

async function loadExistingAccounts() {
  const map = new Map();
  if (existsSync(OUTPUT_PATH)) {
    try {
      const data = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
      for (const entry of data.accounts || []) {
        const key = getAccountKey(entry);
        const existing = map.get(key);
        if (!existing || entry.lastSeen > existing.lastSeen) {
          map.set(key, entry);
        }
      }
    } catch {
      console.warn('Failed to parse existing accounts file');
    }
  }
  return map;
}

function getAccountKey(entry) {
  return `${entry.username}|${entry.account}|${entry.providerSuffix}`;
}

function getAccountKeyByAccount(entry) {
  return entry.account;
}

function saveAccounts(accounts) {
  const dir = resolve(OUTPUT_PATH, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const now = Date.now();
  const filtered = Array.from(accounts.values())
    .filter(entry => now - entry.lastSeen < MAX_AGE)
    .sort((a, b) => b.lastSeen - a.lastSeen);

  // Failsafe: deduplicate by account name (should be unique per account)
  const dedupedByAccount = new Map();
  for (const entry of filtered) {
    const accountKey = getAccountKeyByAccount(entry);
    const existing = dedupedByAccount.get(accountKey);
    if (!existing || entry.lastSeen > existing.lastSeen) {
      dedupedByAccount.set(accountKey, entry);
    }
  }
  const finalAccounts = Array.from(dedupedByAccount.values());

  const newData = {
    updatedAt: now,
    count: finalAccounts.length,
    accounts: finalAccounts,
  };

  if (existsSync(OUTPUT_PATH)) {
    try {
      const oldData = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
      const oldAccounts = oldData.accounts || [];
      const newAccounts = newData.accounts;

      if (oldAccounts.length === newAccounts.length) {
        const same = oldAccounts.every((acc, i) => {
          const newAcc = newAccounts[i];
          return acc.account === newAcc.account &&
            acc.username === newAcc.username &&
            acc.publicKey === newAcc.publicKey &&
            acc.profileUrl === newAcc.profileUrl &&
            acc.subscription === newAcc.subscription;
        });
        if (same) {
          console.log('No changes to accounts data, skipping write');
          return;
        }
      }
    } catch {
      // Failed to parse, will write new file
    }
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(newData, null, 2));
  console.log(`Saved ${finalAccounts.length} accounts to ${OUTPUT_PATH} (deduped from ${filtered.length})`);
}

async function joinRoomWithRetry() {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Try different relay servers on each attempt
    const relays = [
      'wss://yabu.me/',  // Default relay
      'wss://relay.trystero.dev/',  // Alternative relay
    ];
    const relayUrl = relays[(attempt - 1) % relays.length];
    
    console.log(`Connecting to ${APP_ID}/${ROOM_NAME} via ${relayUrl} (attempt ${attempt}/${MAX_RETRIES})...`);
    const room = joinRoom(
      { appId: APP_ID, rtcPolyfill: RTCPeerConnection, relay: relayUrl },
      ROOM_NAME
    );

    try {
      await Promise.race([
        room.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), CONNECT_TIMEOUT)),
      ]);
      console.log('Room ready.');
      return room;
    } catch (err) {
      lastError = err;
      console.error(`Connection attempt ${attempt} failed:`, err.message);
      room.leave();
      if (attempt < MAX_RETRIES) {
        console.log(`Waiting ${RETRY_DELAY}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      }
    }
  }
  throw lastError;
}

async function main() {
  console.log(`Output: ${OUTPUT_PATH}, Collection time: ${COLLECTION_TIME}ms`);

  let room;
  try {
    room = await joinRoomWithRetry();
  } catch (err) {
    console.error('All connection attempts failed:', err.message);
    process.exit(1);
  }

  const whoamiAction = room.makeAction('whoami');

  const accounts = await loadExistingAccounts();
  let collected = 0;
  let peerJoins = 0;
  let errorCount = 0;

  whoamiAction.onMessage((data, context) => {
    collected++;
    if (!data || !data.username) {
      console.warn('[whoami] missing username in payload:', data);
      return;
    }
    const entry = {
      username: data.username,
      account: data.account,
      providerSuffix: data.providerSuffix,
      subscription: data.subscription,
      follow: data.follow,
      lastSeen: Date.now(),
    };
    const key = getAccountKey(entry);
    const existing = accounts.get(key);
    if (!existing || entry.lastSeen > existing.lastSeen) {
      accounts.set(key, entry);
    }
    const followCount = data.follow?.follows ? Object.keys(data.follow.follows).length : 0;
    console.log(`[whoami] @${data.account} (${data.username}) providerSuffix: ${data.providerSuffix}${data.subscription ? ' [subscription]' : ''}${followCount ? ' [follows: ' + followCount + ']' : ''} from peer ${context.peerId}`);
  });

  room.onPeerJoin((context) => {
    peerJoins++;
    console.log(`[peerJoin] peer ${context.peerId} joined (userId: ${context.userId})`);
  });

  room.onPeerLeave((context) => {
    console.log(`[peerLeave] peer ${context.peerId} left`);
  });

  room.onError((error) => {
    errorCount++;
    console.error(`[error]`, error);
  });

  // Wait a bit more for peer discovery
  console.log(`Waiting ${PEER_DISCOVERY_WAIT}ms for peer discovery...`);
  await new Promise(resolve => setTimeout(resolve, PEER_DISCOVERY_WAIT));

  console.log(`Collecting whoami for ${COLLECTION_TIME}ms...`);

  // Wait for collection period
  await new Promise(resolve => setTimeout(resolve, COLLECTION_TIME));

  room.leave();
  console.log(`Collection complete. Total unique accounts: ${accounts.size} (${collected} whoami, ${peerJoins} peer joins, ${errorCount} errors)`);

  if (accounts.size === 0) {
    console.error('No accounts collected - peer connection failures');
    process.exit(1);
  }

  if (errorCount > 0) {
    console.warn(`Collection had ${errorCount} peer connection errors (continuing with collected accounts)`);
  }

  saveAccounts(accounts);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});