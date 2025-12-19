// controllers/scanController.js
import db from '../db.js';
import { sendSmsMany } from '../utils/sms.js';
import { formatHobartDateTime } from '../utils/time.js';
import { renderSmsTemplate } from '../utils/smsRenderer.js'; // <-- centralized token renderer

function withinMinutes(d1, d2, mins) {
  return Math.abs(d1.getTime() - d2.getTime()) <= mins * 60 * 1000;
}

/* ================= Settings helpers ================= */

/**
 * Safe getter for org settings from app_setting.
 * Falls back to sensible defaults if table/keys are missing.
 */
async function getOrgSettings(client) {
  async function getKey(key, fallback) {
    try {
      const { rows } = await client.query(
        `SELECT value FROM app_setting WHERE key = $1 LIMIT 1`,
        [key]
      );
      return rows[0]?.value ?? fallback;
    } catch {
      // table might not exist yet; return fallback
      return fallback;
    }
  }

  const profile = await getKey('center.profile', {
    centreName: process.env.CENTER_NAME || 'Kumon',
    timezone: 'Australia/Hobart',
  });

  const smsPolicy = await getKey('sms.policy', {
    sendOnCheckIn: true,
    sendOnCheckOut: true,
  });

  return {
    centerName: String(profile?.centreName ?? 'Kumon'),
    timezone: String(profile?.timezone ?? 'Australia/Hobart'),
    smsPolicy: {
      sendOnCheckIn: !!smsPolicy?.sendOnCheckIn,
      sendOnCheckOut: !!smsPolicy?.sendOnCheckOut,
    },
  };
}

