// routes/users.js
import express from 'express';
import { requireAuth, requireAdmin } from '../middlewares/auth.js';
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
} from '../controllers/userController.js';

const router = express.Router();

// Read (admin only)
router.get('/', requireAuth, requireAdmin, listUsers);

// Write (admin only)
router.post('/', requireAuth, requireAdmin, createUser);
router.patch('/:id', requireAuth, requireAdmin, updateUser);

// Delete (admin only)
router.delete('/:id', requireAuth, requireAdmin, deleteUser);

export default router;