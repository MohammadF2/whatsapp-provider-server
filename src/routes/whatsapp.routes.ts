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

/**
 * @swagger
 * components:
 *   schemas:
 *     MessageResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           description: Indicates if the operation was successful
 *         messageId:
 *           type: string
 *           description: The ID of the sent message
 *         message:
 *           type: string
 *           description: Additional information about the operation
 *       example:
 *         success: true
 *         messageId: "ABCDEF1234567890"
 *         message: "Message sent successfully"
 */

/**
 * @swagger
 * tags:
 *   name: WhatsApp
 *   description: WhatsApp messaging operations
 */

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

/**
 * @swagger
 * /whatsapp/test/{deviceId}:
 *   get:
 *     summary: Test WhatsApp connection
 *     tags: [WhatsApp]
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: The device ID to test connection
 *     responses:
 *       200:
 *         description: Connection test result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 connected:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       404:
 *         description: Device not found
 *       500:
 *         description: Server error
 */
router.get('/test/:deviceId', testWhatsAppConnection as any);

// Apply authentication middleware to all other routes
router.use(authenticate as any);

/**
 * @swagger
 * /whatsapp/send:
 *   post:
 *     summary: Send a WhatsApp message (Legacy endpoint)
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - deviceId
 *               - to
 *               - message
 *             properties:
 *               deviceId:
 *                 type: string
 *                 description: The device ID to use for sending
 *               to:
 *                 type: string
 *                 description: The recipient's phone number
 *               message:
 *                 type: string
 *                 description: The message to send
 *     responses:
 *       200:
 *         description: Message sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MessageResponse'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Device not found
 *       500:
 *         description: Server error
 */
router.post('/send', sendWhatsAppMessage as any);

/**
 * @swagger
 * /whatsapp/disconnect/{deviceId}:
 *   post:
 *     summary: Disconnect WhatsApp
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: The device ID to disconnect
 *     responses:
 *       200:
 *         description: Device disconnected successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Device not found
 *       500:
 *         description: Server error
 */
router.post('/disconnect/:deviceId', disconnectWhatsApp as any);

// New API endpoints for different message types

/**
 * @swagger
 * /whatsapp/send-message:
 *   post:
 *     summary: Send a text message
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - deviceId
 *               - to
 *               - message
 *             properties:
 *               deviceId:
 *                 type: string
 *                 description: The device ID to use for sending
 *               to:
 *                 type: string
 *                 description: The recipient's phone number or group ID
 *               message:
 *                 type: string
 *                 description: The message to send
 *     responses:
 *       200:
 *         description: Message sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MessageResponse'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Device not found
 *       500:
 *         description: Server error
 */
router.post('/send-message', sendTextMessage as any);

/**
 * @swagger
 * /whatsapp/send-file:
 *   post:
 *     summary: Send a file (image, document, video, audio)
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - deviceId
 *               - to
 *               - file
 *             properties:
 *               deviceId:
 *                 type: string
 *                 description: The device ID to use for sending
 *               to:
 *                 type: string
 *                 description: The recipient's phone number or group ID
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: The file to send
 *               caption:
 *                 type: string
 *                 description: Optional caption for the file
 *     responses:
 *       200:
 *         description: File sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MessageResponse'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Device not found
 *       500:
 *         description: Server error
 */
router.post('/send-file', upload.single('file'), sendFileMessage as any);

/**
 * @swagger
 * /whatsapp/send-location:
 *   post:
 *     summary: Send a location
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - deviceId
 *               - to
 *               - latitude
 *               - longitude
 *             properties:
 *               deviceId:
 *                 type: string
 *                 description: The device ID to use for sending
 *               to:
 *                 type: string
 *                 description: The recipient's phone number or group ID
 *               latitude:
 *                 type: number
 *                 description: The latitude coordinate
 *               longitude:
 *                 type: number
 *                 description: The longitude coordinate
 *               name:
 *                 type: string
 *                 description: Optional name for the location
 *               address:
 *                 type: string
 *                 description: Optional address for the location
 *     responses:
 *       200:
 *         description: Location sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MessageResponse'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Device not found
 *       500:
 *         description: Server error
 */
router.post('/send-location', sendLocationMessage as any);

/**
 * @swagger
 * /whatsapp/send-contact:
 *   post:
 *     summary: Send a contact
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - deviceId
 *               - to
 *               - contact
 *             properties:
 *               deviceId:
 *                 type: string
 *                 description: The device ID to use for sending
 *               to:
 *                 type: string
 *                 description: The recipient's phone number or group ID
 *               contact:
 *                 type: object
 *                 required:
 *                   - name
 *                   - phones
 *                 properties:
 *                   name:
 *                     type: string
 *                     description: The contact's name
 *                   phones:
 *                     type: array
 *                     items:
 *                       type: string
 *                     description: Array of phone numbers
 *                   emails:
 *                     type: array
 *                     items:
 *                       type: string
 *                     description: Array of email addresses
 *     responses:
 *       200:
 *         description: Contact sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MessageResponse'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Device not found
 *       500:
 *         description: Server error
 */
router.post('/send-contact', sendContactMessage as any);

export default router;