/** Format a Date in a specific IANA timezone (fallbacks to Hobart formatter). */
function formatDateTimeTZ(d, tz) {
  try {
    // Use Intl for arbitrary zones
    return new Intl.DateTimeFormat('en-AU', {
      timeZone: tz || 'Australia/Hobart',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    // Fallback to legacy Hobart-specific helper
    return formatHobartDateTime(d);
  }
}

/* ================= Day-boundary helpers (by timezone) ================= */

/**
 * Helper: get the latest of a given type today in the provided timezone
 */
async function getTodayOfType(client, studentId, type, tz = 'Australia/Hobart') {
  const { rows } = await client.query(
    `
    SELECT id, scanned_at
      FROM scan_event
     WHERE student_id = $1
       AND type = $2
       AND (scanned_at AT TIME ZONE $3)::date = (now() AT TIME ZONE $3)::date
     ORDER BY scanned_at DESC
     LIMIT 1
    `,
    [studentId, type, tz]
  );
  return rows[0] || null;
}

/**
 * Helper: legacy wrappers preserved for minimal diff (now accept timezone)
 */
async function getTodayCheckIn(client, studentId, tz = 'Australia/Hobart') {
  return getTodayOfType(client, studentId, 'CHECK_IN', tz);
}
async function getTodayCheckOut(client, studentId, tz = 'Australia/Hobart') {
  return getTodayOfType(client, studentId, 'CHECK_OUT', tz);
}

/**
 * POST /scan/preview
 * Resolve QR → student and render the default template body WITHOUT sending SMS.
 * Also returns { alreadyCheckedInToday, lastCheckInAt } for CHECK_IN.
 * For CHECK_OUT, returns { alreadyCheckedOutToday, lastCheckOutAt }.
 * Additionally includes generic { alreadyDoneToday, lastActionAt } for the requested type.
 * NEW: accepts headcountOnly to reflect smsAllowed (policy && !headcountOnly).
 */
export async function previewScan(req, res, next) {
  const client = await db.pool.connect();
  try {
    const { qrCode, type, headcountOnly } = req.body || {};
    if (!qrCode || !type) return res.status(400).json({ error: 'qrCode and type are required' });
    const TYPE = String(type).toUpperCase();
    if (!['CHECK_IN', 'CHECK_OUT'].includes(TYPE)) {
      return res.status(400).json({ error: 'type must be CHECK_IN or CHECK_OUT' });
    }

    // Load org settings (timezone + centre name + policy)
    const { centerName, timezone, smsPolicy } = await getOrgSettings(client);
    const smsAllowedPolicy =
      TYPE === 'CHECK_IN' ? smsPolicy.sendOnCheckIn : smsPolicy.sendOnCheckOut;
    const suppressByHeadcount = headcountOnly === true;
    const smsAllowed = smsAllowedPolicy && !suppressByHeadcount;

    // Resolve QR → student
    const { rows: qrRows } = await client.query(
      `SELECT q.id as qr_id, q.student_id, s.first_name, s.last_name, s.status
         FROM qr_code q
         JOIN student s ON s.id = q.student_id
        WHERE q.token = $1 AND q.active = TRUE
        LIMIT 1`,
      [qrCode]
    );
    const qr = qrRows[0];
    if (!qr) return res.status(404).json({ error: 'QR code not found or inactive' });
    if (qr.status !== 'ACTIVE') return res.status(400).json({ error: 'Student is inactive' });

    // Load template & render using centralized renderer
    const { rows: tRows } = await client.query(
      `SELECT text FROM message_template WHERE key = $1`,
      [TYPE]
    );
    const tplText = tRows[0]?.text || '{student.fullName} has checked in at {time} on {date}.';
    const now = new Date();
    const body = renderSmsTemplate(tplText, {
      student: { id: qr.student_id, first_name: qr.first_name, last_name: qr.last_name },
      type: TYPE,
      now,
      centerName,
      timezone, // renderer may use this if supported
    });

    // Same-day flags (by configured timezone)
    let alreadyCheckedInToday = false;
    let lastCheckInAt = null;
    let alreadyCheckedOutToday = false;
    let lastCheckOutAt = null;

    let alreadyDoneToday = false;
    let lastActionAt = null;

    if (TYPE === 'CHECK_IN') {
      const lastToday = await getTodayCheckIn(client, qr.student_id, timezone);
      if (lastToday) {
        alreadyCheckedInToday = true;
        lastCheckInAt = formatDateTimeTZ(new Date(lastToday.scanned_at), timezone);
        alreadyDoneToday = true;
        lastActionAt = lastCheckInAt;
      }
    } else if (TYPE === 'CHECK_OUT') {
      const lastToday = await getTodayCheckOut(client, qr.student_id, timezone);
      if (lastToday) {
        alreadyCheckedOutToday = true;
        lastCheckOutAt = formatDateTimeTZ(new Date(lastToday.scanned_at), timezone);
        alreadyDoneToday = true;
        lastActionAt = lastCheckOutAt;
      }
    }

    return res.json({
      student: { id: qr.student_id, firstName: qr.first_name, lastName: qr.last_name },
      body,
      smsAllowed, // policy && !headcountOnly
      headcountOnly: suppressByHeadcount, // NEW: echo back to UI
      // original fields (CHECK_IN)
      alreadyCheckedInToday,
      lastCheckInAt,
      // added fields for CHECK_OUT
      alreadyCheckedOutToday,
      lastCheckOutAt,
      // generic fields for the requested type
      alreadyDoneToday,
      lastActionAt,
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
}

/**
 * POST /scan
 * Body: { qrCode, type: "CHECK_IN"|"CHECK_OUT", messageOverride?, recheck?, headcountOnly? }
 * - If type=CHECK_IN and there's already a CHECK_IN today (by org timezone) AND recheck is not true,
 *   return 409 with details so the UI can prompt for re-check-in.
 * - If type=CHECK_OUT and there's already a CHECK_OUT today (by org timezone) AND recheck is not true,
 *   return 409 with details so the UI can prompt for re-check-out.
 * - If recheck=true, proceed and record meta.recheck=true (and skip duplicate-2min guard).
 * - Honour org SMS policy toggles; if disabled for this type, skip message sending/logging.
 * - NEW: If headcountOnly=true, suppress SMS even when policy allows; persist meta.headcountOnly=true.
 */
export async function handleScan(req, res, next) {
  const client = await db.pool.connect();
  try {
    const { qrCode, type, messageOverride, recheck, headcountOnly } = req.body || {};
    if (!qrCode || !type) return res.status(400).json({ error: 'qrCode and type are required' });
    const TYPE = String(type).toUpperCase();
    if (!['CHECK_IN', 'CHECK_OUT'].includes(TYPE)) {
      return res.status(400).json({ error: 'type must be CHECK_IN or CHECK_OUT' });
    }
    const wantRecheck = recheck === true;

    // Load org settings (timezone + centre name + policy)
    const { centerName, timezone, smsPolicy } = await getOrgSettings(client);
    const smsAllowedPolicy =
      TYPE === 'CHECK_IN' ? smsPolicy.sendOnCheckIn : smsPolicy.sendOnCheckOut;
    const suppressByHeadcount = headcountOnly === true;
    const smsAllowed = smsAllowedPolicy && !suppressByHeadcount;

    // 1) Resolve QR → student
    const { rows: qrRows } = await client.query(
      `SELECT q.id as qr_id, q.student_id, s.first_name, s.last_name, s.status
         FROM qr_code q
         JOIN student s ON s.id = q.student_id
        WHERE q.token = $1 AND q.active = TRUE
        LIMIT 1`,
      [qrCode]
    );
    const qr = qrRows[0];
    if (!qr) return res.status(404).json({ error: 'QR code not found or inactive' });
    if (qr.status !== 'ACTIVE') return res.status(400).json({ error: 'Student is inactive' });

    // 2) Same-day guard unless explicitly rechecking (by configured timezone)
    if (!wantRecheck) {
      if (TYPE === 'CHECK_IN') {
        const lastToday = await getTodayCheckIn(client, qr.student_id, timezone);
        if (lastToday) {
          return res.status(409).json({
            error: 'already_checked_in_today',
            lastCheckInAt: formatDateTimeTZ(new Date(lastToday.scanned_at), timezone),
          });
        }
      } else if (TYPE === 'CHECK_OUT') {
        const lastToday = await getTodayCheckOut(client, qr.student_id, timezone);
        if (lastToday) {
          return res.status(409).json({
            error: 'already_checked_out_today',
            lastCheckOutAt: formatDateTimeTZ(new Date(lastToday.scanned_at), timezone),
          });
        }
      }
    }

    // 3) Duplicate check (same type in last 2 min) — skip if recheck is intentional
    const now = new Date();
    let isDuplicate = false;
    if (!wantRecheck) {
      const { rows: lastScanRows } = await client.query(
        `SELECT id, scanned_at
           FROM scan_event
          WHERE student_id = $1 AND type = $2
          ORDER BY scanned_at DESC
          LIMIT 1`,
        [qr.student_id, TYPE]
      );
      if (lastScanRows[0]) {
        const lastAt = new Date(lastScanRows[0].scanned_at);
        if (withinMinutes(now, lastAt, 2)) isDuplicate = true;
      }
    }

    // 4) Insert scan_event (meta.recheck marks explicit re-check; NEW: meta.headcountOnly)
    const meta = {};
    if (wantRecheck) meta.recheck = true;
    if (suppressByHeadcount) meta.headcountOnly = true;

    const { rows: scanRows } = await client.query(
      `INSERT INTO scan_event (student_id, qr_code_id, type, scanned_by, scanned_at, was_duplicate, meta)
       VALUES ($1,$2,$3,$4,now(),$5,$6)
       RETURNING *`,
      [qr.student_id, qr.qr_id, TYPE, req.user?.id || null, isDuplicate, meta]
    );
    const scan = scanRows[0];

    // If duplicate (accidental), return early (no SMS)
    if (isDuplicate) {
      return res.json({ duplicate: true, scan, sent: 0, recipients: [], headcountOnly: suppressByHeadcount });
    }

    // 5) Guardians
    const { rows: gRows } = await client.query(
      `SELECT g.id, g.phone_e164
         FROM guardian g
         JOIN student_guardian sg ON sg.guardian_id = g.id
        WHERE sg.student_id = $1
          AND g.active = TRUE
          AND g.phone_valid = TRUE`,
      [qr.student_id]
    );

    // === Respect SMS policy toggles and headcount-only mode ===
    if (!smsAllowed || gRows.length === 0) {
      // No message logging or sending when policy disables SMS or headcountOnly is active
      return res.json({
        scan,
        messageLogId: null,
        recipients: [],
        sent: 0,
        smsAllowed,
        headcountOnly: suppressByHeadcount, // NEW: echo back to UI
      });
    }

    // 6) Compose message using centralized renderer (override allowed)
    const hasOverride = typeof messageOverride === 'string' && messageOverride.trim().length > 0;
    let body;
    if (hasOverride) {
      // If an explicit override is provided, send as-is (no token expansion).
      body = messageOverride.trim();
    } else {
      const { rows: tRows } = await client.query(
        `SELECT text FROM message_template WHERE key = $1`,
        [TYPE]
      );
      const tplText = tRows[0]?.text || '{student.fullName} has an update at {time} on {date}.';
      body = renderSmsTemplate(tplText, {
        student: { id: qr.student_id, first_name: qr.first_name, last_name: qr.last_name },
        type: TYPE,
        now,
        centerName,
        timezone, // renderer may use this if supported
      });
    }

    // 7) Log message (template_key NULL when custom/override)
    const templateKey = hasOverride ? null : TYPE;
    const { rows: mlRows } = await client.query(
      `INSERT INTO message_log
         (student_id, trigger_type, scan_event_id, template_key, body_rendered, created_by, created_at)
       VALUES ($1,'SCAN',$2,$3,$4,$5, now())
       RETURNING id`,
      [qr.student_id, scan.id, templateKey, body, req.user?.id || null]
    );
    const messageLogId = mlRows[0].id;

    // 8) Send SMS
    let results = { messages: [] };
    if (gRows.length > 0) {
      const items = gRows.map((g) => ({ to: g.phone_e164, body }));
      try {
        results = await sendSmsMany(items);
      } catch (e) {
        console.error('ClickSend send error:', e.message);
      }
    }

    // 9) Recipients (+ surface precise gateway statuses)
    const recipientsDetailed = []; // *** NEW
    for (const g of gRows) {
      const found = results.messages.find((m) => m.to === g.phone_e164);
      const gatewayId = found?.message_id || null;
      const gatewayStatus = found?.status || (results.messages.length ? 'UNKNOWN' : 'FAILED');

      // *** NEW: mark FAILED whenever gateway_status !== 'SUCCESS'
      const statusNorm = gatewayStatus === 'SUCCESS' ? 'SENT' : 'FAILED';

      await client.query(
        `INSERT INTO message_recipient
           (message_log_id, guardian_id, phone_e164, status, gateway_message_id, gateway_status)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [messageLogId, g.id, g.phone_e164, statusNorm, gatewayId, gatewayStatus]
      );

      // *** NEW: collect detailed recipient info for UI
      recipientsDetailed.push({
        phone: g.phone_e164,
        status: statusNorm,
        gateway_status: gatewayStatus,
        gateway_message_id: gatewayId,
      });
    }

    // *** NEW: Aggregate gateway outcome for the scanner UX
    const anyNonSuccess = recipientsDetailed.some(r => r.gateway_status !== 'SUCCESS');
    const insufficientCredit = recipientsDetailed.some(r => r.gateway_status === 'INSUFFICIENT_CREDIT');
    const failingStatuses = [...new Set(recipientsDetailed.filter(r => r.gateway_status !== 'SUCCESS').map(r => r.gateway_status))];

    const overallGatewayStatus = anyNonSuccess ? 'FAILURE' : 'SUCCESS';
    const gatewayFailure = anyNonSuccess;
    const gatewayFailureReason = anyNonSuccess
      ? (insufficientCredit ? 'INSUFFICIENT_CREDIT' : (failingStatuses[0] || 'UNKNOWN'))
      : null;

    // concise, actionable hint for UI (no change to HTTP status to avoid breaking callers)
    const gatewayFailureMessage = anyNonSuccess
      ? (insufficientCredit
          ? 'SMS gateway reports insufficient credit. No messages were delivered. Please top up your ClickSend balance and retry.'
          : `SMS gateway returned non-success statuses (${failingStatuses.join(', ')}). Check your SMS gateway account and retry.`)
      : null;

    return res.json({
      scan,
      messageLogId,
      recipients: gRows.map((g) => g.phone_e164),
      recipientsDetailed,             // *** NEW
      sent: results.messages.length,
      smsAllowed,
      headcountOnly: suppressByHeadcount, // NEW: echo back to UI
      overallGatewayStatus,           // *** NEW: 'SUCCESS' | 'FAILURE'
      gatewayFailure,                 // *** NEW: boolean
      gatewayFailureReason,           // *** NEW: e.g., 'INSUFFICIENT_CREDIT'
      gatewayFailureMessage,          // *** NEW: human-readable hint
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
}

/* ======================= NEW: Today stats (includes non-SMS scans) ======================= */
/**
 * GET /scan/stats/today
 * Returns aggregate KPIs for today in org timezone, excluding duplicates:
 * {
 *   todayIn, todayOut, onCampusToday,
 *   nonSmsIn, nonSmsOut, nonSmsTotal
 * }
 */
export async function getTodayStats(req, res, next) {
  const client = await db.pool.connect();
  try {
    const { timezone } = await getOrgSettings(client);

    // Pull today's scans (by org timezone), exclude duplicates; detect whether a message_log exists
    const { rows } = await client.query(
      `
      SELECT se.student_id, se.type, se.scanned_at,
             (ml.id IS NOT NULL) AS has_message
        FROM scan_event se
        LEFT JOIN message_log ml ON ml.scan_event_id = se.id
       WHERE se.was_duplicate IS DISTINCT FROM TRUE
         AND (se.scanned_at AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date
       ORDER BY se.scanned_at ASC
      `,
      [timezone]
    );

    let todayIn = 0, todayOut = 0;
    let nonSmsIn = 0, nonSmsOut = 0;
    const latestByStudent = new Map(); // student_id -> { ts, type }

    for (const r of rows) {
      const type = String(r.type || "").toUpperCase();
      const ts = +new Date(r.scanned_at);
      const hasMsg = !!r.has_message;

      if (type === 'CHECK_IN') {
        todayIn++;
        if (!hasMsg) nonSmsIn++;
      } else if (type === 'CHECK_OUT') {
        todayOut++;
        if (!hasMsg) nonSmsOut++;
      }

      const prev = latestByStudent.get(r.student_id);
      if (!prev || ts > prev.ts) latestByStudent.set(r.student_id, { ts, type });
    }

    let onCampusToday = 0;
    latestByStudent.forEach(({ type }) => { if (type === 'CHECK_IN') onCampusToday++; });

    return res.json({
      todayIn,
      todayOut,
      onCampusToday,
      nonSmsIn,
      nonSmsOut,
      nonSmsTotal: nonSmsIn + nonSmsOut,
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
}

/* ======================= NEW: Recent scans (for Recent Activity) ======================= */
/**
 * GET /scan/recent?limit=40
 * Returns latest scan_event rows (both SMS + non-SMS). Each item includes:
 *  - id, scan_event_id, student_id, type, scanned_at, was_duplicate
 *  - headcountOnly/headcount_only (from meta)
 *  - has_message (true if a message_log exists for this scan)
 *  - student_first, student_last, student_dob
 */
export async function getRecentScans(req, res, next) {
  const client = await db.pool.connect();
  try {
    const raw = parseInt(String(req.query.limit || 40), 10);
    const limit = Number.isFinite(raw) ? Math.max(1, Math.min(100, raw)) : 40;

    const { rows } = await client.query(
      `
      SELECT
        se.id AS id,
        se.id AS scan_event_id,
        se.student_id,
        se.type,
        se.scanned_at,
        se.was_duplicate,
        COALESCE((se.meta->>'headcountOnly')::boolean, FALSE) AS headcountOnly,
        COALESCE((se.meta->>'headcountOnly')::boolean, FALSE) AS headcount_only,
        (ml.id IS NOT NULL) AS has_message,
        s.first_name AS student_first,
        s.last_name  AS student_last,
        s.dob        AS student_dob
      FROM scan_event se
      JOIN student s ON s.id = se.student_id
      LEFT JOIN message_log ml ON ml.scan_event_id = se.id
      ORDER BY se.scanned_at DESC
      LIMIT $1
      `,
      [limit]
    );

    res.json({ items: rows });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
}