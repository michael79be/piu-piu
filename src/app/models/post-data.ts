import { AvatarService } from "../settings/settings-dialog";

export interface Signed {
  signature?: string;
  authenticatorData?: string;
  clientData?: string;
  publicKey?: string;
}

export enum MetaData {
  Settings = '@settings',
  Follow = '@follow'
};

export interface PostData extends Signed {
  uuid: string | MetaData;
}

export interface MessageData extends PostData {
  sender: string;
  senderAccount: string;
  timestamp: number;
  content: string;
}

export interface SettingsData extends PostData {
  settings: {
    avatarUrl: string;
    avatarService: AvatarService;
    pushEnabled: boolean;
  }
}

export interface FollowData extends PostData {
  follows: Record<string, string>;
}