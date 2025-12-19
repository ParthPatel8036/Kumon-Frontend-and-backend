import jwt from 'jsonwebtoken';

/**
 * Extracts a Bearer token from the Authorization header.
 */
function getBearerToken(req) {
  const header = req.headers?.authorization || '';
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

/**
 * Verifies a JWT and returns its payload or throws.
 */
function verifyJwt(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

/**
 * Auth middleware: requires a valid JWT.
 * - 401 Missing/invalid/expired token
 * - Attaches decoded payload to req.user
 */
export function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing token' });
  }
  try {
    const payload = verifyJwt(token);
    req.user = payload;
    return next();
  } catch (err) {
    // Distinguish common JWT errors (optional but helpful)
    if (err?.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * Admin guard:
 * - 401 if not authenticated (use with requireAuth first for best results)
 * - 403 if authenticated but not ADMIN
 */
export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Auth required' });
  }
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin only' });
  }
  return next();
}

/**
 * Generic role guard (optional helper for future use).
 * Example: router.patch('/templates/:key', requireAuth, requireRole(['ADMIN', 'STAFF']), updateTemplate)
 */
export function requireRole(roles = []) {
  const wanted = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Auth required' });
    }
    if (!wanted.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}