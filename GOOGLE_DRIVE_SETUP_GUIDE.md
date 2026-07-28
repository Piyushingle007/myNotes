# ☁️ Complete Google Drive Cloud Sync Setup Guide for myNotes

Welcome! This step-by-step guide will walk you through setting up **Google Drive Cloud Sync** for **myNotes**, even if you have zero technical knowledge or have never used Google Cloud before.

> [!NOTE]
> **Is this safe?** Yes! You are creating your own private Google Cloud project. **myNotes** can only access files that it creates in your Google Drive. None of your data is sent to any third-party server.
>
> **Do I have to do this every time?** **No!** This is a **one-time setup**. Once connected, your notes and budget dashboards will automatically sync in the background whenever you make changes.

---

## 📋 Table of Contents
1. [Step 1: Open Google Cloud Console](#step-1-open-google-cloud-console)
2. [Step 2: Create a New Project](#step-2-create-a-new-project)
3. [Step 3: Enable the Google Drive API](#step-3-enable-the-google-drive-api)
4. [Step 4: Configure the OAuth Consent Screen](#step-4-configure-the-oauth-consent-screen)
5. [Step 5: Create your OAuth Client ID Credentials](#step-5-create-your-oauth-client-id-credentials)
6. [Step 6: Connect myNotes to Google Drive](#step-6-connect-mynotes-to-google-drive)
7. [❓ Troubleshooting & FAQs](#-troubleshooting--faqs)

---

## Step 1: Open Google Cloud Console

1. Open your web browser on a phone or laptop.
2. Go to the [Google Cloud Console](https://console.cloud.google.com/).
3. Sign in with your standard Google / Gmail account if prompted.

---

## Step 2: Create a New Project

1. At the top left of the screen (next to the "Google Cloud" logo), click the **Select a project** dropdown menu (it might show "Select a project" or an existing project name).
2. A pop-up window will open. Click the **NEW PROJECT** button in the top-right corner of the pop-up.
3. On the New Project screen:
   - **Project Name**: Type `myNotes Sync` (or any name you like).
   - Leave **Location** as "No organization".
4. Click the blue **CREATE** button at the bottom.
5. Wait 5–10 seconds for Google to finish creating the project.
6. Click the project selector dropdown again and **select your new `myNotes Sync` project**.

---

## Step 3: Enable the Google Drive API

1. In the search bar at the very top center of the Google Cloud page, type `Google Drive API`.
2. In the search results list, click on **Google Drive API** (under Marketplace / APIs).
3. Click the blue **ENABLE** button.
4. Wait a few seconds until you are taken to the Google Drive API Overview page.

---

## Step 4: Configure the OAuth Consent Screen

Google requires you to set up a basic consent screen before creating credentials.

1. Click the ☰ **Navigation Menu** icon (top-left 3 horizontal lines) OR use the left sidebar.
2. Go to **APIs & Services** ➔ **OAuth consent screen**.
3. Under **User Type**, select **External**.
4. Click the blue **CREATE** button.

### Page 1: App Information
1. **App name**: Type `myNotes`
2. **User support email**: Click the dropdown and select your Google / Gmail address.
3. Scroll all the way down to **Developer contact information**.
4. **Email addresses**: Type your Google / Gmail address again.
5. Click **SAVE AND CONTINUE** at the bottom.

### Page 2: Scopes
1. You do **NOT** need to add any special scopes here.
2. Simply scroll down and click **SAVE AND CONTINUE**.

### Page 3: Test Users
1. Under **Test users**, click **+ ADD USERS**.
2. Type your Google / Gmail email address.
3. Click **ADD**.
4. Click **SAVE AND CONTINUE**.

### Page 4: Summary
1. Scroll down to the bottom and click **BACK TO DASHBOARD**.

---

## Step 5: Create your OAuth Client ID Credentials

1. In the left sidebar, click on **Credentials** (under APIs & Services).
2. At the top of the screen, click **+ CREATE CREDENTIALS** and select **OAuth client ID**.
3. On the Create OAuth client ID page:
   - **Application type**: Click the dropdown and select **Desktop app**.
     - ⚠️ **Important:** Choose **Desktop app**, *not* "Web application". The Desktop app type is a "public client" — it lets myNotes securely obtain a **refresh token** (so you stay logged in) without needing a client secret.
   - **Name**: Leave as `Desktop client 1` (or change it if you like).
4. Click the blue **CREATE** button at the bottom.
   - A Desktop app client automatically allows the `http://localhost` redirect used by myNotes — you do **not** need to add any redirect URIs manually.
5. A pop-up titled **OAuth client created** will appear showing your **Client ID**.
6. Click the **Copy** icon next to your **Client ID** (it looks like `xxxxxxxxxxxx-xxxxxxxxxxxxxxxx.apps.googleusercontent.com`).

---

## Step 6: Connect myNotes to Google Drive

1. Open the **myNotes** app on your phone.
2. Go to **Settings** (gear icon) ➔ **Cloud Sync**.
3. In the **Google OAuth Client ID** field, paste your copied Client ID.
4. Make sure **OAuth Redirect URI** shows `http://localhost`.
5. Tap the **Connect with Google** button.

### Finishing the Browser Sign-In:
1. Your web browser will open showing the Google Sign-In page.
2. Select your Google account and sign in.
3. **If Google shows a warning ("Google hasn't verified this app")**:
   - Tap **Advanced** (or *Details*).
   - Tap **Go to myNotes (unsafe)** (don't worry, it's your own private project!).
4. Tap **Continue** to allow myNotes to access its data folder.
5. Once complete, your browser will attempt to redirect to `http://localhost` and display a page saying **"This site can't be reached" / "ERR_CONNECTION_REFUSED"**.
   - **THIS IS NORMAL AND EXPECTED!** (There is no server running on your phone at localhost).
6. Tap the **address bar** at the top of your browser.
7. **Copy the entire full URL** (it starts with `http://localhost/?code=...`).
8. Switch back to the **myNotes** app (it will say *"Waiting for browser sign-in..."*).
9. Tap **"Sign-in didn't return automatically?"** to expand the manual input box.
10. Paste your copied URL into the text box and tap **Verify & Connect**.

🎉 **Congratulations!** You are now connected. Because myNotes received a secure **refresh token**, you will **stay signed in** — the app renews access automatically in the background and you should never need to repeat this sign-in.

---

## ❓ Troubleshooting & FAQs

### Q: Why does the browser show "This site can't be reached" at the end?
> **Answer**: `http://localhost` is a placeholder address used for mobile security redirect. Google attaches your sign-in key inside the web address bar. When you copy that address bar link and paste it into myNotes, the app extracts the key and connects you immediately.

### Q: Do I have to repeat this process every time I open the app?
> **Answer**: **No!** During sign-in myNotes receives a secure **refresh token** which is saved on your device. The app uses it to automatically renew access in the background, so you stay connected — even after the app is closed and reopened.

### Q: I keep getting logged out / asked to sign in again. Why?
> **Answer**: This almost always means your OAuth client was created as a **"Web application"** instead of a **"Desktop app"**. Web application clients cannot issue refresh tokens to a client-only app, so access silently expires after ~1 hour. Go back to [Step 5](#step-5-create-your-oauth-client-id-credentials), create a new **Desktop app** OAuth client, paste the new Client ID into myNotes, and reconnect.

### Q: What if I get an "Access Blocked: App Has Not Completed Google Verification" error?
> **Answer**: Make sure you added your Gmail address under **Test Users** in [Step 4](#step-4-configure-the-oauth-consent-screen).

### Q: Where are my notes stored in Google Drive?
> **Answer**: They are stored in your Google Drive inside a dedicated, private `myNotes` folder or app storage area that only your app can access.
