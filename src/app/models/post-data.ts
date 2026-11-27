import { AvatarService } from "../settings/settings-dialog";

export interface Signed {
  signature?: string;
  authenticatorData?: string;
  clientData?: string;
  publicKey?: string;
}

export enum MetaData {
  Settings = '@settings',
  Follow = '@follow',
  Followers = '@followers'
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

export interface Followed {
  accountName: string;
  profileUrl: string;
  lastId?: string; // UUID of the last synced post (newest post known to follower)
}

export interface FollowData extends PostData {
  follows: Followed[];
}

export interface FollowersData extends PostData {
  followers: Record<string, FollowData>;
}