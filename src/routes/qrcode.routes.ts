import express from 'express';
import { generateQRCode, checkQRCodeStatus } from '../controllers/qrcode.controller';
import { authenticate } from '../middleware/auth.middleware';

/**
 * @swagger
 * components:
 *   schemas:
 *     QRCodeResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           description: Indicates if the operation was successful
 *         qrCode:
 *           type: string
 *           description: Base64 encoded QR code image
 *         sessionId:
 *           type: string
 *           description: Unique session ID for this QR code request
 *         deviceId:
 *           type: string
 *           description: The device ID
 *         expiresIn:
 *           type: integer
 *           description: Number of seconds until the QR code expires
 *         message:
 *           type: string
 *           description: Additional information about the operation
 *     QRCodeStatusResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           description: Indicates if the operation was successful
 *         status:
 *           type: string
 *           enum: [connected, connecting, expired]
 *           description: The status of the QR code session
 *         message:
 *           type: string
 *           description: Additional information about the status
 */

/**
 * @swagger
 * tags:
 *   name: QRCode
 *   description: QR code operations for WhatsApp authentication
 */

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticate as any);

/**
 * @swagger
 * /qrcode/generate/{deviceId}:
 *   get:
 *     summary: Generate a QR code for WhatsApp authentication
 *     tags: [QRCode]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: The device ID to generate a QR code for
 *     responses:
 *       200:
 *         description: QR code generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/QRCodeResponse'
 *       400:
 *         description: Device is already connected
 *       404:
 *         description: Device not found
 *       408:
 *         description: QR code generation timed out
 *       500:
 *         description: Server error
 */
router.get('/generate/:deviceId', generateQRCode as any);

/**
 * @swagger
 * /qrcode/status/{deviceId}/{sessionId}:
 *   get:
 *     summary: Check the status of a QR code session
 *     tags: [QRCode]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: The device ID
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: The session ID returned when generating the QR code
 *     responses:
 *       200:
 *         description: QR code status checked successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/QRCodeStatusResponse'
 *       404:
 *         description: Device not found
 *       500:
 *         description: Server error
 */
router.get('/status/:deviceId/:sessionId', checkQRCodeStatus as any);

export default router;
