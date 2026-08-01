# Owner notifications — setup guide

This is the piece that makes a booked call actually show up somewhere a business owner will see it. Without this, completed tickets just sit in Railway's server logs, which nobody checks in real time.

Takes about 5 minutes. No business verification, no waiting period — this works the moment you set it up.

---

## Step 1 — Create a Gmail App Password

This lets the server send email *as* a Gmail account without needing your actual Gmail password stored anywhere.

1. Go to **myaccount.google.com/security**
2. Make sure **2-Step Verification** is turned on (required for App Passwords — turn it on first if it isn't already)
3. Go to **myaccount.google.com/apppasswords**
4. Create a new app password — name it something like "Frontdesk AI"
5. Google shows you a 16-character password — copy it (spaces don't matter, you can include or remove them)

You can use your own Gmail account for this, or create a fresh one specifically for the business (e.g. `frontdeskai.notify@gmail.com`) if you'd rather keep it separate from your personal inbox.

## Step 2 — Add environment variables in Railway

In your Railway service's **Variables** tab, add:

```
NOTIFY_EMAIL_USER=your-gmail-address@gmail.com
NOTIFY_EMAIL_APP_PASSWORD=the-16-character-app-password
OWNER_EMAIL_DEFAULT=owner@theirbusiness.com
```

`OWNER_EMAIL_DEFAULT` is who receives the notification — set this to the actual business owner's email once you have a real client.

**Optional — different owner email per vertical**, if you're running multiple businesses off the same server:
```
OWNER_EMAIL_HVAC=hvacowner@example.com
OWNER_EMAIL_DENTAL=dentaloffice@example.com
```
(Falls back to `OWNER_EMAIL_DEFAULT` if a vertical-specific one isn't set.)

## Step 3 — Redeploy and test

Push the updated files to GitHub, let Railway redeploy, then complete a test call through the Twilio number (or trigger it by testing the `/voice/hvac` endpoint directly). Once a call finishes and books, check the inbox you set as `OWNER_EMAIL_DEFAULT` — an email should land within a few seconds.

---

## What the email looks like

Subject: `New booking: [caller name] — [business name]`

Body: every field collected during the call (name, phone, issue, requested time, etc.), laid out in a simple table. Nothing fancy, just legible and immediate.

## Why email instead of text message

Sending SMS requires carriers to verify the sending business first — the same kind of registration and waiting period you already went through for the voice number. Email has no equivalent hurdle, works immediately, and is honestly checked just as often by most small business owners, especially if it's the same inbox they already use for the business. If you want SMS notifications later once you're not fighting Twilio's compliance flow, that's a separate, addable piece — this doesn't block it, it's just not necessary to get a working notification system tonight.
