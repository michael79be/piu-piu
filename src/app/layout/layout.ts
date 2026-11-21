import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { RoomService } from '../room/room.service';
import { Menu } from '../menu/menu';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [RouterOutlet, Menu],
  templateUrl: './layout.html',
  styleUrl: './layout.scss'
})
export class Layout implements OnInit {
  private router = inject(Router);
  private authService = inject(AuthService);
  private roomService = inject(RoomService);

  accountName = signal<string | null>(null);

  isSignedIn = this.authService.isSignedIn;
  storedSigner = this.authService.storedSigner;
  signerMatchesAccount = this.authService.signerMatchesAccount;

  canPost = computed(() => this.isSignedIn());

  ngOnInit(): void {
    this.updateLayoutState();

    // Listen for route changes
    this.router.events.subscribe(() => {
      this.updateLayoutState();
    });

    // Join global room if already signed in (session restore)
    if (this.authService.isSignedIn()) {
      this.roomService.joinGlobalRoom().catch(err => console.error('Failed to join global room:', err));
    }
  }

  private updateLayoutState(): void {
    const url = this.router.url;
    const isAccountPage = url.startsWith('/@');
    
    // Extract account name from URL for account pages
    if (isAccountPage) {
      const match = url.match(/^\/@([^/]+)/);
      if (match) {
        this.accountName.set(match[1]);
      }
    } else {
      this.accountName.set(this.storedSigner()?.account ?? null);
    }
  }
}