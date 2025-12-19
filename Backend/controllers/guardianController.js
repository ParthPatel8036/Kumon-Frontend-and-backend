// controllers/guardianController.js
import db from '../db.js';
import logAdminAction from '../utils/logAdminAction.js';

// Simple E.164 validator (expects already-normalised e.g. +61412345678)
function isE164(phone) {
  return typeof phone === 'string' && /^\+[1-9][0-9]{1,14}$/.test(phone);
}

// AU normaliser: 0436536668 or 436536668 → +61436536668
function toE164AU(input) {
  let s = String(input || '').trim();
  // keep leading +, strip other non-digits
  s = s.replace(/[^\d+]/g, '');
  if (!s) return '';

  // drop leading + for normalisation
  if (s.startsWith('+')) s = s.slice(1);

  // already has AU country code
  if (s.startsWith('61')) {
    return '+61' + s.slice(2);
  }

  // leading 0 (e.g., 04xxxxxxxx)
  if (s.startsWith('0')) {
    return '+61' + s.slice(1);
  }

  // bare AU mobile like 4xxxxxxxx (9 digits)
  if (/^4\d{8}$/.test(s)) {
    return '+61' + s;
  }

  // otherwise, not a recognised AU mobile/format
  return '';
}

// Split a full name into first/last using a simple heuristic
function splitFullName(full) {
  const parts = (full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

/**
 * Unicode-aware name validation:
 * - Allowed: letters (incl. accents) and combining marks, spaces, hyphens (-), apostrophes (' or ’)
 * - Must start and end with a letter; 1–100 chars after trimming
 * NOTE:
 * - For CREATE we require firstName (derived or explicit) to be non-empty.
 * - For UPDATE we validate only if a value is provided; empty strings are permitted to preserve existing behaviour.
 */
const NAME_REGEX = /^[\p{L}\p{M}](?:[\p{L}\p{M}\s'\-’]*[\p{L}\p{M}])?$/u;

function validateNameRequired(label, value) {
  const v = (value ?? '').trim();
  if (!v) return `${label} is required`;
  if (v.length > 100) return `${label} must be 100 characters or less`;
  if (!NAME_REGEX.test(v)) {
    return `${label} must contain only letters (plus spaces, hyphens, apostrophes) and start/end with a letter`;
  }
  return null;
}

function validateNameOptional(label, value) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim();
  if (!v) return null; // allow empty to preserve existing semantics
  if (v.length > 100) return `${label} must be 100 characters or less`;
  if (!NAME_REGEX.test(v)) {
    return `${label} must contain only letters (plus spaces, hyphens, apostrophes) and start/end with a letter`;
  }
  return null;
}

export async function createGuardian(req, res, next) {
  try {
    const {
      name,
      firstName,
      lastName,
      relationship = 'GUARDIAN',
      phone
    } = req.body || {};

    // Require either a single "name" or both firstName+lastName, plus phone
    if ((!name && !(firstName && lastName)) || !phone) {
      return res
        .status(400)
        .json({ error: 'Provide name or firstName+lastName, and phone' });
    }

    const phone_e164 = phone;
    if (!isE164(phone_e164)) {
      return res.status(400).json({
        error: 'phone must be E.164 format, e.g., +61412345678'
      });
    }

    // Derive first/last if only a single "name" was supplied
    const derived = splitFullName(name);
    const fRaw = firstName ?? derived.first;
    const lRaw = lastName ?? derived.last;

    // Name validation (reject digits and other disallowed chars)
    const fErr = validateNameRequired('firstName', fRaw);
    if (fErr) return res.status(400).json({ error: fErr });
    const lErr = validateNameOptional('lastName', lRaw);
    if (lErr) return res.status(400).json({ error: lErr });

    const f = String(fRaw).trim();
    const l = lRaw == null ? '' : String(lRaw).trim();

    // IMPORTANT: Do not insert into the generated "name" column.
    // The DB computes "name" from first_name + last_name.
    const { rows } = await db.query(
      `INSERT INTO guardian (
         first_name, last_name, relationship, phone_raw, phone_e164, phone_valid, active
       )
       VALUES ($1, $2, $3, $4, $5, TRUE, TRUE)
       RETURNING *`,
      [f, l, relationship, phone, phone_e164]
    );

    // Audit log
    await logAdminAction(
      req.user?.id,
      'GUARDIAN_CREATE',
      'guardian',
      rows[0].id,
      { first_name: f, last_name: l, phone_e164 }
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    return next(err);
  }
}

export async function listGuardians(req, res, next) {
  try {
    const { studentId } = req.query;

    // If listing guardians for a specific student
    if (studentId != null) {
      const id = Number(studentId);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'studentId must be a positive integer' });
      }

      const { rows } = await db.query(
        `SELECT g.*
           FROM guardian g
           JOIN student_guardian sg ON sg.guardian_id = g.id
          WHERE sg.student_id = $1
          ORDER BY g.name`,
        [id]
      );
      return res.json({ items: rows });
    }

    // Apply server-side filters/paging
    const limit = Math.max(1, Number(req.query.limit ?? 200));
    const offset = Math.max(0, Number(req.query.offset ?? 0));
    const search = String(req.query.search ?? '').trim();
    const relationship = String(req.query.relationship ?? '').trim();
    const active = String(req.query.active ?? '').trim().toLowerCase();         // "yes" | "no" | ""
    const phoneValid = String(req.query.phoneValid ?? '').trim().toLowerCase(); // "yes" | "no" | ""

    // NEW: parse ?id / ?ids into a unique int[] (ignore non-numeric/<=0)
    const idList = [];
    const qId  = req.query.id;
    const qIds = req.query.ids;
    if (qId !== undefined && qId !== null && String(qId).trim() !== '') {
      const n = Number(qId);
      if (Number.isFinite(n) && n > 0) idList.push(n);
    }
    if (qIds !== undefined && qIds !== null && String(qIds).trim() !== '') {
      String(qIds).split(',').forEach(part => {
        const n = Number(part.trim());
        if (Number.isFinite(n) && n > 0) idList.push(n);
      });
    }
    const uniqIds = Array.from(new Set(idList));

    const where = [];
    const params = [];
    let i = 1;

    // NEW: exact ID filter
    if (uniqIds.length === 1) {
      where.push(`g.id = $${i++}`);
      params.push(uniqIds[0]);
    } else if (uniqIds.length > 1) {
      where.push(`g.id = ANY($${i++}::int[])`);
      params.push(uniqIds);
    }
    // END NEW

    // Relationship filter now uses student_guardian.relationship_type
    if (relationship) {
      where.push(`EXISTS (
        SELECT 1 FROM student_guardian sg
        WHERE sg.guardian_id = g.id
          AND sg.relationship_type ILIKE $${i++}
      )`);
      params.push(`%${relationship}%`);
    }

    // Active flag
    if (active === 'yes' || active === 'no') {
      where.push(`g.active = $${i++}`);
      params.push(active === 'yes');
    }

    // Phone valid flag
    if (phoneValid === 'yes' || phoneValid === 'no') {
      where.push(`g.phone_valid = $${i++}`);
      params.push(phoneValid === 'yes');
    }

    // Search over name/email/phones and first+last fallback
    if (search) {
      where.push(`(
        g.name ILIKE $${i} OR
        (g.first_name || ' ' || g.last_name) ILIKE $${i} OR
        g.email ILIKE $${i} OR
        g.phone_e164 ILIKE $${i} OR
        g.phone_raw ILIKE $${i}
      )`);
      params.push(`%${search}%`);
      i++;
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    params.push(limit);
    params.push(offset);

    // Return g.* plus one representative relationship_type from student_guardian (if any)
    const { rows } = await db.query(
      `
      SELECT
        g.*,
        (
          SELECT sg2.relationship_type
            FROM student_guardian sg2
           WHERE sg2.guardian_id = g.id
             AND sg2.relationship_type IS NOT NULL
           ORDER BY sg2.relationship_type
           LIMIT 1
        ) AS relationship_type
        FROM guardian g
        ${whereSql}
       ORDER BY g.name
       LIMIT $${i++}
      OFFSET $${i++}
      `,
      params
    );

    return res.json({ items: rows });
  } catch (err) {
    return next(err);
  }
}

/* =========================================================================
 * Students-by-guardian endpoints (single and bulk)
 * ========================================================================= */

/**
 * GET /guardians/:id/students
 * Returns students linked to a single guardian as { items: Student[] }
 */
export async function listStudentsForOneGuardian(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'id must be a positive integer' });
    }

    const { rows } = await db.query(
      `
      SELECT s.*
        FROM student_guardian sg
        JOIN student s ON s.id = sg.student_id
       WHERE sg.guardian_id = $1
       ORDER BY s.last_name, s.first_name
      `,
      [id]
    );

    return res.json({ items: rows });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /guardians/students?ids=1,2,3
 * Returns students grouped by guardian as { items: { [guardianId]: Student[] } }
 * Ensures every requested id is present in the result (empty array if none).
 */
