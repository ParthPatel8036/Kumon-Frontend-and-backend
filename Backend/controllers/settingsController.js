// controllers/settingsController.js
import db from '../db.js';
import { sendSmsMany } from '../utils/sms.js';
import logAdminAction from '../utils/logAdminAction.js';

/**
 * Simple key/value settings store helpers
 * Table (added via migration): app_setting(key text primary key, value jsonb, updated_at timestamptz)
 */
async function getSetting(key, fallback) {
  const { rows } = await db.query(`SELECT value FROM app_setting WHERE key = $1 LIMIT 1`, [key]);
  return rows[0]?.value ?? fallback;
}
async function setSetting(key, value) {
  await db.query(
    `INSERT INTO app_setting (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value]
  );
}

/* =========================================================================
 * GET /settings  (Org settings; Staff can read; Admin edits via PATCH)
 * ========================================================================= */
export async function getOrgSettings(req, res, next) {
  try {
    const profile = await getSetting('center.profile', {
      centreName: 'Kumon North Hobart',
      timezone: 'Australia/Hobart',
    });
    const smsPolicy = await getSetting('sms.policy', {
      sendOnCheckIn: true,
      sendOnCheckOut: true,
    });

    return res.json({
      centreName: String(profile?.centreName ?? ''),
      timezone: String(profile?.timezone ?? 'Australia/Hobart'),
      smsPolicy: {
        sendOnCheckIn: !!smsPolicy?.sendOnCheckIn,
        sendOnCheckOut: !!smsPolicy?.sendOnCheckOut,
      },
    });
  } catch (err) {
    next(err);
  }
}

/* =========================================================================
 * PATCH /settings  (Admin only)
 * Body: { centreName?, timezone?, smsPolicy?: { sendOnCheckIn?, sendOnCheckOut? } }
 * ========================================================================= */
export async function updateOrgSettings(req, res, next) {
  try {
    const body = req.body || {};
    const centreName = body.centreName != null ? String(body.centreName).trim() : undefined;
    const timezone = body.timezone != null ? String(body.timezone).trim() : undefined;
    const smsPolicyIn = body.smsPolicy || {};

    // Basic validation
    if (centreName !== undefined && centreName.length === 0) {
      return res.status(400).json({ error: 'centreName cannot be empty' });
    }
    if (timezone !== undefined && timezone.length === 0) {
      return res.status(400).json({ error: 'timezone cannot be empty' });
    }
    if (Object.keys(body).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Load current to merge
    const profile = await getSetting('center.profile', {});
    const smsPolicy = await getSetting('sms.policy', { sendOnCheckIn: true, sendOnCheckOut: true });

    const nextProfile = {
      centreName: centreName !== undefined ? centreName : (profile?.centreName ?? ''),
      timezone: timezone !== undefined ? timezone : (profile?.timezone ?? 'Australia/Hobart'),
    };
    const nextSms = {
      sendOnCheckIn:
        smsPolicyIn.sendOnCheckIn !== undefined
          ? !!smsPolicyIn.sendOnCheckIn
          : !!smsPolicy?.sendOnCheckIn,
      sendOnCheckOut:
        smsPolicyIn.sendOnCheckOut !== undefined
          ? !!smsPolicyIn.sendOnCheckOut
          : !!smsPolicy?.sendOnCheckOut,
    };

    await setSetting('center.profile', nextProfile);
    await setSetting('sms.policy', nextSms);

    // Audit trail
    try {
      await logAdminAction(req.user.id, 'SETTINGS_UPDATE', 'app_setting', null, {
        fields: Object.keys(body),
      });
    } catch {}

    return res.json({
      centreName: nextProfile.centreName,
      timezone: nextProfile.timezone,
      smsPolicy: nextSms,
    });
  } catch (err) {
    next(err);
  }
}

/* =========================================================================
 * POST /settings/test-sms  (Admin)
 * Body: { to: string }
 * Sends a short test message using the existing ClickSend integration.
 * ========================================================================= */
export async function testSms(req, res, next) {
  try {
    const to = String(req.body?.to || '').trim();
    if (!/^\+?\d{6,15}$/.test(to)) {
      return res.status(400).json({ error: 'Enter a valid E.164 phone number (e.g., +61…)' });
    }

    const body = `Test SMS from Kumon – settings verification (${new Date().toLocaleString()})`;
    const result = await sendSmsMany([{ to, body }]); // uses utils/sms.js ClickSend client :contentReference[oaicite:0]{index=0}:contentReference[oaicite:1]{index=1}

    try {
      await logAdminAction(req.user.id, 'SETTINGS_TEST_SMS', 'app_setting', null, {
        to,
        sent: (result?.messages || []).length,
      });
    } catch {}

    return res.json({ ok: true, result });
  } catch (err) {
    next(err);
  }
}

/* =========================================================================
 * GET /settings/health  (Auth)
 * Returns: { dbOk, smsOk, serverTime }
 * ========================================================================= */
export async function getHealth(req, res, next) {
  try {
    // DB ping
    const { rows } = await db.query(`SELECT now() AS now`);
    const serverTime = rows[0]?.now || null;

    // SMS basic readiness: presence of ClickSend creds
    const smsOk = !!(process.env.CLICK_SEND_USERNAME && process.env.CLICK_SEND_API_KEY);

    return res.json({ dbOk: true, smsOk, serverTime });
  } catch (err) {
    // If DB ping fails, report gracefully
    return res.json({ dbOk: false, smsOk: false, serverTime: null });
  }
}

/* =========================================================================
 * GET /settings/export/scans  (Admin)
 * Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv|json
 * ========================================================================= */
export async function exportScans(req, res, next) {
  try {
    const { from = '', to = '', format = 'csv' } = req.query || {};
    const where = [];
    const params = [];
    let i = 1;

    if (from) {
      where.push(`se.scanned_at >= $${i++}`);
      params.push(new Date(`${from}T00:00:00.000Z`));
    }
    if (to) {
      where.push(`se.scanned_at <= $${i++}`);
      params.push(new Date(`${to}T23:59:59.999Z`));
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // scan_event schema is already used elsewhere in your backend
    const { rows } = await db.query(
      `
      SELECT
        se.id,
        se.student_id,
        s.first_name,
        s.last_name,
        se.type,
        se.scanned_by,
        se.scanned_at,
        se.was_duplicate
      FROM scan_event se
      JOIN student s ON s.id = se.student_id
      ${whereSql}
      ORDER BY se.scanned_at DESC
      `,
      params
    );

    if ((format || '').toLowerCase() === 'json') {
      res.setHeader('Content-Type', 'application/json');
      return res.send(JSON.stringify({ items: rows }, null, 2));
    }

    // CSV
    const header = [
      'id',
      'student_id',
      'first_name',
      'last_name',
      'type',
      'scanned_by',
      'scanned_at',
      'was_duplicate',
    ];
    const csv = [header.join(',')]
      .concat(
        rows.map((r) =>
          [
            r.id,
            r.student_id,
            r.first_name,
            r.last_name,
            r.type,
            r.scanned_by,
            toIso(r.scanned_at),
            r.was_duplicate ? 'true' : 'false',
          ]
            .map(csvEscape)
            .join(',')
        )
      )
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="scans_export.csv"`);
    return res.send(csv);
  } catch (err) {
    next(err);
  }
}

