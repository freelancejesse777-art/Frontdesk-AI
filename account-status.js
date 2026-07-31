/**
 * GET /api/account-status?email=someone@example.com
 * -------------------------------------------------
 * Returns the real, paid-for plan for an email address, as last
 * confirmed by Stripe via the webhook. This is what makes the
 * dashboard trustworthy — it's reading a row that only Stripe's
 * server-to-server webhook is allowed to write (see stripe-webhook.js),
 * not something the browser set itself.
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Note on auth: this endpoint currently trusts whatever email is
 * passed in the query string, which is fine for an MVP demo but is
 * NOT real authentication — anyone who knows a customer's email could
 * query their plan. Before shipping for real, put this behind actual
 * auth (Supabase Auth magic links are the fastest fit here) so a user
 * can only ever query their own email. Flagging this clearly rather
 * than quietly shipping it as if it were secure.
 */

const { createClient } = require("@supabase/supabase-js");

let supabase;
let initError = null;
try {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var");
  }
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
} catch (e) {
  initError = e.message;
}

/**
 * With NODEJS_HELPERS=0 set (required to get the real raw request body
 * for Stripe's signature check — see postcheckBufferRequest above),
 * Vercel's res.status()/res.json() convenience methods are ALSO gone,
 * not just the body-parsing helper. This is the plain Node.js
 * equivalent of res.status(code).json(data).
 */
function postcheckSendJSON(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

module.exports = async (req, res) => {
  if (initError) {
    postcheckSendJSON(res, 500, { error: "config_error", detail: initError });
    return;
  }

  if (req.method !== "GET") {
    postcheckSendJSON(res, 405, { error: "method_not_allowed" });
    return;
  }

  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  const email = (url.searchParams.get("email") || "").trim().toLowerCase();
  if (!email) {
    postcheckSendJSON(res, 400, { error: "missing_email" });
    return;
  }

  const { data, error } = await supabase
    .from("accounts")
    .select("email, plan, status, updated_at")
    .eq("email", email)
    .maybeSingle();

  if (error) {
    console.error("[account-status] supabase error:", error);
    postcheckSendJSON(res, 500, { error: "internal_error" });
    return;
  }

  if (!data) {
    postcheckSendJSON(res, 200, { email, plan: "free", status: "none" });
    return;
  }

  postcheckSendJSON(res, 200, data);
};
