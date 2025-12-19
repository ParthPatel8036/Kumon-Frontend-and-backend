// routes/templates.js
import express from 'express';
import { requireAuth, requireAdmin } from '../middlewares/auth.js';
import { listTemplates, updateTemplate } from '../controllers/templateController.js';

const router = express.Router();

router.get('/', requireAuth, listTemplates);
router.patch('/:key', requireAuth, requireAdmin, updateTemplate);

export default router;