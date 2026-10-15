# Pre-flight spike

Proves that a Chrome extension can read the Salesforce session and the Tooling API, including in an org that signs in with passkeys. Not for release.

1. Open Chrome, go to `chrome://extensions`, switch on **Developer mode** (top right).
2. Click **Load unpacked** and choose this folder (`preflight-spike`).
3. Open a Salesforce tab and sign in as usual (the Lakewood sandbox for the passkey test, then the DealPulse test org).
4. Click the extension's icon (the puzzle piece, then "Pre-flight spike"), then **Run the three checks**.
5. Send back the text in the box. It names the org and counts flows; it never shows the session value.
