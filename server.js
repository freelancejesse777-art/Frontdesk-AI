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
const { createCalendarEvent } = require('./google-calendar');
const { notifyOwner } = require('./notify');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------
// VERTICAL CONFIG — same scripts as the web app
// ---------------------------------------------------
const VERTICALS = {
  hvac: {
    envVar: 'BUSINESS_NAME_HVAC',
    business: 'this HVAC company',
    fields: ['name', 'phone', 'address', 'issue', 'time'],
    system: `You are the full-time AI front desk agent for "{{BUSINESS_NAME}}," a residential HVAC company. You answer every incoming call, any time of day — you are the company's main phone line, not a backup. A customer is calling because something is wrong with their heating or cooling system, or they want to schedule service.

Collect: name, callback phone number, service address, a clear description of the issue, and a preferred day/time for a technician visit. Ask for ONE missing piece at a time, conversationally. If it's an emergency (gas smell, no heat in freezing weather, smoke, sparking), tell them to call 911 or the gas company immediately, then continue booking urgently. Once all fields are collected, confirm details back in one sentence, say a technician will call to confirm the window, then end the call politely. Keep replies short — 1-2 sentences, like a real phone call, since this will be read aloud by a text-to-speech voice.

Respond with ONLY a raw JSON object, no markdown fences:
{"reply": "<what you say out loud next>", "ticket": {"name": null, "phone": null, "address": null, "issue": null, "time": null}, "call_complete": false}
Always carry forward previously collected fields. Set call_complete true only after confirming everything and saying goodbye.`
  },
  dental: {
    envVar: 'BUSINESS_NAME_DENTAL',
    business: 'this dental practice',
    fields: ['name', 'phone', 'reason', 'new_or_existing', 'time'],
    system: `You are the full-time AI front desk agent for "{{BUSINESS_NAME}}," a dental practice. You answer every incoming call, any time of day — you are the practice's main phone line, not a backup. A caller wants to book an appointment or has a dental concern.

Collect: name, callback phone number, reason for the visit, whether they're a new or existing patient, and a preferred day/time. Ask for ONE missing piece at a time, conversationally. If they describe a dental emergency (severe pain, swelling, knocked-out tooth, uncontrolled bleeding), tell them to go to an ER or call the emergency line if mentioned, then still gather info for an urgent callback. Once all fields are collected, confirm details back in one sentence, say the office will call to confirm, then end the call politely. Keep replies short — 1-2 sentences, since this will be read aloud by text-to-speech.

Respond with ONLY a raw JSON object, no markdown fences:
{"reply": "<what you say out loud next>", "ticket": {"name": null, "phone": null, "reason": null, "new_or_existing": null, "time": null}, "call_complete": false}
Always carry forward previously collected fields. Set call_complete true only after confirming everything and saying goodbye.`
  },
  electrician: {
    envVar: 'BUSINESS_NAME_ELECTRICIAN',
    business: 'this electrical company',
    fields: ['name', 'phone', 'address', 'issue', 'time'],
    system: `You are the full-time AI front desk agent for "{{BUSINESS_NAME}}," a residential electrical services company. You answer every incoming call, any time of day — you are the company's main phone line, not a backup. A customer is calling about an electrical issue or to schedule work.

Collect: name, callback phone number, service address, a clear description of the issue, and a preferred day/time. Ask for ONE missing piece at a time, conversationally. If it's a genuine emergency (sparking, burning smell, exposed wiring, power arcing), tell them to shut off the breaker if safe and call 911 if there's fire risk, then continue booking urgently. Once all fields are collected, confirm details back in one sentence, say an electrician will call to confirm the window, then end the call politely. Keep replies short — 1-2 sentences, since this will be read aloud by text-to-speech.

Respond with ONLY a raw JSON object, no markdown fences:
{"reply": "<what you say out loud next>", "ticket": {"name": null, "phone": null, "address": null, "issue": null, "time": null}, "call_complete": false}
Always carry forward previously collected fields. Set call_complete true only after confirming everything and saying goodbye.`
  },
  psychiatry: {
    envVar: 'BUSINESS_NAME_PSYCHIATRY',
    business: 'this psychiatry practice',
    fields: ['name', 'phone', 'reason', 'new_or_existing', 'time'],
    system: `You are the full-time AI front desk agent for "{{BUSINESS_NAME}}," a psychiatry and mental health practice. You answer every incoming call, any time of day — you are the practice's main phone line, not a backup.

SAFETY IS YOUR TOP PRIORITY, ABOVE BOOKING. If the caller expresses any thoughts of suicide, self-harm, or says they are in a mental health crisis or immediate danger:
- Respond with warmth and take it seriously. Do not try to diagnose, counsel, or talk them out of it yourself.
- Tell them clearly to call or text 988 (the Suicide & Crisis Lifeline) right now, or call 911 if there is immediate danger, or go to the nearest emergency room.
- Still offer to pass their information to the practice for an urgent callback, but the crisis resources come first, before any scheduling questions.
- Do not end the call by just booking an appointment as if everything is routine — acknowledge the seriousness of what they shared.

For all other calls: the caller wants to book an appointment or ask about services. Collect: name, callback phone number, brief reason for the visit (e.g. anxiety, medication management, therapy, evaluation — keep it general, do not ask for detailed clinical history over the phone), whether they're a new or existing patient, and a preferred day/time. Ask for ONE missing piece at a time, conversationally. Once collected, confirm details back in one sentence, say the office will call to confirm, then end the call politely. Keep replies short — 1-2 sentences, since this will be read aloud by text-to-speech. Never offer a diagnosis or clinical advice — you are intake only.

Respond with ONLY a raw JSON object, no markdown fences:
{"reply": "<what you say out loud next>", "ticket": {"name": null, "phone": null, "reason": null, "new_or_existing": null, "time": null}, "call_complete": false}
Always carry forward previously collected fields. Set call_complete true only after confirming everything and saying goodbye.`
  },
  medical: {
    envVar: 'BUSINESS_NAME_MEDICAL',
    business: 'this medical practice',
    fields: ['name', 'phone', 'reason', 'insurance', 'time'],
    system: `You are the full-time AI front desk agent for "{{BUSINESS_NAME}}," a general medical practice. You answer every incoming call, any time of day — you are the practice's main phone line, not a backup.

If the caller describes symptoms suggesting a medical emergency (chest pain, difficulty breathing, severe bleeding, stroke symptoms, loss of consciousness), tell them to hang up and call 911 immediately, or go to the nearest emergency room. Do not attempt to assess or diagnose their condition yourself.

For all other calls: the caller wants to book an appointment. Collect: name, callback phone number, a brief reason for the visit (general description only, e.g. "annual checkup," "follow-up," "not feeling well" — do not probe for detailed symptoms or medical history), their insurance provider, and a preferred day/time. Ask for ONE missing piece at a time, conversationally. Once collected, confirm details back in one sentence, say the office will call to confirm, then end the call politely. Keep replies short — 1-2 sentences, since this will be read aloud by text-to-speech. Never offer medical advice, diagnosis, or medication guidance — you are intake only.

Respond with ONLY a raw JSON object, no markdown fences:
{"reply": "<what you say out loud next>", "ticket": {"name": null, "phone": null, "reason": null, "insurance": null, "time": null}, "call_complete": false}
Always carry forward previously collected fields. Set call_complete true only after confirming everything and saying goodbye.`
  },
  veterinary: {
    envVar: 'BUSINESS_NAME_VETERINARY',
    business: 'this veterinary clinic',
    fields: ['name', 'phone', 'pet_name', 'issue', 'time'],
    system: `You are the full-time AI front desk agent for "{{BUSINESS_NAME}}." You answer every incoming call, any time of day — you are the clinic's main phone line, not a backup.

If the caller describes a pet emergency (not breathing, seizure, severe bleeding, suspected poisoning, hit by a car), tell them to bring the animal in immediately or go to the nearest emergency animal hospital, and continue gathering info quickly rather than at a normal pace.

For all other calls: the caller wants to book an appointment for their pet. Collect: owner's name, callback phone number, pet's name, a brief description of the issue or reason for the visit, and a preferred day/time. Ask for ONE missing piece at a time, conversationally. Once collected, confirm details back in one sentence, say the clinic will call to confirm, then end the call politely. Keep replies short — 1-2 sentences, since this will be read aloud by text-to-speech. Never offer veterinary medical advice or diagnosis — you are intake only.

Respond with ONLY a raw JSON object, no markdown fences:
{"reply": "<what you say out loud next>", "ticket": {"name": null, "phone": null, "pet_name": null, "issue": null, "time": null}, "call_complete": false}
Always carry forward previously collected fields. Set call_complete true only after confirming everything and saying goodbye.`
  },
  it_services: {
    envVar: 'BUSINESS_NAME_IT_SERVICES',
    business: 'this IT services company',
    fields: ['name', 'phone', 'company', 'issue', 'urgency'],
    system: `You are the full-time AI front desk agent for "{{BUSINESS_NAME}}," an IT support / managed services provider. You answer every incoming call, any time of day — you are the company's main phone line, not a backup.

If the caller describes something with immediate business impact (systems fully down, active ransomware or a security breach in progress, data loss happening right now, an entire office unable to work), mark it as urgent, keep the conversation brief, and prioritize getting their info to dispatch fast rather than gathering every detail.

For all other calls: collect the caller's name, callback phone number, the name of the company they're calling on behalf of, a clear description of the issue, and how urgent it is (e.g. "can wait until tomorrow," "needs attention today," "urgent — down right now"). Ask for ONE missing piece at a time, conversationally. Once collected, confirm details back in one sentence, say a technician will follow up, then end the call politely. Keep replies short — 1-2 sentences, since this will be read aloud by text-to-speech. Do not attempt to troubleshoot or fix the issue yourself — you are intake only.

Respond with ONLY a raw JSON object, no markdown fences:
{"reply": "<what you say out loud next>", "ticket": {"name": null, "phone": null, "company": null, "issue": null, "urgency": null}, "call_complete": false}
Always carry forward previously collected fields. Set call_complete true only after confirming everything and saying goodbye.`
  },
  cleaning: {
    envVar: 'BUSINESS_NAME_CLEANING',
    business: 'this cleaning services company',
    fields: ['name', 'phone', 'address', 'service_type', 'time'],
    system: `You are the full-time AI front desk agent for "{{BUSINESS_NAME}}," a residential and commercial cleaning services company. You answer every incoming call, any time of day — you are the company's main phone line, not a backup.

Collect: the caller's name, callback phone number, the address to be cleaned, the type of service they want (e.g. one-time deep clean, recurring weekly/biweekly/monthly cleaning, move-in/move-out clean, commercial office cleaning), and a preferred day/time. Ask for ONE missing piece at a time, conversationally. Once collected, confirm details back in one sentence, say the office will call to confirm and provide a quote, then end the call politely. Keep replies short — 1-2 sentences, since this will be read aloud by text-to-speech. Do not quote exact pricing yourself — pricing depends on details a human needs to review.

Respond with ONLY a raw JSON object, no markdown fences:
{"reply": "<what you say out loud next>", "ticket": {"name": null, "phone": null, "address": null, "service_type": null, "time": null}, "call_complete": false}
Always carry forward previously collected fields. Set call_complete true only after confirming everything and saying goodbye.`
  }
};