/* =========================================================================
 * GET /settings/export/messages  (Admin)
 * Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv|json
 * Flattens recipients (one row per recipient when CSV).
 * ========================================================================= */
export async function exportMessages(req, res, next) {
  try {
    const { from = '', to = '', format = 'csv' } = req.query || {};
    const where = [];
    const params = [];
    let i = 1;

    if (from) {
      where.push(`ml.created_at >= $${i++}`);
      params.push(new Date(`${from}T00:00:00.000Z`));
    }
    if (to) {
      where.push(`ml.created_at <= $${i++}`);
      params.push(new Date(`${to}T23:59:59.999Z`));
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // Use the same message_log / message_recipient schema your backend already uses
    const { rows } = await db.query(
      `
      SELECT
        ml.id                AS message_id,
        ml.student_id,
        s.first_name,
        s.last_name,
        ml.template_key,
        ml.body_rendered,
        ml.created_at,
        mr.phone_e164        AS recipient,
        mr.status            AS recipient_status,
        mr.gateway_message_id,
        mr.gateway_status,
        mr.updated_at        AS recipient_updated_at
      FROM message_log ml
      LEFT JOIN message_recipient mr ON mr.message_log_id = ml.id
      LEFT JOIN student s ON s.id = ml.student_id
      ${whereSql}
      ORDER BY ml.created_at DESC, ml.id DESC
      `,
      params
    );

    if ((format || '').toLowerCase() === 'json') {
      res.setHeader('Content-Type', 'application/json');
      return res.send(JSON.stringify({ items: rows }, null, 2));
    }

    // CSV
    const header = [
      'message_id',
      'student_id',
      'first_name',
      'last_name',
      'template_key',
      'body_rendered',
      'created_at',
      'recipient',
      'recipient_status',
      'gateway_message_id',
      'gateway_status',
      'recipient_updated_at',
    ];
    const csv = [header.join(',')]
      .concat(
        rows.map((r) =>
          [
            r.message_id,
            r.student_id,
            r.first_name,
            r.last_name,
            r.template_key,
            r.body_rendered,
            toIso(r.created_at),
            r.recipient,
            r.recipient_status,
            r.gateway_message_id,
            r.gateway_status,
            toIso(r.recipient_updated_at),
          ]
            .map(csvEscape)
            .join(',')
        )
      )
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="messages_export.csv"`);
    return res.send(csv);
  } catch (err) {
    next(err);
  }
}

/* =========================================================================
 * POST /settings/purge-old  (Admin)
 * Deletes scan & message log data older than 12 months (policy window).
 * (Archival tables can be added later via migration; this endpoint returns counts.)
 * ========================================================================= */
export async function purgeOldData(req, res, next) {
  try {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const cutoffSql = `now() - interval '12 months'`;

      // Delete recipients first (FK)
      const delRec = await client.query(
        `DELETE FROM message_recipient WHERE updated_at < ${cutoffSql} RETURNING id`
      );
      const delMsg = await client.query(
        `DELETE FROM message_log WHERE created_at < ${cutoffSql} RETURNING id`
      );
      const delScan = await client.query(
        `DELETE FROM scan_event WHERE scanned_at < ${cutoffSql} RETURNING id`
      );

      await client.query('COMMIT');

      try {
        await logAdminAction(req.user.id, 'PURGE_OLD', 'settings', null, {
          cutoffMonths: 12,
          deleted: { recipients: delRec.rowCount, messages: delMsg.rowCount, scans: delScan.rowCount },
        });
      } catch {}

      return res.json({
        cutoffMonths: 12,
        deleted: {
          recipients: delRec.rowCount || 0,
          messages: delMsg.rowCount || 0,
          scans: delScan.rowCount || 0,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

/* =============================== Utils =============================== */

function toIso(v) {
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(+d) ? '' : d.toISOString();
}
function csvEscape(val) {
  const s = val == null ? '' : String(val);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}