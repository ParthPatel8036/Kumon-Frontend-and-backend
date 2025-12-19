import db from '../db.js';

export default async function logAdminAction(actorId, action, entityType, entityId, details = {}) {
  try {
    await db.query(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [actorId || null, action, entityType, String(entityId || ''), details]
    );
  } catch (e) {
    console.error('audit_log insert failed', e.message);
  }
}
