// scripts/generate-qr.js
import 'dotenv/config';
import crypto from 'node:crypto';
import db from '../db.js';
import QRCode from 'qrcode';

function makeToken() {
  // UUID is fine for our opaque token
  return crypto.randomUUID();
}

async function main() {
  const client = await db.pool.connect();
  try {
    console.log('Scanning for students without an active QR…');
    const { rows: students } = await client.query(`
      SELECT s.id, s.first_name, s.last_name
      FROM student s
      LEFT JOIN qr_code q ON q.student_id = s.id AND q.active = TRUE
      WHERE q.id IS NULL AND s.status = 'ACTIVE'
      ORDER BY s.id
    `);

    if (students.length === 0) {
      console.log('All active students already have QR tokens. Nothing to do.');
      return;
    }

    console.log(`Found ${students.length} students. Generating tokens…`);
    let inserted = 0;
    for (const s of students) {
      // retry if token collision (extremely unlikely)
      let token = makeToken();
      for (let tries = 0; tries < 3; tries++) {
        try {
          await client.query(
            `INSERT INTO qr_code (student_id, token, active, created_by)
             VALUES ($1,$2,TRUE,NULL)`,
            [s.id, token]
          );
          inserted++;
          break;
        } catch (e) {
          if (String(e.message).includes('duplicate key')) {
            token = makeToken(); // regenerate & retry
          } else {
            throw e;
          }
        }
      }
    }
    console.log(`Inserted ${inserted} QR tokens.`);

    // OPTIONAL: also generate simple PNGs into /tmp/qr for local export
    // Remove this block if you don’t want files written on the server.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const outDir = '/tmp/qr';
    await fs.mkdir(outDir, { recursive: true });

    // Load all active tokens and render minimal JSON QR payload: {"token":"…","v":1}
    const { rows: qrs } = await client.query(`
      SELECT s.id, s.first_name, s.last_name, q.token
      FROM qr_code q
      JOIN student s ON s.id = q.student_id
      WHERE q.active = TRUE
      ORDER BY s.id
    `);

    console.log(`Rendering ${qrs.length} PNGs to ${outDir} …`);
    for (const r of qrs) {
      const text = JSON.stringify({ v: 1, token: r.token });
      const file = path.join(outDir, `student_${r.id}_${r.first_name}_${r.last_name}.png`
        .replace(/\s+/g, '_')
        .replace(/[^a-zA-Z0-9_.-]/g, '')
      );
      await QRCode.toFile(file, text, { errorCorrectionLevel: 'M', margin: 2, width: 512 });
    }
    console.log('Done. You can download files from the server (e.g., via one-off job logs/artifacts).');
  } finally {
    client.release();
    await db.pool.end();
  }
}

main().catch(e => {
  console.error('QR generation failed:', e);
  process.exit(1);
});
