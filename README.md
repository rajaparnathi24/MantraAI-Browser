# MantraAI Browser

MantraAI Browser is an Electron browser with optional Firebase Authentication. Browsing, tabs, and the new-tab page continue to work when nobody is signed in.

For browser UI colors, branding, and layout conventions, read [Design.md](Design.md) before making interface changes. Keep the Midnight Saffron theme common across app-owned surfaces and preserve the current logo and working browser behavior.

## Firebase setup

1. In Firebase Console, open the **mantraai-browser** project and add a Web app if one is not already registered. Copy its Web API key, auth domain, project ID, app ID, and messaging sender ID from the app's Firebase configuration.
2. In **Authentication → Sign-in method**, enable **Email/Password** and **Google**. Complete the Google provider configuration for the project.
3. In Google Cloud Console for the same project, configure the OAuth consent screen. If it is in testing mode, add the Google accounts you will use as test users.
4. Under **APIs & Services → Credentials**, create an OAuth 2.0 Client ID with application type **Desktop app**. Copy only its client ID. The app uses the system browser, a loopback callback, authorization code flow, and PKCE; it does not use an embedded Google login window or a client secret.
5. Firebase Web API keys and Google Desktop OAuth client IDs are public client identifiers used by this desktop client. Never add Firebase Admin credentials, service-account keys, or OAuth client secrets.

Google's desktop OAuth client supports the loopback redirect used by this app; no fixed port needs to be registered. Ensure the desktop client belongs to the same Google Cloud project as the Google provider enabled in Firebase. If Firebase rejects the Google credential for an audience mismatch, verify the Google provider's configured OAuth client and the desktop client are from the same project.

## Local development

```powershell
Copy-Item .env.example .env
# Edit .env and fill in your Firebase and Google client ID values.
npm install
npm start
```

Open **Sign in** from the right-side assistant panel. Email/password sign-up and login are available there; Google sign-in opens the default system browser. Auth is optional. In development, copy `.env.example` to `.env` in the project root and fill in the Firebase Web app values and `GOOGLE_OAUTH_CLIENT_ID`. The development app reads this local file when it starts. `.env` remains git-ignored and is never packaged.

Sessions are persisted by encrypting the Firebase refresh token with Electron `safeStorage` and storing it in the app's user-data directory. Passwords and OAuth client secrets are never written to disk or sent to a web page.

## Windows installer

The Windows installer never contains `.env` or Firebase credentials. After installing, create `firebase-config.json` in the app's user-data folder and add the Firebase Web app settings and Google Desktop OAuth client ID. The default Windows folder is `%APPDATA%\MantraAI Browser` (the Electron `app.getPath('userData')` directory). For example, create `%APPDATA%\MantraAI Browser\firebase-config.json` with:

```json
{
  "FIREBASE_API_KEY": "your-firebase-web-api-key",
  "FIREBASE_AUTH_DOMAIN": "mantraai-browser.firebaseapp.com",
  "FIREBASE_PROJECT_ID": "mantraai-browser",
  "FIREBASE_APP_ID": "your-firebase-app-id",
  "FIREBASE_MESSAGING_SENDER_ID": "your-messaging-sender-id",
  "GOOGLE_OAUTH_CLIENT_ID": "your-desktop-oauth-client-id.apps.googleusercontent.com"
}
```

You can use [`firebase-config.example.json`](firebase-config.example.json) as a template. Restart the app after saving the file. If you do not configure it, browsing still works and authentication remains optional.

Then build the installer from the project directory:

```powershell
npm run dist
```

The NSIS installer is written to `dist/`. The build packages only the app files listed in `package.json`; runtime Firebase configuration is read from the user-data file and is not bundled. Changing the installed app's config file does not require rebuilding the installer.

## Security notes

The app window uses `contextIsolation: true` and `nodeIntegration: false`; the preload exposes only browser actions and a small allow-listed auth API. Google OAuth is performed in the system browser using PKCE and a short-lived loopback listener. Firebase client settings are not secrets, but backend access must still be protected with Firebase Authentication and Security Rules. Never bundle an Admin SDK key or service-account credential in the desktop app.

References: [Firebase Authentication REST API](https://firebase.google.com/docs/reference/rest/auth), [Google OAuth for desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app), [Google OAuth best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices), [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage/).
