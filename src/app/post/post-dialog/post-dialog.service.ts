import { Injectable, inject } from '@angular/core';
import { TuiDialogService } from '@taiga-ui/core';
import { PolymorpheusComponent } from '@taiga-ui/polymorpheus';
import { Router } from '@angular/router';
import { RoomService } from '../../room/room.service';
import { AuthService } from '../../auth/auth.service';
import { MessageData } from '../../models/post-data';
import { SignerInfo } from '../../models/signer-info';

@Injectable({ providedIn: 'root' })
export class PostDialogService {
  private dialogService = inject(TuiDialogService);
  private router = inject(Router);
  private roomService = inject(RoomService);
  private authService = inject(AuthService);

  async open(signerMatchesAccount: boolean): Promise<void> {
    const signer = this.authService.storedSigner() as SignerInfo | null;
    const accountName = signer?.account;
    if (!accountName) return;

    if (!signerMatchesAccount) {
      await this.router.navigateByUrl(`/@${accountName}`);
    }

    const { PostDialogComponent } = await import('./post-dialog.component');

    this.dialogService.open<MessageData>(new PolymorpheusComponent(PostDialogComponent), {
      size: 'm',
      closable: true,
      dismissible: true,
      label: 'Create Post',
      data: { accountName },
    }).subscribe(async (post: MessageData) => {
      if (post) {
        await this.roomService.broadcastPost(post);
        window.dispatchEvent(new CustomEvent('piu-piu:load-posts', { detail: { accountName } }));
      }
    });
  }
}