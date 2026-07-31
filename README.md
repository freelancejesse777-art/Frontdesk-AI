# Frontdesk AI

An AI voice intake agent that answers after-hours calls for local service businesses — HVAC, dental, and electrical — captures the caller's info, and books the job. No human on the line.

Built for small business owners who lose leads to missed calls outside business hours.

## What's in this repo

| File | What it is |
|---|---|
| `intake_ai_app.html` | The main demo app. Runs in a browser — pick a business type (HVAC / Dental / Electrician), start a simulated call, talk or type as the caller, and watch the AI collect the customer's info live. Includes saved call history. |
| `ai_sandbox_agent_demo.html` | A separate demo showing an AI agent that writes code, runs it in an isolated sandbox, and self-corrects on errors. Not part of the phone product — kept here as a side prototype. |
| `server.js` | The production backend. Connects a **real phone number** (via Twilio) to the same AI intake logic, so it can answer actual incoming calls 24/7. |
| `package.json` | Dependencies needed to run `server.js`. |
| `env.example` | Template showing which environment variable to set (`ANTHROPIC_API_KEY`) when deploying. |
| `SETUP.md` | Step-by-step deployment guide — Twilio account, hosting, connecting the two together. |

## How it works

1. A customer calls in (or, in the browser demo, clicks "Start call")
2. The AI greets them and asks for one piece of info at a time — name, phone number, address, the issue, and a preferred time
3. Info fills into a ticket/work order in real time
4. Once everything's collected, the AI confirms the details out loud and ends the call
5. The completed ticket is saved for the business to follow up on

Each business type (HVAC, dental, electrician) has its own script and its own set of fields, tailored to that industry.

## Quick start — try the demo

Open `intake_ai_app.html` directly — no setup required, it runs entirely in the browser and calls the Anthropic API directly.

## Going live with real phone calls

The browser demo is for sales pitches and testing. To actually answer real customer calls, you need to deploy `server.js` and connect it to a Twilio phone number. Full instructions are in [`SETUP.md`](./SETUP.md).

Short version:
1. Get a Twilio account + phone number
2. Get an Anthropic API key
3. Deploy `server.js` to a host that keeps the server running continuously (Railway or Render — **not** GitHub Pages or Vercel, since this needs a persistent process, not static files or serverless functions)
4. Point the Twilio number's webhook at `https://your-deployed-url/voice/hvac` (or `/dental`, `/electrician`)

## Status

Prototype / early pilot stage. Built to validate the concept with real businesses before scaling to more clients or verticals.
