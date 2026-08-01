/**
 * Google Calendar sync
 * ---------------------------------------------------
 * Creates a real calendar event on the business's Google Calendar
 * whenever a call completes and a ticket is booked.
 *
 * This requires a one-time setup per business (see SETUP-CALENDAR.md):
 * 1. A Google Cloud project with the Calendar API enabled
 * 2. OAuth credentials (Client ID + Secret)
 * 3. A one-time authorization from whoever owns the calendar, which
 *    produces a "refresh token" — this is what lets the server create
 *    events on their behalf without them logging in every time.
 *
 * If the required environment variables aren't set, calendar sync is
 * silently skipped — the phone agent still works normally, it just
 * won't create calendar events. This means adding calendar sync later
 * never breaks anything that's already working.
 */

const { google } = require('googleapis');

function isCalendarConfigured() {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN
  );
}

function getOAuthClient() {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'urn:ietf:wg:oauth:2.0:oob' // matches the flow used in get-refresh-token.js
  );
  oAuth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return oAuth2Client;
}

/**
 * Very lightweight natural-language time parsing. Booked calls collect
 * a free-text "time" field like "tomorrow at 3pm" or "next Tuesday
 * morning" — this makes a best-effort guess at a real date/time so the
 * calendar event lands somewhere sensible. It defaults to tomorrow at
 * 9am if it can't confidently parse anything, since an approximate
 * event the business can drag-and-drop to the right slot is far more
 * useful than no event at all.
 */
function guessDateTime(text) {
  const now = new Date();
  const fallback = new Date(now);
  fallback.setDate(fallback.getDate() + 1);
  fallback.setHours(9, 0, 0, 0);

  if (!text) return fallback;
  const lower = text.toLowerCase();

  const result = new Date(now);
  if (lower.includes('today')) {
    // keep result as today
  } else if (lower.includes('tomorrow')) {
    result.setDate(result.getDate() + 1);
  } else {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const mentioned = days.findIndex(d => lower.includes(d));
    if (mentioned !== -1) {
      let diff = mentioned - result.getDay();
      if (diff <= 0) diff += 7;
      result.setDate(result.getDate() + diff);
    } else {
      return fallback; // couldn't parse a day at all
    }
  }

  const timeMatch = lower.match(/(\d{1,2})(:(\d{2}))?\s*(am|pm)?/);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const minute = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
    const meridiem = timeMatch[4];
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (!meridiem && hour < 8) hour += 12; // assume afternoon for ambiguous low numbers like "3"
    result.setHours(hour, minute, 0, 0);
  } else if (lower.includes('morning')) {
    result.setHours(9, 0, 0, 0);
  } else if (lower.includes('afternoon')) {
    result.setHours(14, 0, 0, 0);
  } else if (lower.includes('evening')) {
    result.setHours(17, 0, 0, 0);
  } else {
    result.setHours(9, 0, 0, 0);
  }

  return result;
}

/**
 * Creates a calendar event from a booked ticket.
 * `vertical` is used for the event title/description context.
 * `ticket` is the field object collected during the call (varies by vertical).
 */
async function createCalendarEvent(vertical, businessLabel, ticket) {
  if (!isCalendarConfigured()) {
    console.log('[calendar] Skipped — GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN not set.');
    return null;
  }

  const auth = getOAuthClient();
  const calendar = google.calendar({ version: 'v3', auth });
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

  const start = guessDateTime(ticket.time);
  const end = new Date(start.getTime() + 60 * 60 * 1000); // default 1-hour block

  const callerName = ticket.name || 'Unknown caller';
  const summaryBits = [ticket.issue, ticket.reason, ticket.service_type, ticket.pet_name]
    .filter(Boolean);
  const summary = `${businessLabel}: ${callerName}${summaryBits.length ? ' — ' + summaryBits[0] : ''}`;

  const descriptionLines = Object.entries(ticket)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`);

  const event = {
    summary,
    description: `Booked automatically by the AI phone agent.\n\n${descriptionLines.join('\n')}\n\nNote: the exact time was guessed from what the caller said ("${ticket.time || 'not specified'}") — double check and adjust if needed.`,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() }
  };

  const res = await calendar.events.insert({
    calendarId,
    requestBody: event
  });

  console.log(`[calendar] Event created: ${res.data.htmlLink}`);
  return res.data;
}

module.exports = { createCalendarEvent, isCalendarConfigured };
