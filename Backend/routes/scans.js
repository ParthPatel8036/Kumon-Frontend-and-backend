// routes/scans.js
import express from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { previewScan, handleScan, getTodayStats, getRecentScans } from '../controllers/scanController.js';

const router = express.Router();

// Returns { student, body, ... } without sending SMS
router.post('/preview', requireAuth, previewScan);

// Today's scan stats (includes headcount-only / non-SMS scans)
router.get('/stats/today', requireAuth, getTodayStats);

// Recent scans (used by Dashboard to show non-SMS entries too)
router.get('/recent', requireAuth, getRecentScans);

// Performs the scan + logs + sends SMS (optionally with messageOverride)
router.post('/', requireAuth, handleScan);

export default router;