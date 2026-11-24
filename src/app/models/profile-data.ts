import { AvatarService } from "../settings/settings-dialog";
import { Signed } from "./post-data";

export interface ProfileData extends Signed {
  username: string;
  publicKey: string;
  provider?: string;
  accountName?: string;
  profileUrl?: string;
  avatarUrl?: string;
  avatarService?: AvatarService;
}