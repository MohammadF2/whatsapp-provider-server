import express from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  sendWhatsAppMessage,
  disconnectWhatsApp,
  testWhatsAppConnection,
  sendTextMessage,
  sendFileMessage,
  sendLocationMessage,
  sendContactMessage
} from '../controllers/whatsapp.controller';
import { authenticate } from '../middleware/auth.middleware';

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueFilename = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueFilename);
  }
});

const upload = multer({ storage });

const router = express.Router();

// Test WhatsApp connection (no authentication required)
router.get('/test/:deviceId', testWhatsAppConnection as any);

// Apply authentication middleware to all other routes
router.use(authenticate as any);

// Legacy endpoint - Send a WhatsApp message
router.post('/send', sendWhatsAppMessage as any);

// Disconnect WhatsApp
router.post('/disconnect/:deviceId', disconnectWhatsApp as any);

// New API endpoints for different message types
router.post('/send-message', sendTextMessage as any);
router.post('/send-file', upload.single('file'), sendFileMessage as any);
router.post('/send-location', sendLocationMessage as any);
router.post('/send-contact', sendContactMessage as any);

export default router;
