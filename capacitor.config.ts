import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hema.uni',
  appName: 'Hema Uni',
  webDir: 'dist',
  server: { androidScheme: 'https' }
};

export default config;