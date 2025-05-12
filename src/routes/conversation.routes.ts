import express from 'express';
import {
  getConversations,
  getMessages,
  markAsRead
} from '../controllers/conversation.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticate as any);

// Get all conversations for a device
router.get('/conversations/:deviceId', getConversations as any);

// Get messages for a specific conversation
router.get('/messages/:deviceId/:chatId', getMessages as any);

// Mark a conversation as read
router.post('/read/:deviceId/:chatId', markAsRead as any);

export default router;
