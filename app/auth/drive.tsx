import { Redirect } from 'expo-router';

/**
 * Drive OAuth redirect landing. AuthSession usually resolves before this
 * screen shows, but a concrete route prevents dead-end deep links.
 */
export default function AuthDriveScreen() {
  return <Redirect href="/(tabs)/settings" />;
}
