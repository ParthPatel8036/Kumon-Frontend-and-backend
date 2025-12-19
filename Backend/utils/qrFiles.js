// utils/qrFiles.js
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const QR_DIR = process.env.QR_DIR || path.join(ROOT, 'tmp', 'qr');

export async function ensureDir() {
  await fsp.mkdir(QR_DIR, { recursive: true });
}

export async function pngPathFor(studentId) {
  return path.join(QR_DIR, `qr_${studentId}.png`);
}

export async function writePng(studentId, buffer) {
  const p = await pngPathFor(studentId);
  await ensureDir();
  await fsp.writeFile(p, buffer);
  return p;
}

export async function deleteMany(studentIds = []) {
  await ensureDir();
  let deleted = 0;
  const items = [];

  for (const id of studentIds) {
    const p = await pngPathFor(id);
    try {
      await fsp.unlink(p);
      deleted++;
      items.push({ studentId: id, deleted: true });
    } catch {
      items.push({ studentId: id, deleted: false });
    }
  }
  return { deleted, items, dir: QR_DIR };
}
