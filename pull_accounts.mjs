import { joinRoom } from 'trystero';
import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { resolve } from 'path';
import { RTCPeerConnection } from 'werift';
import { createHash, createVerify } from 'crypto';
import { sendNotification, setVapidDetails } from 'web-push';
import elliptic from 'elliptic';

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
const LOG_PATH = resolve('accounts/test.log');
const IS_CI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

// Log to both console and file (skip file in CI)
function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  console.log(message);
  if (!IS_CI) {
    try {
      appendFileSync(LOG_PATH, line + '\n');
    } catch {
      // Ignore log errors
    }
  }
}

// Replace console.log with log for file output
const origLog = console.log;
console.log = function(message) {
  origLog.apply(console, arguments);
  if (!IS_CI) {
    try {
      appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${message}\n`);
    } catch {}
  }
};

// Track followed accounts from verified follow data
const followedAccounts = new Set();

// VAPID and crypto functions for push notifications
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const PRIVATE_KEY_PEM = process.env.PRIVATE_KEY;

function deriveVapidPublicKey(privateKeyBase64Url) {
  const base64 = privateKeyBase64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const privateKeyHex = Buffer.from(base64 + padding, 'base64').toString('hex');
  
  const EC = elliptic.ec;
  const ec = new EC('p256');
  const keyPair = ec.keyFromPrivate(privateKeyHex, 'hex');
  const publicKey = keyPair.getPublic('hex');
  
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

function isValidSubscription(obj) {
  return obj && 
         typeof obj === 'object' && 
         typeof obj.endpoint === 'string' && 
         obj.endpoint.length > 0 &&
         obj.keys &&
         typeof obj.keys.p256dh === 'string' &&
         typeof obj.keys.auth === 'string';
}

async function sendPushNotification(account, posts, vapidPublicKey, privateKey) {
  if (!account.subscription) return { sent: 0, failed: 0, skipped: 1 };
  
  try {
    const decrypted = await rsaDecrypt(account.subscription, privateKey);
    
    let subscription;
    try {
      subscription = JSON.parse(decrypted);
    } catch {
      console.log(`[push] Skipping @${account.username} - subscription field contains non-JSON: ${decrypted.substring(0, 50)}`);
      return { sent: 0, failed: 0, skipped: 1 };
    }
    
    if (!isValidSubscription(subscription)) {
      console.log(`[push] Skipping @${account.username} - decrypted data is not a valid PushSubscription`);
      return { sent: 0, failed: 0, skipped: 1 };
    }

    setVapidDetails(
      'mailto:test@piu-piu.top',
      vapidPublicKey,
      VAPID_PRIVATE_KEY
    );

    const payload = JSON.stringify({
      title: `Piu-Piu: ${posts.length} new post${posts.length > 1 ? 's' : ''}`,
      body: posts[0]?.content ? posts[0].content.substring(0, 100) : 'New posts available',
      accountName: account.account,
      data: { newPosts: posts.map(p => p.uuid), timestamp: Date.now() }
    });
    
    await sendNotification(subscription, payload);
    console.log(`[push] Sent notification to @${account.username} for ${posts.length} post(s)`);
    return { sent: 1, failed: 0, skipped: 0 };
  } catch (error) {
    console.error(`[push] Failed to send to @${account.username}:`, error.message);
    return { sent: 0, failed: 1, skipped: 0 };
  }
}

async function loadExistingAccounts() {
  const map = new Map();
  const followDataMap = new Map(); // account -> followData (with lastId)
  if (existsSync(OUTPUT_PATH)) {
    try {
      const data = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
      for (const entry of data.accounts || []) {
        const key = getAccountKey(entry);
        const existing = map.get(key);
        if (!existing || entry.lastSeen > existing.lastSeen) {
          map.set(key, entry);
        }
        // Store follow data with lastId for incremental sync
        if (entry.follow && entry.follow.follows) {
          followDataMap.set(entry.account, entry.follow);
        }
      }
    } catch {
      console.warn('Failed to parse existing accounts file');
    }
  }
  return { accounts: map, followDataMap };
}

function getAccountKey(entry) {
  return `${entry.username}|${entry.account}|${entry.providerSuffix}`;
}

function getAccountKeyByAccount(entry) {
  return entry.account;
}

// Verify WebAuthn signature for follow data
async function verifyFollowSignature(followData) {
  if (!followData || !followData.follows) return false;
  if (!followData.signature || !followData.authenticatorData || !followData.clientData || !followData.publicKey) {
    console.warn('[verifyFollow] Missing signature fields');
    return false;
  }

  try {
    // Build the signing string: sorted "accountName:profileUrl" joined with "|"
    // Note: lastId is NOT included in the signature
    const entries = followData.follows
      .map(f => `${f.accountName}:${f.profileUrl}`)
      .sort();
    const signingString = entries.join('|');

    // Hash the signing string
    const challengeHash = createHash('sha256').update(signingString).digest();

    // Decode base64 fields
    const clientDataBytes = Buffer.from(followData.clientData, 'base64');
    const authDataBytes = Buffer.from(followData.authenticatorData, 'base64');
    const signatureBytes = Buffer.from(followData.signature, 'base64');
    const publicKeyBytes = Buffer.from(followData.publicKey, 'base64');

    // Parse clientData to get the challenge
    let actualChallenge = null;
    try {
      const clientDataJson = clientDataBytes.toString('utf-8');
      const parsed = JSON.parse(clientDataJson);
      if (parsed.challenge) {
        // WebAuthn challenge is base64url encoded
        const base64 = parsed.challenge.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');
        actualChallenge = Buffer.from(padded, 'base64');
      }
    } catch {
      // Ignore parse errors
    }

    if (!actualChallenge || !actualChallenge.equals(challengeHash)) {
      console.warn('[verifyFollow] Challenge mismatch');
      return false;
    }

    // Verify signature: signedData = authData + clientDataHash
    const clientDataHash = createHash('sha256').update(clientDataBytes).digest();
    const signedData = Buffer.concat([authDataBytes, clientDataHash]);

    // Import public key and verify ECDSA P-256
    const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${publicKeyBytes.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
    const verifier = createVerify('sha256');
    verifier.update(signedData);
    verifier.end();

    return verifier.verify(publicKeyPem, signatureBytes);
  } catch (e) {
    console.error('[verifyFollow] Verification failed:', e.message);
    return false;
  }
}

async function processFollowData(followData, account) {
  if (!followData || !followData.follows) return;
  
  const isValid = await verifyFollowSignature(followData);
  if (!isValid) {
    console.warn(`[follow] Invalid signature for follow data from @${account}`);
    return;
  }
  
  console.info(`[follow] Verified follow data from @${account}: ${followData.follows.length} follows`);
  
  // Collect followed accounts
  for (const f of followData.follows) {
    followedAccounts.add(f.accountName);
  }
}

// Fetch posts from followed accounts using request/provide protocol
// Returns map of account -> { firstId (newest), lastId (oldest) }
async function fetchFollowedPosts(followedAccountsSet, followDataMap, accountsMap) {
  const accountBounds = new Map();
  
  // Initialize VAPID if keys are available
  let vapidPublicKey = null;
  let privateKey = null;
  if (VAPID_PRIVATE_KEY && PRIVATE_KEY_PEM) {
    vapidPublicKey = deriveVapidPublicKey(VAPID_PRIVATE_KEY);
    privateKey = await importPrivateKey(PRIVATE_KEY_PEM);
    console.log('[push] VAPID keys initialized for push notifications');
  }
  
  // Also join global room to broadcast requests to peers there
  let globalRoom = null;
  let globalRequestAction = null;
  let globalProvideAction = null;
  const globalPostsReceived = new Map(); // account -> posts[]
  
  try {
    globalRoom = joinRoom(
      { appId: APP_ID, rtcPolyfill: RTCPeerConnection, relay: 'wss://yabu.me/' },
      'piu-piu'
    );
    
    globalRequestAction = globalRoom.makeAction('request');
    globalProvideAction = globalRoom.makeAction('provide');
    
    globalProvideAction.onMessage((data) => {
      if (data.accountName && data.posts) {
        if (!globalPostsReceived.has(data.accountName)) {
          globalPostsReceived.set(data.accountName, []);
        }
        globalPostsReceived.get(data.accountName).push(...data.posts);
      }
    });
    
    await Promise.race([
      globalRoom.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Global room connection timeout')), 15000)),
    ]);
    console.log('[fetch] Global room connected for broadcasting requests');
  } catch (e) {
    console.warn('[fetch] Failed to connect to global room:', e.message);
    globalRoom = null;
  }
  
  for (const account of followedAccountsSet) {
    try {
      console.log(`[fetch] Requesting posts from @${account}...`);
      
      const room = joinRoom(
        { appId: APP_ID, rtcPolyfill: RTCPeerConnection, relay: 'wss://yabu.me/' },
        account
      );

      const requestAction = room.makeAction('request');
      const provideAction = room.makeAction('provide');
      
      let postsReceived = [];
      
      // Listen for provide response in account room
      provideAction.onMessage((data) => {
        if (data.accountName === account && data.posts) {
          postsReceived = data.posts;
        }
      });

      // Wait for room ready
      await Promise.race([
        room.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 15000)),
      ]);

      // Check if we have existing follow data with lastId for incremental sync
      const existingFollowData = followDataMap.get(account);
      const lastId = existingFollowData?.follows?.[0]?.lastId; // Use first follow's lastId as sync point
      
      // Send request for posts - use after=lastId for incremental sync
      const requestPayload = {
        accountName: account,
        requesterId: 'pull_accounts',
      };
      if (lastId) {
        requestPayload.after = lastId;
        console.log(`[fetch] Incremental sync from @${account} after ${lastId}`);
      }
      requestAction.send(requestPayload);
      
      // ALSO broadcast request in global room where account owners are online
      if (globalRequestAction) {
        console.log(`[fetch] Broadcasting request for @${account} in global room`);
        globalRequestAction.send(requestPayload);
      }

      // Wait for response
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Also check global room responses
      if (globalPostsReceived.has(account)) {
        postsReceived = [...postsReceived, ...globalPostsReceived.get(account)];
        // Deduplicate by uuid
        const seen = new Set();
        postsReceived = postsReceived.filter(p => {
          if (seen.has(p.uuid)) return false;
          seen.add(p.uuid);
          return true;
        });
      }

      if (postsReceived.length > 0) {
        console.log(`[fetch] Received ${postsReceived.length} posts from @${account}`);
        // Posts are sorted by timestamp descending (newest first)
        const firstId = postsReceived[0].uuid;      // newest
        const lastId = postsReceived[postsReceived.length - 1].uuid;  // oldest
        accountBounds.set(account, { firstId, lastId, count: postsReceived.length });
        
        // Send push notifications to followers who follow this account
        if (vapidPublicKey && privateKey) {
          for (const [followerAccount, followerData] of accountsMap) {
            // Check if this follower follows the account that posted
            const follows = followerData.follow?.follows;
            if (follows && follows.some(f => f.accountName === account)) {
              await sendPushNotification(followerData, postsReceived, vapidPublicKey, privateKey);
            }
          }
        }
      } else {
        console.log(`[fetch] No new posts from @${account}`);
        accountBounds.set(account, { firstId: null, lastId: null, count: 0 });
      }

      room.leave();
    } catch (e) {
      console.warn(`[fetch] Failed to get posts from @${account}:`, e.message);
      accountBounds.set(account, { firstId: null, lastId: null, count: 0 });
    }
  }
  
  if (globalRoom) {
    globalRoom.leave();
  }
  
  return accountBounds;
}

function saveAccounts(accounts, accountBounds = new Map()) {
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

  const { accounts, followDataMap } = await loadExistingAccounts();
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
    const followCount = data.follow?.follows ? data.follow.follows.length : 0;
    console.log(`[whoami] @${data.account} (${data.username}) providerSuffix: ${data.providerSuffix}${data.subscription ? ' [subscription]' : ''}${followCount ? ' [follows: ' + followCount + ']' : ''} from peer ${context.peerId}`);

    // Process follow data to collect followed accounts
    if (data.follow) {
      processFollowData(data.follow, data.account);
    }
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
    console.error(`Collection had ${errorCount} peer connection errors - failing`);
    process.exit(1);
  }

  // Fetch posts from followed accounts
  const posts = await fetchFollowedPosts(followedAccounts, followDataMap, accounts);

  saveAccounts(accounts, posts);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});