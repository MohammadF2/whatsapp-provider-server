import express from 'express';
import { getMessageHistory } from '../controllers/message-history.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticate as any);

// Get message history
router.get('/', getMessageHistory as any);

export default router;
