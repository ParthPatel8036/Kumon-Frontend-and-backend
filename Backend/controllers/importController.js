// controllers/importController.js
import crypto from 'crypto';
import { parse } from 'csv-parse/sync';
import db from '../db.js';

// Unicode-aware name validation:
// - Allowed: letters (incl. accents) and combining marks, spaces, hyphens (-), apostrophes (' or ’)
// - Must start and end with a letter; 1–100 chars after trimming
const NAME_REGEX = /^[\p{L}\p{M}](?:[\p{L}\p{M}\s'\-’]*[\p{L}\p{M}])?$/u;
function isValidName(value) {
  const v = String(value ?? '').trim();
  if (!v || v.length > 100) return false;
  return NAME_REGEX.test(v);
}

function toE164AU(input) {
  let s = String(input || '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('61')) return '+61' + s.slice(2);
  if (s.startsWith('0')) return '+61' + s.slice(1);
  if (/^4\d{8}$/.test(s)) return '+61' + s;
  return '';
}
function toBool(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return ['true','1','yes','y'].includes(s);
}
function toDateOrNull(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : s;
}

// POST /import/csv (multipart/form-data, field: "file")
export async function importCsv(req, res, next) {
  try {
    if (!req.file?.buffer?.length) return res.status(400).json({ error: 'CSV file is required' });

    let rows;
    try {
      rows = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });
    } catch (e) {
      return res.status(400).json({ error: `Invalid CSV: ${e.message}` });
    }

    const stats = { total: rows.length, created: 0, errors: [] };
    const createdIds = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];

      const student = {
        external_id: r.externalId ?? r.external_id ?? null,
        first_name:  r.firstName  ?? r.first_name,
        last_name:   r.lastName   ?? r.last_name,
        dob:         toDateOrNull(r.dob ?? r.birthdate ?? r.date_of_birth),
        status:      (r.status || 'ACTIVE').toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
        can_leave_alone: toBool(r.canLeaveAlone ?? r.can_leave_alone),
        notes:       r.notes ?? null,
      };

      // Require names
      if (!student.first_name || !student.last_name) {
        stats.errors.push({ row: i+1, message: 'Missing student first/last name' });
        continue;
      }

      // Validate student names (reject digits and other disallowed chars)
      if (!isValidName(student.first_name)) {
        stats.errors.push({ row: i+1, message: 'Invalid student firstName: letters only (spaces, hyphens, apostrophes allowed), must start/end with a letter' });
        continue;
      }
      if (!isValidName(student.last_name)) {
        stats.errors.push({ row: i+1, message: 'Invalid student lastName: letters only (spaces, hyphens, apostrophes allowed), must start/end with a letter' });
        continue;
      }
      // Trim clean values before insert
      student.first_name = String(student.first_name).trim();
      student.last_name  = String(student.last_name).trim();

      try {
        const sIns = await db.query(
          `INSERT INTO student (external_id, first_name, last_name, dob, status, can_leave_alone, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING id`,
          [
            student.external_id,
            student.first_name,
            student.last_name,
            student.dob,
            student.status,
            student.can_leave_alone,
            student.notes
          ]
        );
        const studentId = sIns.rows[0].id;

        // Guardian 1 (validation handled inside helper; invalid names are skipped)
        await maybeInsertGuardianLink(db, studentId, {
          firstName: r.g1_firstName ?? r.g1_first_name,
          lastName:  r.g1_lastName  ?? r.g1_last_name,
          phone:     r.g1_phone,
          email:     r.g1_email,
          relationship: r.g1_relationship || 'GUARDIAN',
          primary:   toBool(r.g1_primary ?? 'true'),
        });

        // Guardian 2 (validation handled inside helper; invalid names are skipped)
        await maybeInsertGuardianLink(db, studentId, {
          firstName: r.g2_firstName ?? r.g2_first_name,
          lastName:  r.g2_lastName  ?? r.g2_last_name,
          phone:     r.g2_phone,
          email:     r.g2_email,
          relationship: r.g2_relationship || 'GUARDIAN',
          primary:   toBool(r.g2_primary ?? 'false'),
        });

        // Ensure QR token exists now (PNG generated later on demand)
        await db.query(
          `INSERT INTO qr_code (student_id, token, active, created_by)
           VALUES ($1,$2,TRUE,$3)`,
          [studentId, crypto.randomUUID(), req.user?.id || null]
        );

        stats.created++;
        createdIds.push(studentId);
      } catch (e) {
        stats.errors.push({ row: i+1, message: e.message });
      }
    }

    return res.json({ ...stats, createdIds });
  } catch (err) {
    return next(err);
  }
}

async function maybeInsertGuardianLink(db, studentId, g) {
  const first = (g.firstName || '').toString().trim();
  const last  = (g.lastName || '').toString().trim();
  const phone = (g.phone || '').toString().trim();

  // Require presence of all three fields as before
  if (!first || !last || !phone) return;

  // Validate guardian names; skip if invalid (do not change existing error handling shape)
  if (!isValidName(first)) return;
  if (!isValidName(last)) return;

  const e164 = toE164AU(phone);
  if (!e164) return;

  const ins = await db.query(
    `INSERT INTO guardian (first_name, last_name, relationship, email, phone_raw, phone_e164, phone_valid, active)
     VALUES ($1,$2,$3,$4,$5,$6,TRUE,TRUE)
     RETURNING id`,
    [first, last, g.relationship || 'GUARDIAN', g.email || null, phone, e164]
  );
  const gid = ins.rows[0].id;

  await db.query(
    `INSERT INTO student_guardian (student_id, guardian_id, is_primary)
     VALUES ($1,$2,$3)
     ON CONFLICT (student_id, guardian_id) DO UPDATE SET is_primary = EXCLUDED.is_primary`,
    [studentId, gid, !!g.primary]
  );
}