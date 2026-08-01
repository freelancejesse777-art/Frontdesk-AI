# Google integrations — setup guide

Two separate integrations, different complexity levels. Read the honest effort estimate before starting either.

---

## 1. Business search / autofill (in the browser demo) — ~5 minutes

Lets you search real businesses instead of typing the name by hand when demoing to a prospect.

### Get a Google Places API key
1. Go to console.cloud.google.com
2. Create a project (or use an existing one)
3. Go to **APIs & Services → Library**, search for **"Places API"**, click **Enable**
4. Go to **APIs & Services → Credentials → Create Credentials → API Key**
5. Copy the key

**Important — restrict the key before using it anywhere public:**
6. Click into the key you just made → under "Application restrictions," choose **"HTTP referrers"** and add the domain(s) you'll use this from. For testing in Claude's artifact panel, this step is optional, but don't skip it if you ever embed this on a public website — an unrestricted key can be used by anyone who finds it.

### Use it
1. Open `intake_ai_app.html`
2. Paste the API key into the **"Google Places API key"** field, click **Connect**
3. Start typing a real business name in the **"Business name"** field — a dropdown of real matches will appear
4. Pick one — it fills in automatically

This costs a small amount per search once you're past Google's free monthly quota (currently generous enough that casual demo use won't hit it), and there's no ongoing cost when you're not actively searching.

---

## 2. Calendar sync (on the real phone backend) — 20-30 minutes, one-time per business

Creates a real Google Calendar event automatically whenever a call books successfully. More setup than #1 because it needs to act *on behalf of* a real Google account (the business owner's), not just search public data.

### Step A — Create Google Cloud OAuth credentials
1. console.cloud.google.com → same project as above (or a new one)
2. **APIs & Services → Library** → enable **"Google Calendar API"**
3. **APIs & Services → OAuth consent screen** → set up as "External" if prompted, fill in basic app info (app name, your email) — this doesn't need to be publicly published, "Testing" mode is fine for now
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
5. Application type: **"Desktop app"**
6. Copy the **Client ID** and **Client Secret**

### Step B — Generate a refresh token (one-time, run on your own computer)
1. In the `phone-agent-backend` folder, run:
   ```
   npm install
   GOOGLE_CLIENT_ID=your-client-id GOOGLE_CLIENT_SECRET=your-client-secret node get-refresh-token.js
   ```
2. It'll print a URL — open it, sign in with **the Google account whose calendar should get the appointments** (this should be the business owner's account, not yours, once you're doing this for a real client)
3. Approve access, copy the code it gives you, paste it back into the terminal
4. It'll print a `GOOGLE_REFRESH_TOKEN` value — save this

### Step C — Add the credentials to Railway
In your Railway service's **Variables** tab, add:
```
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REFRESH_TOKEN=the-value-from-step-b
GOOGLE_CALENDAR_ID=primary
```
(`GOOGLE_CALENDAR_ID` can stay as `primary` unless the business wants events on a specific secondary calendar — in which case use that calendar's ID instead, found in that calendar's settings.)

Redeploy. From then on, every completed call creates a calendar event automatically.

### What the calendar event actually looks like
The AI does its best to guess a real date/time from whatever the caller said ("tomorrow at 3pm," "next Tuesday morning") and creates a 1-hour event with all the collected details in the description. It's an approximation, not perfect scheduling — the event description says clearly that the time was guessed, so whoever's managing the calendar knows to double check it rather than trust it blindly.

---

## Honest note on both of these

Neither of these is required for the core product to work — the phone agent, the ticket capture, everything else runs completely fine without either integration. Treat these as polish you add once you've got a real paying client who'd specifically benefit from it, not something to set up before you've sold anything.
