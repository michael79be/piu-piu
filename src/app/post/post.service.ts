import { Injectable, inject } from '@angular/core';
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { AuthService, SignerInfo } from '../auth/auth.service';
import { CryptoService } from '../crypto/crypto.service';

export interface PostData {
  uuid: string;
  sender: string;
  senderAccount: string;
  timestamp: number;
  content: string;
  publicKey: string; // base64
  signature: string; // base64
  authenticatorData: string; // base64
  clientData: string; // base64
}

export interface SubscriptionData {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

interface PostsDB extends DBSchema {
  posts: {
    key: string;
    value: string;
  };
}

@Injectable({ providedIn: 'root' })
export class PostService {
  private authService = inject(AuthService);
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

  private createSigningString(post: Omit<PostData, 'signature' | 'authenticatorData' | 'clientData' | 'publicKey'>): string {
    return `${post.uuid}:${post.senderAccount}:${post.timestamp}:${post.content}`;
  }

  async createPost(accountName: string, content: string): Promise<PostData | null> {
    const signer = this.authService.storedSigner();
    if (!signer) return null;

    const uuid = crypto.randomUUID();
    const timestamp = Date.now();

    const postData: Omit<PostData, 'signature' | 'authenticatorData' | 'clientData'> = {
      uuid,
      sender: signer.username,
      senderAccount: signer.account,
      timestamp,
      content,
      publicKey: signer.publicKey,
    };

    const signingString = this.createSigningString(postData);
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

      const post: PostData = {
        ...postData,
        sender: username,
        signature: this.bytesToBase64(signature),
        authenticatorData: this.bytesToBase64(authData),
        clientData: this.bytesToBase64(clientData),
      };

      const db = await this.getDB(accountName);
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

  async getPost(accountName: string, uuid: string): Promise<PostData | null> {
    const db = await this.getDB(accountName);
    const data = await db.get('posts', uuid);
    if (!data) return null;
    const post = JSON.parse(data);
    return this.deserializePost(post);
  }

  async getAllPosts(accountName: string): Promise<PostData[]> {
    const db = await this.getDB(accountName);
    const tx = db.transaction('posts', 'readonly');
    const store = tx.objectStore('posts');
    const allKeys = await store.getAllKeys();
    const allValues = await store.getAll();
    await tx.done;
    
    const posts: PostData[] = [];
    for (let i = 0; i < allKeys.length; i++) {
      if (typeof allKeys[i] === 'string' && allKeys[i].startsWith('@')) continue;
      posts.push(this.deserializePost(JSON.parse(allValues[i])));
    }
    return posts.sort((a, b) => b.timestamp - a.timestamp);
  }

  private deserializePost(post: Record<string, unknown>): PostData {
    console.log('[deserializePost] raw post keys:', Object.keys(post));
    console.log('[deserializePost] signature present:', !!post['signature']);
    console.log('[deserializePost] authenticatorData present:', !!post['authenticatorData']);
    console.log('[deserializePost] clientData present:', !!post['clientData']);
    console.log('[deserializePost] publicKey present:', !!post['publicKey']);
    
    const result = {
      ...post,
      signature: post['signature'] as string,
      authenticatorData: post['authenticatorData'] as string,
      clientData: post['clientData'] as string,
      publicKey: post['publicKey'] as string,
    } as PostData;
    
    console.log('[deserializePost] result signature length:', result.signature?.length);
    console.log('[deserializePost] result authenticatorData length:', result.authenticatorData?.length);
    console.log('[deserializePost] result clientData length:', result.clientData?.length);
    console.log('[deserializePost] result publicKey length:', result.publicKey?.length);
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

  async verifyPost(post: PostData): Promise<boolean> {
    if (!post.signature || post.signature.length === 0) return false;

    const postWithoutSig: Omit<PostData, 'signature' | 'authenticatorData' | 'clientData' | 'publicKey'> = {
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
      const clientDataBytes = this.base64ToBytes(post.clientData);
      const authDataBytes = this.base64ToBytes(post.authenticatorData);
      const signatureBytes = this.base64ToBytes(post.signature);
      const publicKeyBytes = this.base64ToBytes(post.publicKey);

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

      console.log('[verifyPost] post uuid:', post.uuid);
      console.log('[verifyPost] signingString:', signingString);
      console.log('[verifyPost] expectedChallenge length:', expectedChallenge.length);
      console.log('[verifyPost] actualChallenge length:', actualChallenge?.length);
      console.log('[verifyPost] challenge match:', actualChallenge ? this.bytesEqual(expectedChallenge, actualChallenge) : 'no challenge in clientData');
      console.log('[verifyPost] authData length:', authDataBytes.length);
      console.log('[verifyPost] clientData length:', clientDataBytes.length);
      console.log('[verifyPost] clientDataHash length:', clientDataHash.length);
      console.log('[verifyPost] signedData length:', signedData.length);
      console.log('[verifyPost] signature length:', signatureBytes.length);
      console.log('[verifyPost] publicKey length:', publicKeyBytes.length);

      if (!actualChallenge || !this.bytesEqual(expectedChallenge, actualChallenge)) {
        console.error('[verifyPost] Challenge mismatch!');
        return false;
      }

      const publicKeyBase64 = this.bytesToBase64(publicKeyBytes);
      const cryptoKey = await this.cryptoService.importPublicKey(publicKeyBase64);
      const rawSignature = this.cryptoService.derToRawSignature(signatureBytes);

      console.log('[verifyPost] rawSignature length:', rawSignature.length);

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

  async getVerifiedPosts(accountName: string): Promise<PostData[]> {
    const allPosts = await this.getAllPosts(accountName);
    console.log('[getVerifiedPosts] total posts:', allPosts.length);
    const verifiedPosts: PostData[] = [];
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
}