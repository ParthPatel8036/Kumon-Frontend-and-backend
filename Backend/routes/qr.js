// routes/qr.js
import express from 'express';
import { requireAuth, requireAdmin } from '../middlewares/auth.js';
import {
  generateQRCodes,
  downloadQrPng,
  cleanupQRPngs
} from '../controllers/qrController.js';

const router = express.Router();

// Generate (admin only)
router.post('/generate', requireAuth, requireAdmin, generateQRCodes);

// Download one PNG by student id (auth required)
router.get('/:studentId.png', requireAuth, downloadQrPng);

// Delete temporary PNG files (admin only)
router.post('/cleanup', requireAuth, requireAdmin, cleanupQRPngs);

export default router;