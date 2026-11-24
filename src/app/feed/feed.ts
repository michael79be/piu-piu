import { Component, computed, inject, OnInit, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { LaIconComponent, LaIconLibrary } from 'angular-line-awesome';
import { lasClock, lasShieldAlt, lasList, lasSpinner, lasRss, lasUser } from 'angular-line-awesome/icons';
import { RoomService } from '../room/room.service';
import { AuthService } from '../auth/auth.service';
import { PostService } from '../post/post.service';
import { MessageData } from '../models/post-data';
import { CryptoService } from '../crypto/crypto.service';
import { PostDialogService } from '../post/post-dialog/post-dialog.service';

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [CommonModule, LaIconComponent],
  templateUrl: './feed.html',
  styleUrl: './feed.scss'
})
export class Feed implements OnInit, OnDestroy {
  private router = inject(Router);
  private roomService = inject(RoomService);
  private authService = inject(AuthService);
  private postService = inject(PostService);
  private postDialogService = inject(PostDialogService);
  private cryptoService = inject(CryptoService);
  private library = inject(LaIconLibrary);

  posts = signal<MessageData[]>([]);
  loading = signal(false);
  gravatarCache = signal<Map<string, string>>(new Map());
  followedAccounts = signal<string[]>([]);

  private handlePostsUpdated = (event: CustomEvent) => {
    const detail = event.detail;
    if (!detail?.accountName) {
      this.loadFeed();
    } else if (this.followedAccounts().includes(detail.accountName)) {
      this.loadFeed();
    }
  };

  constructor() {
    this.library.addIcons([lasClock, lasShieldAlt, lasList, lasSpinner, lasRss]);
  }

  private updateTitle(): void {
    const accountName = this.authService.storedSigner()?.account;
    if (accountName) {
      document.title = `Piu-Piu :: @${accountName}`;
    } else {
      document.title = 'Piu-Piu';
    }
  }

  ngOnInit(): void {
    this.updateTitle();
    this.loadFeed();

    // Listen for P2P post events
    window.addEventListener('piu-piu:load-posts', this.handlePostsUpdated as EventListener);
  }

  ngOnDestroy(): void {
    window.removeEventListener('piu-piu:load-posts', this.handlePostsUpdated as EventListener);
    document.title = 'Piu-Piu';
  }

  canPost = computed(() => this.authService.isSignedIn() && this.authService.storedSigner()?.account);

  async loadFeed(): Promise<void> {
    const viewerAccount = this.authService.storedSigner()?.account;
    const viewerPublicKey = this.authService.storedSigner()?.publicKey;
    if (!viewerAccount || !viewerPublicKey) {
      this.posts.set([]);
      return;
    }

    this.loading.set(true);
    try {
      // Get follow data
      const followData = await this.postService.getFollow(viewerAccount);
      if (!followData) {
        this.posts.set([]);
        return;
      }

      const isValid = await this.postService.verifyFollow(followData, viewerPublicKey);
      if (!isValid) {
        this.posts.set([]);
        return;
      }

      const followedAccounts = followData.follows.map(f => f.accountName);
      this.followedAccounts.set(followedAccounts);
      if (followedAccounts.length === 0) {
        this.posts.set([]);
        return;
      }

      // Collect posts from all followed accounts
      const allPosts: MessageData[] = [];
      for (const targetAccount of followedAccounts) {
        const verifiedPosts = await this.postService.getVerifiedPosts(targetAccount);
        allPosts.push(...verifiedPosts);
      }

      // Sort by timestamp descending (newest first)
      allPosts.sort((a, b) => b.timestamp - a.timestamp);
      this.posts.set(allPosts);

      // Preload gravatar URLs for all unique sender accounts
      const uniqueAccounts = [...new Set(allPosts.map(p => p.senderAccount))];
      const newCache = new Map(this.gravatarCache());
      for (const account of uniqueAccounts) {
        const settings = await this.postService.getSettings(account);
        if (settings?.settings?.avatarUrl) {
          newCache.set(account, settings.settings.avatarUrl);
        } else {
          newCache.set(account, '');
        }
      }
      this.gravatarCache.set(newCache);
    } catch (e) {
      console.error('Failed to load feed:', e);
      this.posts.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  openPostDialog(): void {
    this.postDialogService.open(false);
  }

  formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;
    return date.toLocaleDateString();
  }

  getAvatarUrl(senderAccount: string): string {
    const cached = this.gravatarCache().get(senderAccount);
    if (cached !== undefined) return cached;
    // Fetch avatar asynchronously if not cached
    this.fetchAndCacheAvatar(senderAccount);
    return '';
  }

  private async fetchAndCacheAvatar(senderAccount: string): Promise<void> {
    if (this.gravatarCache().has(senderAccount)) return;
    const settings = await this.postService.getSettings(senderAccount);
    const newCache = new Map(this.gravatarCache());
    if (settings?.settings?.avatarUrl) {
      newCache.set(senderAccount, settings.settings.avatarUrl);
    } else {
      newCache.set(senderAccount, '');
    }
    this.gravatarCache.set(newCache);
  }

  getMessageData(post: MessageData): MessageData {
    return post;
  }

  navigateToPost(post: MessageData): void {
    this.router.navigateByUrl(`/@${post.senderAccount}#${post.uuid}`).then(() => {
      setTimeout(() => {
        const element = document.getElementById(`post-${post.uuid}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    });
  }
}