export async function listStudentsByGuardianIds(req, res, next) {
  try {
    const raw = String(req.query.ids || '').trim();
    if (!raw) return res.json({ items: {} });

    // Parse, sanitize, and de-duplicate IDs
    const ids = Array.from(new Set(
      raw.split(',').map(s => Number(String(s).trim())).filter(n => Number.isInteger(n) && n > 0)
    ));
    if (!ids.length) return res.json({ items: {} });

    // Query once and aggregate per guardian
    const { rows } = await db.query(
      `
      SELECT 
        sg.guardian_id,
        json_agg(row_to_json(s) ORDER BY s.last_name, s.first_name) AS students
      FROM student_guardian sg
      JOIN student s ON s.id = sg.student_id
      WHERE sg.guardian_id = ANY($1::int[])
      GROUP BY sg.guardian_id
      `,
      [ids]
    );

    // Build a complete mapping including requested ids with no students
    const map = Object.fromEntries(ids.map(id => [String(id), []]));
    for (const r of rows) {
      map[String(r.guardian_id)] = r.students || [];
    }

    return res.json({ items: map });
  } catch (err) {
    return next(err);
  }
}

/* =========================================================================
 * Update/Delete guardian
 * ========================================================================= */

/**
 * PATCH /guardians/:id
 * Accepts camelCase or snake_case:
 *  firstName/first_name, lastName/last_name, relationship/relationship_type,
 *  email, phoneE164/phone_e164, phoneRaw/phone_raw, phoneValid/phone_valid, active/isActive
 * Derives phone_e164 from phone_raw when provided.
 * Returns the updated guardian record INCLUDING relationship_type.
 */
