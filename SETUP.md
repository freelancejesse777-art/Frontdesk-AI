# Getting a real phone number working — step by step

This turns the browser demo into something that answers actual phone calls, 24/7, even when your laptop is off.

## What you'll need (all free to start, small cost once live)
1. A **Twilio** account — twilio.com — buy one phone number (~$1/month + a few cents per minute of calls)
2. An **Anthropic API key** — console.anthropic.com — this is separate from your claude.ai login, it's for connecting apps to Claude
3. A place to host this server — **Railway** (railway.app) is the easiest for a first deploy, roughly $5/month

## Step 1 — Deploy the server
1. Create a free Railway account, click "New Project" → "Deploy from GitHub" (or "Empty Project" and upload these files directly)
2. Upload the `server.js` and `package.json` files from this folder
3. In Railway's project settings, add an environment variable:
   - `ANTHROPIC_API_KEY` = your key from console.anthropic.com
4. Deploy. Railway will give you a public URL like `https://your-app.up.railway.app`

## Step 2 — Connect Twilio to it
1. In your Twilio console, buy a phone number (Phone Numbers → Buy a Number)
2. Click into that number's settings
3. Under "Voice Configuration" → "A call comes in", set:
   - Webhook: `https://your-app.up.railway.app/voice/hvac`
   - Method: HTTP POST
4. Save.

That's it — call that Twilio number from your own phone right now and the AI agent will pick up.

## Switching verticals
- For dental: use `/voice/dental` as the webhook instead
- For electrician: use `/voice/electrician`
- Want all three running at once? Buy three Twilio numbers, point each at its own `/voice/...` path — one number per business type, all on the same server.

## Where booked calls go right now
Right now, completed calls just print to the server logs (visible in Railway's dashboard). Before you use this with a real client, you'll want to replace the `saveTicket()` function in `server.js` with something that actually notifies someone — options in rough order of effort:
- Send a text via Twilio to the business owner's phone (few lines of code, I can add this)
- Send an email via SendGrid or similar
- Post to a Slack channel via a webhook
- Write to a real database (Airtable is the fastest no-code option; Postgres if you want it more solid)

## A note on cost per client
Each call costs roughly $0.05–$0.15 in Claude usage plus Twilio's per-minute voice rate (a few cents/minute). At a few hundred calls a month per client, total cost is typically $15–$40/month — well under what you'd charge them ($300+/month).
