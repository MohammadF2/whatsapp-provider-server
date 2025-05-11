import express from 'express';
import { register, login, getProfile } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = express.Router();

// Register a new user
router.post('/register', register as any);

// Login user
router.post('/login', login as any);

// Get user profile (protected route)
router.get('/profile', authenticate as any, getProfile as any);

export default router;
