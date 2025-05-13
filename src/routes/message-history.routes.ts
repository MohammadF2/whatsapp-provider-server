import express from 'express';
import { getMessageHistory, getDeviceMessageHistory } from '../controllers/message-history.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticate as any);

// Get all message history with filtering
router.get('/', getMessageHistory as any);

// Get message history for a specific device
router.get('/device/:deviceId', getDeviceMessageHistory as any);

export default router;
