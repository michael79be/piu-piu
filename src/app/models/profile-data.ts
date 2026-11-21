export interface ProfileData {
  username: string;
  publicKey: string;
  provider?: string;
  accountName?: string;
  profileUrl?: string;
  avatarUrl?: string;
  avatarService?: 'gravatar' | 'libravatar';
}