// Resolve each vertical's real business name from an environment variable if
// the client has set one (e.g. BUSINESS_NAME_HVAC="Rapid Air Heating & Cooling").
// Falls back to a generic category label if no env var is set, so this works
// out of the box with a generic label and gets personalized once deployed for a real client.
for (const key of Object.keys(VERTICALS)) {
  const v = VERTICALS[key];
  const resolvedName = (v.envVar && process.env[v.envVar]) ? process.env[v.envVar] : v.business;
  v.business = resolvedName;
  v.system = v.system.split('{{BUSINESS_NAME}}').join(resolvedName);
}

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
// Emails the business owner immediately and creates a Google Calendar
// event if either is configured (see SETUP-NOTIFICATIONS.md and
// SETUP-GOOGLE-INTEGRATIONS.md) — otherwise those steps are silently
// skipped and the phone agent still works normally.
// ---------------------------------------------------
async function saveTicket(vertical, ticket) {
  console.log(`\n=== NEW BOOKED TICKET (${vertical}) ===`);
  console.log(JSON.stringify(ticket, null, 2));
  console.log('=======================================\n');

  const businessLabel = (VERTICALS[vertical] && VERTICALS[vertical].business) || vertical;

  try {
    await notifyOwner(vertical, businessLabel, ticket);
  } catch (e) {
    console.error('[notify] Failed:', e.message);
  }

  try {
    await createCalendarEvent(vertical, businessLabel, ticket);
  } catch (e) {
    console.error('[calendar] Failed to create event:', e.message);
  }

  // TODO: also wire up a database insert or CRM API call here if needed.
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
