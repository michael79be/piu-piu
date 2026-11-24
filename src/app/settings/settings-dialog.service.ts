import { Injectable, inject } from '@angular/core';
import { TuiDialogService } from '@taiga-ui/core';
import { PolymorpheusComponent } from '@taiga-ui/polymorpheus';

@Injectable({ providedIn: 'root' })
export class SettingsDialogService {
  private dialogService = inject(TuiDialogService);

  async open(): Promise<{ avatarUrl: string; avatarService: string; pushEnabled: boolean } | null> {
    const { SettingsDialogComponent } = await import('./settings-dialog');
    
    return new Promise((resolve) => {
      this.dialogService.open<{ avatarUrl: string; avatarService: string; pushEnabled: boolean }>(
        new PolymorpheusComponent(SettingsDialogComponent),
        {
          size: 'm',
          closable: true,
          dismissible: true,
          label: 'Settings',
        }
      ).subscribe((result) => {
        resolve(result ?? null);
      });
    });
  }
}