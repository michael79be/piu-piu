export enum ProviderTag {
  IsGd = '#@',
  Vgd = '#v@',
  Localhost = '#l@'
}

export const ProviderTagMap: Record<string, ProviderTag> = {
  'https://is.gd': ProviderTag.IsGd,
  'https://v.gd': ProviderTag.Vgd,
  'http://localhost:3000': ProviderTag.Localhost,
};

export const LocalhostProviderUrl = 'http://localhost:3000';
