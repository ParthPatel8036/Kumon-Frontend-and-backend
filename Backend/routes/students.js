// routes/students.js
import express from 'express';
import { requireAuth, requireAdmin } from '../middlewares/auth.js';
import {
  createStudent,
  listStudents,
  updateStudent,
  linkGuardian,
  deleteStudent,
} from '../controllers/studentController.js';

const router = express.Router();

// Read
router.get('/', requireAuth, listStudents);

// Write (must authenticate first, then check admin)
router.post('/', requireAuth, requireAdmin, createStudent);
router.patch('/:id', requireAuth, requireAdmin, updateStudent);
router.post('/:id/guardians/:gid', requireAuth, requireAdmin, linkGuardian);

// Delete
router.delete('/:id', requireAuth, requireAdmin, deleteStudent)

export default router;