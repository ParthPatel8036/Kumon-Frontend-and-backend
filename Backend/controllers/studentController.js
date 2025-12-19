import db from '../db.js';
import logAdminAction from '../utils/logAdminAction.js';

/**
 * Unicode-aware name validation:
 * - Allowed: letters (incl. accents) and combining marks, spaces, hyphens (-), apostrophes (' or ’)
 * - Must start and end with a letter; 1–100 chars after trimming
 */
const NAME_REGEX = /^[\p{L}\p{M}](?:[\p{L}\p{M}\s'\-’]*[\p{L}\p{M}])?$/u;

function validateName(label, value) {
  const v = (value ?? '').trim();
  if (!v) return `${label} is required`;
  if (v.length > 100) return `${label} must be 100 characters or less`;
  if (!NAME_REGEX.test(v)) {
    return `${label} must contain only letters (plus spaces, hyphens, apostrophes) and start/end with a letter`;
  }
  return null; // ok
}

export async function createStudent(req, res, next) {
  try {
    const {
      externalId = null,
      firstName,
      lastName,
      status = 'ACTIVE',
      canLeaveAlone = false,
      notes = null
    } = req.body || {};

    if (!firstName || !lastName) {
      return res.status(400).json({ error: 'firstName and lastName are required' });
    }

    // ---- Name validation (added) ----
    const firstNameErr = validateName('firstName', firstName);
    if (firstNameErr) return res.status(400).json({ error: firstNameErr });
    const lastNameErr = validateName('lastName', lastName);
    if (lastNameErr) return res.status(400).json({ error: lastNameErr });
    const firstNameClean = firstName.trim();
    const lastNameClean  = lastName.trim();
    // ---------------------------------

    const { rows } = await db.query(
      `INSERT INTO student (external_id, first_name, last_name, status, can_leave_alone, notes)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [externalId, firstNameClean, lastNameClean, status, !!canLeaveAlone, notes]
    );

    await logAdminAction(req.user.id, 'STUDENT_CREATE', 'student', rows[0].id, { firstName: firstNameClean, lastName: lastNameClean });
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function listStudents(req, res, next) {
  try {
    const {
      search = '',
      status,
      limit = 50,
      offset = 0,
      id,      // NEW
      ids,     // NEW
    } = req.query;

    const clauses = [];
    const params = [];
    let p = 1;

    // NEW: parse ?id / ?ids into a unique int[] (ignore non-numeric/<=0)
    const idList = [];
    if (id !== undefined && id !== null && String(id).trim() !== '') {
      const n = Number(id);
      if (Number.isFinite(n) && n > 0) idList.push(n);
    }
    if (ids !== undefined && ids !== null && String(ids).trim() !== '') {
      String(ids).split(',').forEach(part => {
        const n = Number(part.trim());
        if (Number.isFinite(n) && n > 0) idList.push(n);
      });
    }
    const uniqIds = Array.from(new Set(idList));
    if (uniqIds.length === 1) {
      clauses.push(`id = $${p}`);
      params.push(uniqIds[0]);
      p++;
    } else if (uniqIds.length > 1) {
      clauses.push(`id = ANY($${p}::int[])`);
      params.push(uniqIds);
      p++;
    }
    // END NEW

    if (search) {
      clauses.push(`(first_name ILIKE $${p} OR last_name ILIKE $${p} OR external_id ILIKE $${p})`);
      params.push(`%${search}%`);
      p++;
    }
    if (status) {
      clauses.push(`status = $${p}`);
      params.push(status);
      p++;
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(Number(limit), Number(offset));

    const { rows } = await db.query(
      `SELECT
         id,
         external_id,
         first_name,
         last_name,
         dob,
         status,
         can_leave_alone,
         notes,
         created_at,
         updated_at
       FROM student
       ${where}
       ORDER BY last_name, first_name
       LIMIT $${p++} OFFSET $${p}`,
      params
    );

    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
}

export async function updateStudent(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });

    // allow dob + snake_case
    const allowed = ['external_id', 'first_name', 'last_name', 'dob', 'status', 'can_leave_alone', 'notes'];

    // accept camelCase from the frontend too
    const camelToSnake = {
      externalId: 'external_id',
      firstName: 'first_name',
      lastName:  'last_name',
      dob: 'dob',
      status: 'status',
      canLeaveAlone: 'can_leave_alone',
      notes: 'notes',
    };

    const body = req.body || {};
    const sets = [];
    const params = [];
    let p = 1;

    for (const [rawKey, rawVal] of Object.entries(body)) {
      const key = camelToSnake[rawKey] || rawKey;
      if (allowed.includes(key)) {
        // ---- Name validation on updates (added) ----
        let valueToUse = rawVal;
        if (key === 'first_name' || key === 'last_name') {
          const label = key === 'first_name' ? 'firstName' : 'lastName';
          const errMsg = validateName(label, rawVal);
          if (errMsg) return res.status(400).json({ error: errMsg });
          valueToUse = String(rawVal).trim();
        }
        // -------------------------------------------
        sets.push(`${key} = $${p++}`);
        params.push(valueToUse);
      }
    }

    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });

    params.push(id);

    const { rows } = await db.query(
      `UPDATE student SET ${sets.join(', ')}, updated_at = now()
       WHERE id = $${p}
       RETURNING *`,
      params
    );

    if (!rows[0]) return res.status(404).json({ error: 'Not found' });

    await logAdminAction(req.user.id, 'STUDENT_UPDATE', 'student', id, body);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function linkGuardian(req, res, next) {
  try {
    const studentId = Number(req.params.id);
    const guardianId = Number(req.params.gid);
    if (!studentId || !guardianId) return res.status(400).json({ error: 'Invalid ids' });

    await db.query(
      `INSERT INTO student_guardian (student_id, guardian_id, is_primary)
       VALUES ($1,$2,$3)
       ON CONFLICT (student_id, guardian_id) DO UPDATE SET is_primary = EXCLUDED.is_primary`,
      [studentId, guardianId, !!req.body?.isPrimary]
    );

    await logAdminAction(req.user.id, 'STUDENT_LINK_GUARDIAN', 'student', studentId, { guardianId });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Unlink a guardian from a student but KEEP the guardian record in the system.
 * Route (to be wired): DELETE /students/:id/guardians/:gid
 */
export async function unlinkGuardian(req, res, next) {
  try {
    const studentId = Number(req.params.id);
    const guardianId = Number(req.params.gid);
    if (!studentId || !guardianId) return res.status(400).json({ error: 'Invalid ids' });

    const result = await db.query(
      `DELETE FROM student_guardian WHERE student_id = $1 AND guardian_id = $2`,
      [studentId, guardianId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Link not found' });
    }

    await logAdminAction(req.user.id, 'STUDENT_UNLINK_GUARDIAN', 'student', studentId, { guardianId });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function deleteStudent(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });

    await db.query('BEGIN');

    // Guardians linked to this student (capture before deleting joins)
    const { rows: gRows } = await db.query(
      `SELECT guardian_id FROM student_guardian WHERE student_id = $1`,
      [id]
    );
    const guardianIds = [...new Set(gRows.map(r => r.guardian_id))];

    // Remove join links for this student
    await db.query(`DELETE FROM student_guardian WHERE student_id = $1`, [id]);

    // Delete the student
    const { rows: sRows } = await db.query(
      `DELETE FROM student WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!sRows[0]) {
      await db.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }

    // For each guardian, delete only if no other students are linked
    const deletedGuardianIds = [];
    for (const gid of guardianIds) {
      const { rows: cnt } = await db.query(
        `SELECT COUNT(*)::int AS c FROM student_guardian WHERE guardian_id = $1`,
        [gid]
      );
      if ((cnt[0]?.c ?? 0) === 0) {
        await db.query(`DELETE FROM guardian WHERE id = $1`, [gid]);
        deletedGuardianIds.push(gid);
      }
    }

    await logAdminAction(req.user.id, 'STUDENT_DELETE', 'student', id, {
      deletedGuardianIds,
    });

    await db.query('COMMIT');
    res.json({ ok: true, deletedStudentId: id, deletedGuardianIds });
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch {}
    next(err);
  }
}