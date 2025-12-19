// routes/settings.js
import express from 'express';
import { requireAuth, requireAdmin } from '../middlewares/auth.js';
import {
  getOrgSettings,
  updateOrgSettings,
  testSms,
  getHealth,
  exportScans,
  exportMessages,
  purgeOldData,
} from '../controllers/settingsController.js';

const router = express.Router();

// Read organisation settings (Staff can read; Admin edits)
router.get('/', requireAuth, getOrgSettings);

// Update organisation settings (Admin only)
router.patch('/', requireAuth, requireAdmin, updateOrgSettings);

// Send a test SMS (Admin only)
router.post('/test-sms', requireAuth, requireAdmin, testSms);

// System health (basic status for authenticated users)
router.get('/health', requireAuth, getHealth);

// Exports (Admin only)
router.get('/export/scans', requireAuth, requireAdmin, exportScans);
router.get('/export/messages', requireAuth, requireAdmin, exportMessages);

// Archive & purge data older than policy window (Admin only)
router.post('/purge-old', requireAuth, requireAdmin, purgeOldData);

export default router;