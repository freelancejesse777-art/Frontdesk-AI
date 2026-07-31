/**
 * Intake AI — Phone Backend
 * ---------------------------------------------------
 * Connects a real Twilio phone number to a Claude-powered
 * intake agent for HVAC / Dental / Electrician businesses.
 *
 * HOW A CALL FLOWS:
 * 1. Customer dials your Twilio number.
 * 2. Twilio hits POST /voice/:vertical on this server.
 * 3. We ask Claude what to say, convert it to speech (Twilio's
 *    built-in <Say>), and use <Gather> to listen for the reply
 *    (Twilio transcribes speech to text for us automatically).
 * 4. Twilio posts the transcribed speech back to this server.
 * 5. We send the conversation so far to Claude, get the next
 *    line + updated ticket fields, and repeat until call_complete.
 * 6. On completion, the ticket is saved (swap saveTicket() for
 *    your own database / CRM / email / Slack webhook).
 *
 * WHAT YOU NEED BEFORE THIS WORKS:
 * - A Twilio account (twilio.com) with a phone number purchased.
 * - An Anthropic API key (console.anthropic.com).
 * - This server deployed somewhere public (Railway, Render, Fly.io).
 *   Twilio needs a real public URL to send call events to — it
 *   cannot reach your laptop directly.
 * - In the Twilio phone number settings, set the "A call comes in"
 *   webhook to: https://YOUR-DEPLOYED-URL/voice/hvac
 *   (or /voice/dental, /voice/electrician — one number per vertical,
 *   or route dynamically based on your own logic)
 *
 * ENVIRONMENT VARIABLES REQUIRED:
 * - ANTHROPIC_API_KEY   your Claude API key
 * - PORT                (optional, defaults to 3000)
 */

const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------
// VERTICAL CONFIG — same scripts as the browser demo
// ---------------------------------------------------
const VERTICALS = {
  hvac: {
    business: 'Rapid Air Heating & Cooling',
    fields: ['name', 'phone', 'address', 'issue', 'time'],
    system: `You are the after-hours phone intake agent for "Rapid Air Heating & Cooling," a residential HVAC company. A customer is calling because something is wrong with their heating or cooling system, or they want to schedule service.

Collect: name, callback phone number, service address, a clear description of the issue, and a preferred day/time for a technician visit. Ask for ONE missing piece at a time, conversationally. If it's an emergency (gas smell, no heat in freezing weather, smoke, sparking), tell them to call 911 or the gas company immediately, then continue booking urgently. Once all fields are collected, confirm details back in one sentence, say a technician will call to confirm the window, then end the call politely. Keep replies short — 1-2 sentences, like a real phone call, since this will be read aloud by a text-to-speech voice.

Respond with ONLY a raw JSON object, no markdown fences:
{"reply": "<what you say out loud next>", "ticket": {"name": null, "phone": null, "address": null, "issue": null, "time": null}, "call_complete": false}
Always carry forward previously collected fields. Set call_complete true only after confirming everything and saying goodbye.`
  },
  dental: {
    business: 'Willow Creek Dental',
    fields: ['name', 'phone', 'reason', 'new_or_existing', 'time'],
    system: `You are the after-hours phone intake agent for "Willow Creek Dental," a dental practice. A caller wants to book an appointment or has a dental concern.

Collect: name, callback phone number, reason for the visit, whether they're a new or existing patient, and a preferred day/time. Ask for ONE missing piece at a time, conversationally. If they describe a dental emergency (severe pain, swelling, knocked-out tooth, uncontrolled bleeding), tell them to go to an ER or call the emergency line if mentioned, then still gather info for an urgent callback. Once all fields are collected, confirm details back in one sentence, say the office will call to confirm, then end the call politely. Keep replies short — 1-2 sentences, since this will be read aloud by text-to-speech.

Respond with ONLY a raw JSON object, no markdown fences:
{"reply": "<what you say out loud next>", "ticket": {"name": null, "phone": null, "reason": null, "new_or_existing": null, "time": null}, "call_complete": false}
Always carry forward previously collected fields. Set call_complete true only after confirming everything and saying goodbye.`
  },
  electrician: {
    business: 'Volt Line Electric',
    fields: ['name', 'phone', 'address', 'issue', 'time'],
    system: `You are the after-hours phone intake agent for "Volt Line Electric," a residential electrical services company. A customer is calling about an electrical issue or to schedule work.

Collect: name, callback phone number, service address, a clear description of the issue, and a preferred day/time. Ask for ONE missing piece at a time, conversationally. If it's a genuine emergency (sparking, burning smell, exposed wiring, power arcing), tell them to shut off the breaker if safe and call 911 if there's fire risk, then continue booking urgently. Once all fields are collected, confirm details back in one sentence, say an electrician will call to confirm the window, then end the call politely. Keep replies short — 1-2 sentences, since this will be read aloud by text-to-speech.

Respond with ONLY a raw JSON object, no markdown fences:
{"reply": "<what you say out loud next>", "ticket": {"name": null, "phone": null, "address": null, "issue": null, "time": null}, "call_complete": false}
Always carry forward previously collected fields. Set call_complete true only after confirming everything and saying goodbye.`
  }
};

