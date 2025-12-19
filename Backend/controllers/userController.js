// controllers/userController.js
import db from '../db.js';
import bcrypt from 'bcryptjs';
import logAdminAction from '../utils/logAdminAction.js';

/**
 * Normalise and validate role against the enum used across the app.
 * Accepts case-insensitive "ADMIN" | "STAFF".
 */
function normalizeRole(role) {
  const r = String(role || '').trim().toUpperCase();
  if (r === 'ADMIN' || r === 'STAFF') return r;
  return null;
}

/**
 * Very light email check (CITEXT + unique constraint in DB provides the rest).
 */
function isEmail(s) {
  return typeof s === 'string' && /\S+@\S+\.\S+/.test(s);
}

/**
 * GET /users
 * Query: ?limit=&offset=&search=&role=&active=
 * Returns { items: Array<User> }
 */
export async function listUsers(req, res, next) {
  try {
    const {
      limit = 100,
      offset = 0,
      search = '',
      role = '',
      active = '',
    } = req.query || {};

    const clauses = [];
    const params = [];
    let i = 1;

    if (search) {
      clauses.push(`(email ILIKE $${i})`);
      params.push(`%${search}%`);
      i++;
    }
    if (role) {
      const r = normalizeRole(role);
      if (!r) return res.status(400).json({ error: 'Invalid role' });
      clauses.push(`role = $${i}`);
      params.push(r);
      i++;
    }
    if (active === 'yes' || active === 'no') {
      clauses.push(`active = $${i}`);
      params.push(active === 'yes');
      i++;
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(Number(limit), Number(offset));

    const { rows } = await db.query(
      `
      SELECT
        id, email, role, active,
        last_login_at, created_at, updated_at
      FROM app_user
      ${where}
      ORDER BY created_at DESC
      LIMIT $${i++} OFFSET $${i}
      `,
      params
    );

    return res.json({ items: rows });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /users
 * Body: { email, password, role, active? }
 */
export async function createUser(req, res, next) {
  try {
    const { email, password, role, active = true } = req.body || {};
    if (!isEmail(email)) return res.status(400).json({ error: 'Valid email required' });
    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const r = normalizeRole(role);
    if (!r) return res.status(400).json({ error: 'role must be ADMIN or STAFF' });

    const hash = await bcrypt.hash(String(password), 10);

    const { rows } = await db.query(
      `
      INSERT INTO app_user (email, password_hash, role, active)
      VALUES ($1, $2, $3, $4)
      RETURNING id, email, role, active, last_login_at, created_at, updated_at
      `,
      [String(email).trim(), hash, r, !!active]
    );

    await logAdminAction(req.user.id, 'USER_CREATE', 'app_user', rows[0].id, {
      email: rows[0].email,
      role: rows[0].role,
      active: rows[0].active,
    });

    return res.status(201).json(rows[0]);
  } catch (err) {
    // Unique violation on email
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    return next(err);
  }
}

/**
 * PATCH /users/:id
 * Body: any of { email, role, active, password }
 */
export async function updateUser(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const { email, role, active, password } = req.body || {};

    const sets = [];
    const params = [];
    let i = 1;

    if (email !== undefined) {
      if (!isEmail(email)) return res.status(400).json({ error: 'Valid email required' });
      sets.push(`email = $${i++}`);
      params.push(String(email).trim());
    }

    if (role !== undefined) {
      const r = normalizeRole(role);
      if (!r) return res.status(400).json({ error: 'role must be ADMIN or STAFF' });
      sets.push(`role = $${i++}`);
      params.push(r);
    }

    if (active !== undefined) {
      sets.push(`active = $${i++}`);
      params.push(!!active);
    }

    if (password !== undefined) {
      if (!password || String(password).length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
      }
      const hash = await bcrypt.hash(String(password), 10);
      sets.push(`password_hash = $${i++}`);
      params.push(hash);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }

    sets.push(`updated_at = now()`);

    const { rows: before } = await db.query(
      `SELECT id FROM app_user WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (!before[0]) return res.status(404).json({ error: 'User not found' });

    const { rows } = await db.query(
      `
      UPDATE app_user
         SET ${sets.join(', ')}
       WHERE id = $${i}
       RETURNING id, email, role, active, last_login_at, created_at, updated_at
      `,
      [...params, id]
    );

    await logAdminAction(req.user.id, 'USER_UPDATE', 'app_user', id, {
      fields: Object.keys(req.body || {}),
    });

    return res.json(rows[0]);
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    return next(err);
  }
}

/**
 * DELETE /users/:id
 */
export async function deleteUser(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const { rows: before } = await db.query(
      `SELECT id, email FROM app_user WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (!before[0]) return res.status(404).json({ error: 'User not found' });

    await db.query(`DELETE FROM app_user WHERE id = $1`, [id]);

    await logAdminAction(req.user.id, 'USER_DELETE', 'app_user', id, {
      email: before[0].email,
    });

    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
}