import express from 'express';
import { requireAuth, requireAdmin } from '../middlewares/auth.js';
import {
  createGuardian,
  listGuardians,
  listStudentsByGuardianIds,
  listStudentsForOneGuardian,
  updateGuardian,
  deleteGuardian,
} from '../controllers/guardianController.js';

const router = express.Router();

// Students-by-guardian endpoints
router.get('/students', requireAuth, listStudentsByGuardianIds);       // ?ids=1,2,3
router.get('/:id/students', requireAuth, listStudentsForOneGuardian);  // single guardian

// CRUD
router.get('/', requireAuth, listGuardians);
router.post('/', requireAuth, requireAdmin, createGuardian);
router.patch('/:id', requireAuth, requireAdmin, updateGuardian);
router.delete('/:id', requireAuth, requireAdmin, deleteGuardian);

export default router;