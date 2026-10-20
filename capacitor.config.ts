import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native shell for Android and iOS. The app loads the PUBLISHED Mestolo site
 * (same code as the web version, server-rendered) and adds native features.
 *
 *   CAP_SERVER_URL  public HTTPS address of the deployed site (required for store builds)
 *                   e.g. https://mestolo.vercel.app — for device tests on the LAN you can use
 *                   http://<PC-IP>:3000 (cleartext is then enabled automatically, never in store builds)
 *   CAP_APP_ID      bundle/application id (must be unique on the stores)
 *
 * Run `npm run mobile:sync` after changing these values.
 */
// Values can live in .env.local (Node >= 20.12 loads it here); shell variables take precedence.
for (const f of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(f);
  } catch {
    /* file not present */
  }
}

const serverUrl = (process.env.CAP_SERVER_URL ?? 'https://mestolo.example.com').replace(/\/+$/, '');
const host = new URL(serverUrl).hostname;

const config: CapacitorConfig = {
  appId: process.env.CAP_APP_ID ?? 'com.markg981.mestolo',
  appName: 'Mestolo',
  webDir: 'mobile/www',
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith('http://'),
    allowNavigation: [host],
    // Local page shown when the site cannot be reached (no connection, server down)
    errorPath: 'offline.html',
  },
  ios: {
    // Needed for the service worker (offline copies) inside WKWebView; see WKAppBoundDomains in Info.plist
    limitsNavigationsToAppBoundDomains: true,
    contentInset: 'never',
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: '#2a1a2e',
      showSpinner: false,
    },
  },
};

export default config;
