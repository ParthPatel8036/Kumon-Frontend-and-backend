// /controllers/authController.js
import db from '../db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const SHORT_TTL = process.env.JWT_EXPIRES_SHORT || '12h'; // default short session
const LONG_TTL = process.env.JWT_EXPIRES_LONG || '30d';   // default "keep me signed in"

function signToken(claims, remember = false) {
  return jwt.sign(
    { ...claims, remember: !!remember },
    process.env.JWT_SECRET,
    { expiresIn: remember ? LONG_TTL : SHORT_TTL }
  );
}

export async function login(req, res, next) {
  try {
    const { email, password, remember } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const { rows } = await db.query(
      `SELECT id, email, password_hash, role, active
         FROM app_user
        WHERE email = $1
        LIMIT 1`,
      [email]
    );

    const user = rows[0];
    if (!user || !user.active) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(
      { id: user.id, email: user.email, role: user.role },
      !!remember
    );

    await db.query(`UPDATE app_user SET last_login_at = now() WHERE id = $1`, [user.id]);

    res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role }
    });
  } catch (err) {
    next(err);
  }
}

// Return fresh user details from DB (not just JWT payload)
export async function me(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { rows } = await db.query(
      `SELECT id, email, role
         FROM app_user
        WHERE id = $1
        LIMIT 1`,
      [userId]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({ user: { id: user.id, email: user.email, role: user.role } });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /auth/me
 * Body: { email?, password? }
 * - Email: validates format and uniqueness (case-insensitive).
 * - Password: min length 6, bcrypt-hashed.
 * Returns: { user, token? } — token is returned if claims changed (e.g., email).
 */
export async function updateMe(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { rows: curRows } = await db.query(
      `SELECT id, email, role
         FROM app_user
        WHERE id = $1
        LIMIT 1`,
      [userId]
    );
    const current = curRows[0];
    if (!current) return res.status(404).json({ error: 'User not found' });

    const { email, password } = req.body || {};
    const wantsEmail = typeof email === 'string';
    const wantsPassword = typeof password === 'string';

    if (!wantsEmail && !wantsPassword) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const setClauses = [];
    const values = [];
    let idx = 1;
    let nextEmail = current.email;

    if (wantsEmail) {
      const e = String(email).trim();
      // minimal email sanity check
      const emailOk = /^\S+@\S+\.\S+$/.test(e);
      if (!emailOk) return res.status(400).json({ error: 'Invalid email format' });

      // Only check uniqueness if it actually changes (case-insensitive)
      if (e.toLowerCase() !== current.email.toLowerCase()) {
        const { rows: dup } = await db.query(
          `SELECT 1 FROM app_user WHERE lower(email) = lower($1) AND id <> $2 LIMIT 1`,
          [e, userId]
        );
        if (dup.length) return res.status(409).json({ error: 'Email already in use' });

        setClauses.push(`email = $${idx++}`);
        values.push(e);
        nextEmail = e;
      }
    }

    if (wantsPassword) {
      const p = String(password);
      if (p.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

      const hash = await bcrypt.hash(p, 10);
      setClauses.push(`password_hash = $${idx++}`);
      values.push(hash);
    }

    // If nothing to change after validation/dup checks, just return current
    if (setClauses.length === 0) {
      return res.json({ user: { id: current.id, email: current.email, role: current.role } });
    }

    const sql = `
      UPDATE app_user
         SET ${setClauses.join(', ')}, updated_at = now()
       WHERE id = $${idx}
       RETURNING id, email, role
    `;
    values.push(userId);

    const { rows: upRows } = await db.query(sql, values);
    const updated = upRows[0];

    // Issue a fresh token so JWT claims (email) stay in sync for the client.
    // Preserve the "remember" policy from the current token if present.
    const remember = !!req.user?.remember;
    const token = signToken(
      { id: updated.id, email: updated.email, role: updated.role },
      remember
    );

    res.json({
      user: { id: updated.id, email: updated.email, role: updated.role },
      token
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /auth/refresh
 * Requires Authorization: Bearer <token>
 * Returns a fresh token (and current user snapshot) using the same remember policy.
 */
export async function refresh(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Always refresh against latest user data (email/role might have changed)
    const { rows } = await db.query(
      `SELECT id, email, role
         FROM app_user
        WHERE id = $1
        LIMIT 1`,
      [userId]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const remember = !!req.user?.remember;
    const token = signToken(
      { id: user.id, email: user.email, role: user.role },
      remember
    );

    res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role }
    });
  } catch (err) {
    next(err);
  }
}