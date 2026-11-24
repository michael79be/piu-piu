import { ProfileData } from './profile-data';
import { Signed } from './post-data';

export interface SignerInfo extends ProfileData {
  account: string;
  providerSuffix?: string;
  subscription?: string;
}