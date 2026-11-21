import { ProfileData } from './profile-data';
import { Signed } from './signed';

export interface SignerInfo extends ProfileData, Signed {
  account: string;
  providerPrefix?: string;
  subscription?: string;
}