export async function updateGuardian(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'id must be a positive integer' });
    }

    const body = req.body || {};
    const firstName = body.firstName ?? body.first_name;
    const lastName  = body.lastName  ?? body.last_name;
    const relationship = body.relationship ?? body.relationship_type; // guardian.relationship + link-table
    const email = body.email;

    const phoneRawIn = body.phoneRaw ?? body.phone_raw;
    const phoneE164In = body.phoneE164 ?? body.phone_e164;

    const phoneValid = body.phoneValid ?? body.phone_valid;
    const active = body.active ?? body.isActive;

    // Validate direct E.164 only if RAW not provided
    if (phoneRawIn === undefined && phoneE164In !== undefined && phoneE164In !== null) {
      if (!isE164(String(phoneE164In))) {
        return res.status(400).json({ error: 'phoneE164 must be E.164 format, e.g., +61412345678' });
      }
    }

    // Build UPDATE set list
    const sets = [];
    const vals = [];
    let i = 1;
    const setCol = (col, value) => { sets.push(`${col} = $${i++}`); vals.push(value); };

    // Name validation on updates (only if provided; empty strings allowed to preserve behaviour)
    if (firstName !== undefined) {
      const err = validateNameOptional('firstName', firstName);
      if (err) return res.status(400).json({ error: err });
      setCol('first_name', (firstName ?? '').toString().trim());
    }
    if (lastName !== undefined) {
      const err = validateNameOptional('lastName', lastName);
      if (err) return res.status(400).json({ error: err });
      setCol('last_name',  (lastName  ?? '').toString().trim());
    }

    if (relationship !== undefined) setCol('relationship', (relationship ?? '').toString().trim() || 'GUARDIAN');
    if (email !== undefined) setCol('email', email == null ? null : String(email).trim() || null);

    // Phone handling:
    // If RAW is provided, derive E.164 from it. If cannot normalise non-empty RAW, return 400.
    if (phoneRawIn !== undefined) {
      const raw = (phoneRawIn ?? '').toString().trim();
      const derived = toE164AU(raw);
      if (raw && !derived) {
        return res.status(400).json({ error: 'Invalid AU phone number in phoneRaw' });
      }
      setCol('phone_raw', raw || null);
      setCol('phone_e164', derived || null);
    } else if (phoneE164In !== undefined) {
      const e164 = (phoneE164In ?? '').toString().trim();
      setCol('phone_e164', e164 || null);
    }

    if (phoneValid !== undefined) setCol('phone_valid', !!phoneValid);
    if (active !== undefined) setCol('active', !!active);

    if (sets.length) {
      vals.push(id);
      const upd = await db.query(
        `UPDATE guardian SET ${sets.join(', ')} WHERE id = $${i} RETURNING id`,
        vals
      );
      if (!upd.rows.length) return res.status(404).json({ error: 'Guardian not found' });
    } else {
      // Ensure the guardian exists if only relationship_type is being updated later
      const exists = await db.query(`SELECT id FROM guardian WHERE id = $1`, [id]);
      if (!exists.rows.length) return res.status(404).json({ error: 'Guardian not found' });
    }

    // If relationship provided, also update the link table for ALL this guardian's links
    if (relationship !== undefined) {
      const rel = (relationship ?? '').toString().trim();
      await db.query(
        `UPDATE student_guardian
            SET relationship_type = $1
          WHERE guardian_id = $2`,
        [rel || null, id]
      );
    }

    // Audit log
    await logAdminAction(req.user?.id, 'GUARDIAN_UPDATE', 'guardian', id, req.body);

    // Return enriched guardian row (includes relationship_type)
    const { rows } = await db.query(
      `
      SELECT
        g.*,
        (
          SELECT sg2.relationship_type
            FROM student_guardian sg2
           WHERE sg2.guardian_id = g.id
             AND sg2.relationship_type IS NOT NULL
           ORDER BY sg2.relationship_type
           LIMIT 1
        ) AS relationship_type
        FROM guardian g
       WHERE g.id = $1
      `,
      [id]
    );

    return res.json(rows[0]);
  } catch (err) {
    return next(err);
  }
}

/**
 * DELETE /guardians/:id
 * Unlinks from students, then deletes the guardian. Students are NOT deleted.
 */
export async function deleteGuardian(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'id must be a positive integer' });
    }

    // Capture for audit (ignore if not found)
    const { rows: before } = await db.query(
      `SELECT id, first_name, last_name FROM guardian WHERE id = $1`,
      [id]
    );
    if (!before.length) return res.status(404).json({ error: 'Guardian not found' });

    // Remove links
    await db.query(`DELETE FROM student_guardian WHERE guardian_id = $1`, [id]);

    // Delete guardian
    const del = await db.query(`DELETE FROM guardian WHERE id = $1`, [id]);
    if (del.rowCount === 0) {
      return res.status(404).json({ error: 'Guardian not found' });
    }

    // Audit log
    await logAdminAction(req.user?.id, 'GUARDIAN_DELETE', 'guardian', id, {
      first_name: before[0].first_name,
      last_name: before[0].last_name
    });

    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
}