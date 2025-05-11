import express from 'express';
import {
  sendWhatsAppMessage,
  disconnectWhatsApp,
  testWhatsAppConnection
} from '../controllers/whatsapp.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = express.Router();

// Test WhatsApp connection (no authentication required)
router.get('/test/:deviceId', testWhatsAppConnection as any);

// Apply authentication middleware to all other routes
router.use(authenticate as any);

// Send a WhatsApp message
router.post('/send', sendWhatsAppMessage as any);

// Disconnect WhatsApp
router.post('/disconnect/:deviceId', disconnectWhatsApp as any);

export default router;
