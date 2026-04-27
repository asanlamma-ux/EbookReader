function parseEnvFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'yes';
}

export const isGoogleSignInDisabled = () =>
  parseEnvFlag(process.env.EXPO_PUBLIC_DISABLE_GOOGLE_SIGN_IN, false);

export const isCloudSyncDisabled = () =>
  parseEnvFlag(process.env.EXPO_PUBLIC_DISABLE_CLOUD_SYNC, false);
