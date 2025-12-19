import express from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { listMessages } from '../controllers/messageController.js';

const router = express.Router();

router.get('/', requireAuth, listMessages);

export default router;
