// controllers/messageController.js
import db from '../db.js';

export async function listMessages(req, res, next) {
  try {
    const { studentId, limit = 50, offset = 0, include } = req.query;

    // include=student (case-insensitive; supports comma-separated values)
    const wantStudent = typeof include === 'string' &&
      include.toLowerCase().split(',').map(s => s.trim()).includes('student');

    const params = [Number(limit), Number(offset)];
    let where = '';
    if (studentId) {
      where = 'WHERE ml.student_id = $3';
      params.push(Number(studentId));
    }

    const selectStudentCols = wantStudent
      ? `,
         s.id         AS s_id,
         s.first_name AS s_first_name,
         s.last_name  AS s_last_name,
         s.dob        AS s_dob`
      : '';

    const joinStudent = wantStudent
      ? `LEFT JOIN student s ON s.id = ml.student_id`
      : '';

    const { rows } = await db.query(
      `SELECT
          ml.id,
          ml.student_id,
          ml.template_key,
          ml.body_rendered,
          ml.created_at,
          (SELECT json_agg(json_build_object(
              'id', mr.id,
              'to', mr.phone_e164,
              'status', mr.status,
              'gateway_message_id', mr.gateway_message_id,
              'gateway_status', mr.gateway_status,
              'updated_at', mr.updated_at
           ) ORDER BY mr.id)
           FROM message_recipient mr
           WHERE mr.message_log_id = ml.id) AS recipients
          ${selectStudentCols}
       FROM message_log ml
       ${joinStudent}
       ${where}
       ORDER BY ml.created_at DESC
       LIMIT $1 OFFSET $2`,
      params
    );

    const items = rows.map(r => {
      const base = {
        id: r.id,
        student_id: r.student_id,
        template_key: r.template_key,
        body_rendered: r.body_rendered,
        created_at: r.created_at,
        recipients: r.recipients,
      };
      if (wantStudent && r.s_id) {
        base.student = {
          id: r.s_id,
          firstName: r.s_first_name || null,
          lastName: r.s_last_name || null,
          dob: r.s_dob || null, 
        };
      }
      return base;
    });

    res.json({ items });
  } catch (err) {
    next(err);
  }
}