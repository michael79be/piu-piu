export interface Signed {
  signature: string;
  authenticatorData: string;
  clientData: string;
}