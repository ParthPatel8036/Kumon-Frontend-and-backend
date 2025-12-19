import express from 'express';
import { login, me, updateMe, refresh } from '../controllers/authController.js';
import { requireAuth } from '../middlewares/auth.js';

const router = express.Router();

router.post('/login', login);
router.get('/me', requireAuth, me);
router.patch('/me', requireAuth, updateMe);
router.post('/refresh', requireAuth, refresh);

export default router;