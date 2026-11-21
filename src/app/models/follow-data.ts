import { Signed } from './signed';

export interface FollowData extends Signed {
  follows: Record<string, string>;
}