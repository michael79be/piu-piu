import { Injectable, inject } from '@angular/core';
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { CryptoService } from '../crypto/crypto.service';
import { MessageData, SettingsData, FollowData, MetaData, Signed } from '../models/post-data';
import { SubscriptionData } from '../models/subscription-data';
import { SignerInfo } from '../models/signer-info';
import { v7 as uuidv7 } from 'uuid';
import { AvatarService } from '../settings/settings-dialog';

interface PostsDB extends DBSchema {
  posts: {
    key: string;
    value: string;
  };
}

@Injectable({ providedIn: 'root' })
export class PostService {
  private cryptoService = inject(CryptoService);
  private dbCache = new Map<string, Promise<IDBPDatabase<PostsDB>>>();

  private bytesToBase64(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes));
  }

  private base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  getDB(accountName: string): Promise<IDBPDatabase<PostsDB>> {
    if (!this.dbCache.has(accountName)) {
      this.dbCache.set(accountName, openDB<PostsDB>(accountName, 1, {
        upgrade(db) {
          db.createObjectStore('posts');
        },
      }));
    }
    return this.dbCache.get(accountName)!;
  }

  private createSigningString(post: MessageData): string {
    return `${post.uuid}:${post.senderAccount}:${post.timestamp}:${post.content}`;
  }

  async createPost(signer: SignerInfo, content: string): Promise<MessageData | null> {
    if (!signer) return null;

    const uuid = uuidv7();
    const timestamp = Date.now();

    const messageData: MessageData = { 
      uuid,
      sender: signer.username,
      senderAccount: signer.account,
      timestamp,
      content,
      publicKey: signer.publicKey,
    };

    const signingString = this.createSigningString(messageData);
    const challenge = await this.hashChallenge(signingString);

    console.log('[createPost] signingString:', signingString);
    console.log('[createPost] challenge length:', challenge.length);

    try {
      const cred = await navigator.credentials.get({
        publicKey: {
          challenge: challenge as unknown as ArrayBuffer,
          timeout: 60000,
          userVerification: 'preferred'
        }
      }) as PublicKeyCredential;

      const response = cred.response as AuthenticatorAssertionResponse;
      const authData = response.authenticatorData ? new Uint8Array(response.authenticatorData) : new Uint8Array(0);
      const clientData = response.clientDataJSON ? new Uint8Array(response.clientDataJSON) : new Uint8Array(0);
      const signature = response.signature ? new Uint8Array(response.signature) : new Uint8Array(0);

      console.log('[createPost] authData length:', authData.length);
      console.log('[createPost] clientData length:', clientData.length);
      console.log('[createPost] signature length:', signature.length);

      let username = signer.username;
      if (response.userHandle) {
        const decoder = new TextDecoder('utf-8');
        username = decoder.decode(response.userHandle) ?? signer.username;
      }

      const post: MessageData = {
        ...messageData,
        sender: username,
        signature: this.bytesToBase64(signature),
        authenticatorData: this.bytesToBase64(authData),
        clientData: this.bytesToBase64(clientData),
      };

      const db = await this.getDB(signer.account);
      await db.put('posts', JSON.stringify(post), uuid);

      return post;
    } catch (e) {
      console.error('WebAuthn sign failed:', e);
      return null;
    }
  }

  private async hashChallenge(data: string): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const hash = await window.crypto.subtle.digest('SHA-256', encoder.encode(data));
    return new Uint8Array(hash);
  }

  async getPost(accountName: string, uuid: string): Promise<MessageData | null> {
    const db = await this.getDB(accountName);
    const data = await db.get('posts', uuid);
    if (!data) return null;
    const post = JSON.parse(data);
    const result = this.deserializePost(post);
    if ('sender' in result) {
      return result as MessageData;
    }
    return null;
  }

  async getAllPosts(accountName: string): Promise<MessageData[]> {
    const db = await this.getDB(accountName);
    const tx = db.transaction('posts', 'readonly');
    const store = tx.objectStore('posts');
    const allKeys = await store.getAllKeys();
    const allValues = await store.getAll();
    await tx.done;
    
    const posts: MessageData[] = [];
    for (let i = 0; i < allKeys.length; i++) {
      if (typeof allKeys[i] === 'string' && allKeys[i].startsWith('@')) continue;
      const post = this.deserializePost(JSON.parse(allValues[i]));
      if ('sender' in post) {
        posts.push(post as MessageData);
      }
    }
    return posts.sort((a, b) => b.timestamp - a.timestamp);
  }

  async getMeta(accountName: string): Promise<(SettingsData | FollowData)[]> {
    console.log('[getMeta] START account:', accountName);
    const db = await this.getDB(accountName);
    console.log('[getMeta] got db');
    const tx = db.transaction('posts', 'readonly');
    const store = tx.objectStore('posts');
    const allKeys = await store.getAllKeys();
    const allValues = await store.getAll();
    console.log('[getMeta] waiting for tx.done');
    await tx.done;
    console.log('[getMeta] tx.done resolved');
    
    console.log('[getMeta] account:', accountName, 'allKeys:', allKeys);
    console.log('[getMeta] @ keys:', allKeys.filter(k => typeof k === 'string' && k.startsWith('@')));
    
    const results: (SettingsData | FollowData)[] = [];
    for (let i = 0; i < allKeys.length; i++) {
      const key = allKeys[i];
      const value = allValues[i];
      if (typeof key === 'string' && key.startsWith('@')) {
        try {
          const parsed = JSON.parse(value);
          console.log('[getMeta] found @ key:', key, 'data:', parsed);
          results.push(parsed);
        } catch {
          // Ignore parse errors
        }
      }
    }
    console.log('[getMeta] results:', results);
    return results.sort((a, b) => {
      const ta = 'timestamp' in a && typeof a.timestamp === 'number' ? a.timestamp : 0;
      const tb = 'timestamp' in b && typeof b.timestamp === 'number' ? b.timestamp : 0;
      return tb - ta;
    });
  }

  private deserializePost(post: Record<string, unknown>): MessageData | SettingsData | FollowData | Signed {
    console.log('[deserializePost]', {
      keys: Object.keys(post),
      hasSignature: !!post['signature'],
      hasAuthenticatorData: !!post['authenticatorData'],
      hasClientData: !!post['clientData'],
      hasPublicKey: !!post['publicKey'],
    });
    
    const result = {
      ...post,
      signature: post['signature'] as string,
      authenticatorData: post['authenticatorData'] as string,
      clientData: post['clientData'] as string,
      publicKey: post['publicKey'] as string,
    };
    
    console.log('[deserializePost] result', {
      signatureLength: result.signature?.length,
      authenticatorDataLength: result.authenticatorData?.length,
      clientDataLength: result.clientData?.length,
      publicKeyLength: result.publicKey?.length,
    });
    return result;
  }

  async deletePost(accountName: string, uuid: string): Promise<void> {
    const db = await this.getDB(accountName);
    await db.delete('posts', uuid);
  }

  async saveSubscription(accountName: string, subscription: PushSubscription | null): Promise<void> {
    const db = await this.getDB(accountName);
    if (subscription) {
      const subData: SubscriptionData = {
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime,
        keys: {
          p256dh: this.bytesToBase64(new Uint8Array(subscription.getKey('p256dh')!)),
          auth: this.bytesToBase64(new Uint8Array(subscription.getKey('auth')!)),
        },
      };
      await db.put('posts', JSON.stringify(subData), '@subscription');
    } else {
      await db.delete('posts', '@subscription');
    }
  }

  async getSubscription(accountName: string): Promise<PushSubscription | null> {
    const db = await this.getDB(accountName);
    const data = await db.get('posts', '@subscription');
    if (!data) return null;
    const subData = JSON.parse(data) as SubscriptionData;
    
    // Reconstruct PushSubscription from stored data
    const keys = {
      p256dh: this.base64ToBytes(subData.keys.p256dh),
      auth: this.base64ToBytes(subData.keys.auth),
    };
    
    // Create a minimal PushSubscription-like object
    return {
      endpoint: subData.endpoint,
      expirationTime: subData.expirationTime,
      getKey: (name: string) => {
        if (name === 'p256dh') return keys.p256dh.buffer;
        if (name === 'auth') return keys.auth.buffer;
        return null;
      },
      toJSON: () => ({
        endpoint: subData.endpoint,
        expirationTime: subData.expirationTime,
        keys: {
          p256dh: subData.keys.p256dh,
          auth: subData.keys.auth,
        },
      }),
    } as unknown as PushSubscription;
  }

  private createSettingsSigningString(avatarUrl: string, avatarService: string, pushEnabled: boolean): string {
    return `${avatarUrl}|${avatarService}:${pushEnabled ? '1' : '0'}`;
  }

  private async hashSettingsChallenge(avatarUrl: string, avatarService: string, pushEnabled: boolean): Promise<Uint8Array> {
    const signingString = this.createSettingsSigningString(avatarUrl, avatarService, pushEnabled);
    const encoder = new TextEncoder();
    const hash = await window.crypto.subtle.digest('SHA-256', encoder.encode(signingString));
    return new Uint8Array(hash);
  }

  async saveSettings(signer: SignerInfo, avatarUrl: string, avatarService: AvatarService, pushEnabled: boolean): Promise<SettingsData | null> {
    if (!signer) return null;

    const challenge = await this.hashSettingsChallenge(avatarUrl, avatarService, pushEnabled);

    try {
      const cred = await navigator.credentials.get({
        publicKey: {
          challenge: challenge as unknown as ArrayBuffer,
          timeout: 60000,
          userVerification: 'preferred'
        }
      }) as PublicKeyCredential;

      const response = cred.response as AuthenticatorAssertionResponse;
      const authData = response.authenticatorData ? new Uint8Array(response.authenticatorData) : new Uint8Array(0);
      const clientData = response.clientDataJSON ? new Uint8Array(response.clientDataJSON) : new Uint8Array(0);
      const signature = response.signature ? new Uint8Array(response.signature) : new Uint8Array(0);

      let username = signer.username;
      if (response.userHandle) {
        const decoder = new TextDecoder('utf-8');
        username = decoder.decode(response.userHandle) ?? signer.username;
      }

      const settingsData: SettingsData = {
        uuid: MetaData.Settings,
        settings: {
          avatarUrl,
          avatarService,
          pushEnabled,
        },
        signature: this.bytesToBase64(signature),
        authenticatorData: this.bytesToBase64(authData),
        clientData: this.bytesToBase64(clientData),
        publicKey: signer.publicKey,
      };

      const db = await this.getDB(signer.account);
      await db.put('posts', JSON.stringify(settingsData), '@settings');

      // Broadcast settings to peers
      return settingsData;
    } catch (e) {
      console.error('WebAuthn sign failed for settings:', e);
      return null;
    }
  }

  async getSettings(accountName: string): Promise<SettingsData | null> {
    const db = await this.getDB(accountName);
    const data = await db.get('posts', '@settings');
    if (!data) return null;
    const parsed = JSON.parse(data) as SettingsData;
    return parsed;
  }

  private createFollowSigningString(follows: Record<string, string>): string {
    const sortedKeys = Object.keys(follows ?? {}).sort();
    return sortedKeys.map(k => `${k}:${follows[k]}`).join('|');
  }

  private async hashFollowChallenge(follows: Record<string, string>): Promise<Uint8Array> {
    const signingString = this.createFollowSigningString(follows);
    const encoder = new TextEncoder();
    const hash = await window.crypto.subtle.digest('SHA-256', encoder.encode(signingString));
    return new Uint8Array(hash);
  }

  async saveFollow(signer: SignerInfo, targetAccount: string, targetProfileUrl: string): Promise<FollowData | null> {
    if (!signer) return null;

    // Load existing follows
    const existingFollows = await this.getFollow(signer.account);
    const follows = existingFollows ? { ...existingFollows.follows } : {};
    follows[targetAccount] = targetProfileUrl;

    const challenge = await this.hashFollowChallenge(follows);

    console.log('[saveFollow] signingString:', this.createFollowSigningString(follows));
    console.log('[saveFollow] challenge length:', challenge.length);

    try {
      const cred = await navigator.credentials.get({
        publicKey: {
          challenge: challenge as unknown as ArrayBuffer,
          timeout: 60000,
          userVerification: 'preferred'
        }
      }) as PublicKeyCredential;

      const response = cred.response as AuthenticatorAssertionResponse;
      const authData = response.authenticatorData ? new Uint8Array(response.authenticatorData) : new Uint8Array(0);
      const clientData = response.clientDataJSON ? new Uint8Array(response.clientDataJSON) : new Uint8Array(0);
      const signature = response.signature ? new Uint8Array(response.signature) : new Uint8Array(0);

      console.log('[saveFollow] authData length:', authData.length);
      console.log('[saveFollow] clientData length:', clientData.length);
      console.log('[saveFollow] signature length:', signature.length);

      let username = signer.username;
      if (response.userHandle) {
        const decoder = new TextDecoder('utf-8');
        username = decoder.decode(response.userHandle) ?? signer.username;
      }

      const followData: FollowData = {
        uuid: MetaData.Follow,
        follows,
        signature: this.bytesToBase64(signature),
        authenticatorData: this.bytesToBase64(authData),
        clientData: this.bytesToBase64(clientData),
        publicKey: signer.publicKey,
      };

      const db = await this.getDB(signer.account);
      await db.put('posts', JSON.stringify(followData), '@follow');

      return followData;
    } catch (e) {
      console.error('WebAuthn sign failed for follow:', e);
      return null;
    }
  }

  async unfollow(signer: SignerInfo, targetAccount: string): Promise<FollowData | null> {
    if (!signer) return null;

    const existingFollows = await this.getFollow(signer.account);
    if (!existingFollows) return null;

    const follows = { ...existingFollows.follows };
    delete follows[targetAccount];

    const challenge = await this.hashFollowChallenge(follows);

    try {
      const cred = await navigator.credentials.get({
        publicKey: {
          challenge: challenge as unknown as ArrayBuffer,
          timeout: 60000,
          userVerification: 'preferred'
        }
      }) as PublicKeyCredential;

      const response = cred.response as AuthenticatorAssertionResponse;
      const authData = response.authenticatorData ? new Uint8Array(response.authenticatorData) : new Uint8Array(0);
      const clientData = response.clientDataJSON ? new Uint8Array(response.clientDataJSON) : new Uint8Array(0);
      const signature = response.signature ? new Uint8Array(response.signature) : new Uint8Array(0);

      const followData: FollowData = {
        uuid: MetaData.Follow,
        follows,
        signature: this.bytesToBase64(signature),
        authenticatorData: this.bytesToBase64(authData),
        clientData: this.bytesToBase64(clientData),
        publicKey: signer.publicKey,
      };

      const db = await this.getDB(signer.account);
      if (Object.keys(follows).length === 0) {
        await db.delete('posts', '@follow');
      } else {
        await db.put('posts', JSON.stringify(followData), '@follow');
      }

      return followData;
    } catch (e) {
      console.error('WebAuthn sign failed for unfollow:', e);
      return null;
    }
  }

  async getFollow(accountName: string): Promise<FollowData | null> {
    const db = await this.getDB(accountName);
    const data = await db.get('posts', '@follow');
    if (!data) return null;
    const parsed = JSON.parse(data) as FollowData;
    // Return null if follows is empty (corrupted data)
    if (!parsed.follows || Object.keys(parsed.follows).length === 0) return null;
    return parsed;
  }

  async verifyFollow(followData: FollowData, publicKey: string): Promise<boolean> {
    if (!followData.signature || followData.signature.length === 0) return false;

    const follows = followData.follows ?? {};
    const keys = Object.keys(follows);
    if (keys.length === 0) return false; // No follows to verify

    const expectedChallenge = await this.hashFollowChallenge(follows);

    try {
      const clientDataBytes = this.base64ToBytes(followData.clientData ?? '');
      const authDataBytes = this.base64ToBytes(followData.authenticatorData ?? '');
      const signatureBytes = this.base64ToBytes(followData.signature);
      const publicKeyBytes = this.base64ToBytes(publicKey);

      const clientDataHash = new Uint8Array(
        await window.crypto.subtle.digest('SHA-256', clientDataBytes as BufferSource)
      );

      const signedData = new Uint8Array(authDataBytes.length + clientDataHash.length);
      signedData.set(authDataBytes, 0);
      signedData.set(clientDataHash, authDataBytes.length);

      // Verify the challenge in clientData matches our expected challenge
      const clientDataJson = new TextDecoder().decode(clientDataBytes);
      let actualChallenge: Uint8Array | null = null;
      try {
        const parsed = JSON.parse(clientDataJson);
        if (parsed.challenge) {
          actualChallenge = this.base64UrlToBytes(parsed.challenge);
        }
      } catch (e) {
        console.error('[verifyFollow] Failed to parse clientDataJSON:', e);
      }

      console.log('[verifyFollow] follows:', JSON.stringify(follows));
      console.log('[verifyFollow] expectedChallenge length:', expectedChallenge.length);
      console.log('[verifyFollow] actualChallenge length:', actualChallenge?.length);
      console.log('[verifyFollow] challenge match:', actualChallenge ? this.bytesEqual(expectedChallenge, actualChallenge) : 'no challenge in clientData');

      if (!actualChallenge || !this.bytesEqual(expectedChallenge, actualChallenge)) {
        console.error('[verifyFollow] Challenge mismatch!');
        return false;
      }

      const publicKeyBase64 = this.bytesToBase64(publicKeyBytes);
      const cryptoKey = await this.cryptoService.importPublicKey(publicKeyBase64);
      const rawSignature = this.cryptoService.derToRawSignature(signatureBytes);

      return await window.crypto.subtle.verify(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        cryptoKey,
        rawSignature as BufferSource,
        signedData as BufferSource
      );
    } catch (e) {
      console.error('Follow verification failed:', e);
      return false;
    }
  }

  async isFollowing(accountName: string, targetAccount: string, publicKey: string): Promise<boolean> {
    const followData = await this.getFollow(accountName);
    if (!followData) return false;
    const isValid = await this.verifyFollow(followData, publicKey);
    if (!isValid) return false;
    return targetAccount in followData.follows;
  }

  async verifyPost(post: MessageData): Promise<boolean> {
    if (!post.signature || post.signature.length === 0) return false;

    if (!post.sender) return false;

    const postWithoutSig: MessageData = {
      uuid: post.uuid,
      sender: post.sender,
      senderAccount: post.senderAccount,
      timestamp: post.timestamp,
      content: post.content,
    };

    const signingString = this.createSigningString(postWithoutSig);
    const expectedChallenge = await this.hashChallenge(signingString);

    try {
      // Decode base64 fields
      const clientDataBytes = this.base64ToBytes(post.clientData ?? '');
      const authDataBytes = this.base64ToBytes(post.authenticatorData ?? '');
      const signatureBytes = this.base64ToBytes(post.signature);
      const publicKeyBytes = this.base64ToBytes(post.publicKey ?? '');

      const clientDataHash = new Uint8Array(
        await window.crypto.subtle.digest('SHA-256', clientDataBytes as BufferSource)
      );

      const signedData = new Uint8Array(authDataBytes.length + clientDataHash.length);
      signedData.set(authDataBytes, 0);
      signedData.set(clientDataHash, authDataBytes.length);

      // Verify the challenge in clientData matches our expected challenge
      const clientDataJson = new TextDecoder().decode(clientDataBytes);
      let actualChallenge: Uint8Array | null = null;
      try {
        const parsed = JSON.parse(clientDataJson);
        if (parsed.challenge) {
          // WebAuthn challenge is base64url encoded
          actualChallenge = this.base64UrlToBytes(parsed.challenge);
        }
      } catch (e) {
        console.error('[verifyPost] Failed to parse clientDataJSON:', e);
      }

      console.log('[verifyPost]', {
        uuid: post.uuid,
        signingString,
        expectedChallengeLength: expectedChallenge.length,
        actualChallengeLength: actualChallenge?.length,
        challengeMatch: actualChallenge ? this.bytesEqual(expectedChallenge, actualChallenge) : 'no challenge in clientData',
        authDataLength: authDataBytes.length,
        clientDataLength: clientDataBytes.length,
        clientDataHashLength: clientDataHash.length,
        signedDataLength: signedData.length,
        signatureLength: signatureBytes.length,
        publicKeyLength: publicKeyBytes.length,
      });

      if (!actualChallenge || !this.bytesEqual(expectedChallenge, actualChallenge)) {
        console.error('[verifyPost] Challenge mismatch!');
        return false;
      }

      const publicKeyBase64 = this.bytesToBase64(publicKeyBytes);
      const cryptoKey = await this.cryptoService.importPublicKey(publicKeyBase64);
      const rawSignature = this.cryptoService.derToRawSignature(signatureBytes);

      console.log('[verifyPost] rawSignature', { length: rawSignature.length });

      return await window.crypto.subtle.verify(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        cryptoKey,
        rawSignature as BufferSource,
        signedData as BufferSource
      );
    } catch (e) {
      console.error('Verification failed:', e);
      return false;
    }
  }

  private base64UrlToBytes(base64url: string): Uint8Array {
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  private bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  async getVerifiedPosts(accountName: string): Promise<MessageData[]> {
    const allPosts = await this.getAllPostsWithFullData(accountName);
    console.log('[getVerifiedPosts] total posts:', allPosts.length);
    const verifiedPosts: MessageData[] = [];
    for (const post of allPosts) {
      console.log('[getVerifiedPosts] checking post:', post.uuid);
      if (await this.verifyPost(post)) {
        console.log('[getVerifiedPosts] post verified:', post.uuid);
        verifiedPosts.push(post);
      } else {
        console.log('[getVerifiedPosts] post FAILED verification:', post.uuid);
      }
    }
    return verifiedPosts;
  }

  async getAllPostsWithFullData(accountName: string): Promise<MessageData[]> {
    const db = await this.getDB(accountName);
    const tx = db.transaction('posts', 'readonly');
    const store = tx.objectStore('posts');
    const allKeys = await store.getAllKeys();
    const allValues = await store.getAll();
    await tx.done;
    
    const posts: MessageData[] = [];
    for (let i = 0; i < allKeys.length; i++) {
      if (typeof allKeys[i] === 'string' && allKeys[i].startsWith('@')) continue;
      const post = this.deserializePost(JSON.parse(allValues[i]));
      if ('sender' in post) {
        posts.push(post as MessageData);
      }
    }
    return posts.sort((a, b) => b.timestamp - a.timestamp);
  }
}