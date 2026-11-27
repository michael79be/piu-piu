import { FollowData, FollowersData, SettingsData } from "./post-data";

export interface WhoamiPayload {
  username: string;
  account: string;
  providerSuffix: string;
  subscription?: string;
  follow?: FollowData;
  followers?: FollowersData;
  settings?: SettingsData;
}