// In-memory conversation store, keyed by Twilio CallSid.
// Swap for Redis/a database if you need this to survive server restarts
// or scale across multiple server instances.
const callSessions = {};

// ---------------------------------------------------
// Claude call
// ---------------------------------------------------
async function askClaude(system, messages) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system,
      messages
    })
  });
  const data = await res.json();
  const raw = (data.content || []).map(b => b.text || '').join('').trim();
  const clean = raw.replace(/^```json/, '').replace(/^```/, '').replace(/```$/, '').trim();
  return JSON.parse(clean);
}

// ---------------------------------------------------
// Save a completed ticket.
// Replace this with: a database insert, a CRM API call,
// an email via SendGrid, a Slack webhook, etc.
// ---------------------------------------------------
async function saveTicket(vertical, ticket) {
  console.log(`\n=== NEW BOOKED TICKET (${vertical}) ===`);
  console.log(JSON.stringify(ticket, null, 2));
  console.log('=======================================\n');
  // TODO: persist this somewhere real.
}

// ---------------------------------------------------
// Twilio webhook: call just started
// ---------------------------------------------------
app.post('/voice/:vertical', async (req, res) => {
  const vertical = req.params.vertical;
  const config = VERTICALS[vertical];
  const twiml = new twilio.twiml.VoiceResponse();

  if (!config) {
    twiml.say('Sorry, this line is not configured correctly.');
    twiml.hangup();
    return res.type('text/xml').send(twiml.toString());
  }

  const callSid = req.body.CallSid;
  callSessions[callSid] = {
    vertical,
    messages: [{ role: 'user', content: '[The phone has just been answered. Greet the caller and open the call.]' }]
  };

  try {
    const parsed = await askClaude(config.system, callSessions[callSid].messages);
    callSessions[callSid].messages.push({ role: 'assistant', content: JSON.stringify(parsed) });

    const gather = twiml.gather({
      input: 'speech',
      action: `/voice/${vertical}/respond`,
      speechTimeout: 'auto',
      method: 'POST'
    });
    gather.say({ voice: 'Polly.Joanna' }, parsed.reply);

    // If the caller says nothing, re-prompt once instead of dead air.
    twiml.redirect(`/voice/${vertical}/respond`);
  } catch (e) {
    console.error(e);
    twiml.say('Sorry, we hit a technical issue. Please call back in a few minutes.');
    twiml.hangup();
  }

  res.type('text/xml').send(twiml.toString());
});

// ---------------------------------------------------
// Twilio webhook: caller has spoken, we respond
// ---------------------------------------------------
app.post('/voice/:vertical/respond', async (req, res) => {
  const vertical = req.params.vertical;
  const config = VERTICALS[vertical];
  const callSid = req.body.CallSid;
  const speechResult = req.body.SpeechResult;
  const twiml = new twilio.twiml.VoiceResponse();

  const session = callSessions[callSid];
  if (!session) {
    twiml.say('Sorry, this call session expired. Please call back.');
    twiml.hangup();
    return res.type('text/xml').send(twiml.toString());
  }

  if (!speechResult) {
    // Didn't catch anything — ask again instead of ending the call.
    const gather = twiml.gather({
      input: 'speech',
      action: `/voice/${vertical}/respond`,
      speechTimeout: 'auto',
      method: 'POST'
    });
    gather.say({ voice: 'Polly.Joanna' }, "Sorry, I didn't catch that — could you say that again?");
    return res.type('text/xml').send(twiml.toString());
  }

  session.messages.push({ role: 'user', content: speechResult });

  try {
    const parsed = await askClaude(config.system, session.messages);
    session.messages.push({ role: 'assistant', content: JSON.stringify(parsed) });

    if (parsed.call_complete) {
      twiml.say({ voice: 'Polly.Joanna' }, parsed.reply);
      twiml.hangup();
      await saveTicket(vertical, parsed.ticket);
      delete callSessions[callSid];
    } else {
      const gather = twiml.gather({
        input: 'speech',
        action: `/voice/${vertical}/respond`,
        speechTimeout: 'auto',
        method: 'POST'
      });
      gather.say({ voice: 'Polly.Joanna' }, parsed.reply);
    }
  } catch (e) {
    console.error(e);
    twiml.say('Sorry, we hit a technical issue. Please call back in a few minutes.');
    twiml.hangup();
    delete callSessions[callSid];
  }

  res.type('text/xml').send(twiml.toString());
});

app.get('/', (req, res) => {
  res.send('Intake AI phone backend is running. Point a Twilio number at /voice/hvac, /voice/dental, or /voice/electrician.');
});

app.listen(PORT, () => {
  console.log(`Intake AI phone backend listening on port ${PORT}`);
});
