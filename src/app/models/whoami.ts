import { FollowData } from "./post-data";

export interface WhoamiPayload {
  username: string;
  account: string;
  providerSuffix: string;
  subscription?: string;
  follow?: FollowData;
}