import db from '../db.js';
import logAdminAction from '../utils/logAdminAction.js';

export async function listTemplates(req, res, next) {
  try {
    const { rows } = await db.query(`SELECT id, key, text, updated_by, updated_at FROM message_template ORDER BY key`);
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
}

export async function updateTemplate(req, res, next) {
  try {
    const { key } = req.params;
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text is required' });

    const { rows } = await db.query(
      `UPDATE message_template
          SET text = $1, updated_by = $2, updated_at = now()
        WHERE key = $3
      RETURNING id, key, text, updated_by, updated_at`,
      [text, req.user.id, key]
    );

    if (!rows[0]) return res.status(404).json({ error: 'Template not found' });

    await logAdminAction(req.user.id, 'TEMPLATE_EDIT', 'message_template', rows[0].id, { key, text });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}
