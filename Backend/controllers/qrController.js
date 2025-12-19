// controllers/qrController.js
import crypto from "crypto";
import QRCode from "qrcode";
import db from "../db.js";
import { repoPut, repoGet, repoDelete } from "../utils/githubRepo.js";

const QR_REPO_DIR = process.env.QR_REPO_DIR || "qr"; // folder in your repo (e.g., qr/)
const pngPath = (studentId) => `${QR_REPO_DIR}/qr_${studentId}.png`;

async function ensureActiveToken(studentId, createdBy) {
  const { rows } = await db.query(
    `SELECT token FROM qr_code WHERE student_id=$1 AND active=TRUE LIMIT 1`,
    [studentId]
  );
  if (rows[0]?.token) return rows[0].token;

  const token = crypto.randomUUID();
  await db.query(
    `INSERT INTO qr_code (student_id, token, active, created_by)
     VALUES ($1,$2,TRUE,$3)`,
    [studentId, token, createdBy || null]
  );
  return token;
}

/**
 * POST /qr/generate
 * Body: { studentIds: number[] }
 * Generates PNGs and commits them to the GitHub repo under QR_REPO_DIR.
 */
export async function generateQRCodes(req, res, next) {
  try {
    const ids = Array.isArray(req.body?.studentIds) ? req.body.studentIds : [];
    const studentIds = ids.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (!studentIds.length) {
      return res.status(400).json({ error: "studentIds must be a non-empty array of integers" });
    }

    const out = [];
    for (const sid of studentIds) {
      try {
        const s = await db.query(`SELECT id FROM student WHERE id=$1`, [sid]);
        if (!s.rows[0]) {
          out.push({ studentId: sid, ok: false, error: "Student not found" });
          continue;
        }

        const token = await ensureActiveToken(sid, req.user?.id);
        const buf = await QRCode.toBuffer(token, {
          type: "png",
          errorCorrectionLevel: "M",
          margin: 1,
          width: 512,
        });
        await repoPut(pngPath(sid), buf, `Add/Update QR for student ${sid}`);
        out.push({ studentId: sid, ok: true });
      } catch (e) {
        out.push({ studentId: sid, ok: false, error: e.message });
      }
    }
    return res.json({ items: out });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /qr/:studentId.png
 * Serves the PNG from the GitHub repo (creates & commits if missing).
 */
export async function downloadQrPng(req, res, next) {
  try {
    const studentId = Number(req.params.studentId);
    if (!Number.isInteger(studentId) || studentId <= 0) {
      return res.status(400).json({ error: "Invalid studentId" });
    }

    // Try fetch from repo
    let file = await repoGet(pngPath(studentId));

    // If not present, create and upload then serve
    if (!file) {
      const token = await ensureActiveToken(studentId, req.user?.id);
      const buf = await QRCode.toBuffer(token, {
        type: "png",
        errorCorrectionLevel: "M",
        margin: 1,
        width: 512,
      });
      await repoPut(pngPath(studentId), buf, `Add QR for student ${studentId}`);
      file = await repoGet(pngPath(studentId));
    }

    // file.content is base64
    const base64 = file.content.replace(/\n/g, "");
    const buf = Buffer.from(base64, "base64");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", `attachment; filename="qr_${studentId}.png"`);
    return res.send(buf);
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /qr/cleanup
 * Body: { studentIds: number[] }
 * Deletes PNG files from the GitHub repo.
 */
export async function cleanupQRPngs(req, res, next) {
  try {
    const ids = Array.isArray(req.body?.studentIds) ? req.body.studentIds : [];
    const studentIds = ids.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (!studentIds.length) {
      return res.status(400).json({ error: "studentIds must be a non-empty array of integers" });
    }

    const items = [];
    for (const sid of studentIds) {
      try {
        const path = pngPath(sid);
        const del = await repoDelete(path, `Delete QR for student ${sid}`);
        items.push({ studentId: sid, deleted: !!del.deleted });
      } catch (e) {
        items.push({ studentId: sid, deleted: false, error: e.message });
      }
    }
    return res.json({ items, repoDir: QR_REPO_DIR });
  } catch (err) {
    return next(err);
  }
}