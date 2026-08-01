/**
 * Run this ONCE, on your own computer (not on Railway), to generate the
 * refresh token that lets the server create calendar events on a
 * business's behalf without them logging in every time.
 *
 * Usage:
 *   1. npm install googleapis
 *   2. node get-refresh-token.js
 *   3. Open the URL it prints, sign in with the Google account whose
 *      calendar should receive booked appointments, approve access.
 *   4. Paste the code it gives you back into this terminal.
 *   5. Copy the refresh token it prints into your Railway environment
 *      variables as GOOGLE_REFRESH_TOKEN.
 *
 * Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to already be set
 * as environment variables when you run this (see SETUP-CALENDAR.md
 * for where to get these from Google Cloud Console).
 */

const { google } = require('googleapis');
const readline = require('readline');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET as environment variables before running this script.');
  console.error('Example: GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy node get-refresh-token.js');
  process.exit(1);
}

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, 'urn:ietf:wg:oauth:2.0:oob');

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/calendar.events']
});

console.log('\n1. Open this URL in your browser:\n');
console.log(authUrl);
console.log('\n2. Sign in with the Google account that owns the calendar you want appointments added to.');
console.log('3. Approve access, then copy the code Google shows you.\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Paste the code here: ', async (code) => {
  rl.close();
  try {
    const { tokens } = await oAuth2Client.getToken(code.trim());
    console.log('\nSuccess! Add this to your Railway environment variables:\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('\n(Also make sure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set in Railway too — same values you used here.)\n');
  } catch (e) {
    console.error('Failed to exchange code for tokens:', e.message);
  }
});
