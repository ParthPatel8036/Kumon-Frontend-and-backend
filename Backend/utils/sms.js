// utils/sms.js
const CLICK_SEND_API = 'https://rest.clicksend.com/v3/sms/send';

function basicAuth() {
  const u = process.env.CLICK_SEND_USERNAME || '';
  const k = process.env.CLICK_SEND_API_KEY || '';
  const token = Buffer.from(`${u}:${k}`).toString('base64');
  return `Basic ${token}`;
}

// NEW: normalize sender
function getFrom() {
  const raw = (process.env.CLICK_SEND_FROM || '').trim();
  if (!raw) return undefined;

  // If it's a number (e.g., +614xxxxxxxx), keep as-is for reply capability
  if (/^\+?\d+$/.test(raw)) return raw;

  // Alphanumeric rules (typical carrier constraints): letters+digits only, max 11 chars
  const cleaned = raw.replace(/[^A-Za-z0-9]/g, '').slice(0, 11);
  if (!cleaned) return undefined;
  return cleaned;
}

/**
 * sendSmsMany([{to:'+61...', body:'text'}])
 * Returns { messages: [{to, message_id, status}] }
 */
export async function sendSmsMany(items) {
  if (!items?.length) return { messages: [] };

  const from = getFrom();
  const payload = {
    messages: items.map(i => ({
      to: i.to,
      source: 'api',
      body: i.body,
      ...(from ? { from } : {}) // only include if defined
    }))
  };

  const res = await fetch(CLICK_SEND_API, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.response_msg || data?.error || res.statusText;
    throw new Error(`ClickSend error: ${msg}`);
  }

  const messages = (data?.data?.messages || []).map(m => ({
    to: m.to,
    message_id: m.message_id,
    status: m.status // e.g. "SUCCESS"
  }));

  return { messages };
}