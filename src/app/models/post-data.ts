import { Signed } from './signed';

export interface PostData extends Signed {
  uuid: string;
  sender: string;
  senderAccount: string;
  timestamp: number;
  content: string;
  publicKey: string;
}