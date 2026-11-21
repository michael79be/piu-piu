import { Signed } from './signed';

export interface SettingsData extends Signed {
  avatarUrl: string;
  avatarService: 'gravatar' | 'libravatar';
  pushEnabled: boolean;
}