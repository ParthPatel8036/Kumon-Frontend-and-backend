// routes/import.js
import express from 'express';
import multer from 'multer';
import { requireAuth, requireAdmin } from '../middlewares/auth.js';
import { importCsv } from '../controllers/importController.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/csv', requireAuth, requireAdmin, upload.single('file'), importCsv);

export default router;