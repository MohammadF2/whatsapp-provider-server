import express from 'express';
import { getMessageHistory, getDeviceMessageHistory } from '../controllers/message-history.controller';
import { authenticate } from '../middleware/auth.middleware';

/**
 * @swagger
 * components:
 *   schemas:
 *     MessageHistory:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           description: The auto-generated ID of the message history entry
 *         deviceId:
 *           type: string
 *           description: The device ID that sent the message
 *         userId:
 *           type: string
 *           description: The user ID who owns the device
 *         deviceName:
 *           type: string
 *           description: The name of the device
 *         deviceNumber:
 *           type: string
 *           description: The WhatsApp number of the device
 *         recipient:
 *           type: string
 *           description: The recipient's phone number or chat ID
 *         message:
 *           type: string
 *           description: The message content
 *         messageType:
 *           type: string
 *           enum: [text, image, video, audio, document, location, contact, voice]
 *           description: The type of message
 *         status:
 *           type: string
 *           enum: [sent, failed, pending]
 *           description: The status of the message
 *         errorMessage:
 *           type: string
 *           description: Error message if the message failed
 *         messageId:
 *           type: string
 *           description: The WhatsApp message ID
 *         mediaUrl:
 *           type: string
 *           description: URL to the media file (for media messages)
 *         caption:
 *           type: string
 *           description: Caption for media messages
 *         metadata:
 *           type: object
 *           description: Additional metadata for the message
 *         timestamp:
 *           type: string
 *           format: date-time
 *           description: When the message was sent
 *       example:
 *         _id: "60d0fe4f5311236168a109ca"
 *         deviceId: "60d0fe4f5311236168a109cb"
 *         userId: "60d0fe4f5311236168a109cc"
 *         deviceName: "My WhatsApp Device"
 *         deviceNumber: "1234567890"
 *         recipient: "0987654321@c.us"
 *         message: "Hello, how are you?"
 *         messageType: "text"
 *         status: "sent"
 *         messageId: "ABCDEF1234567890"
 *         timestamp: "2023-06-21T12:00:00.000Z"
 */

/**
 * @swagger
 * tags:
 *   name: Message History
 *   description: Message history operations
 */

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticate as any);

/**
 * @swagger
 * /message-history:
 *   get:
 *     summary: Get message history with filtering options
 *     tags: [Message History]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: deviceId
 *         schema:
 *           type: string
 *         description: Filter by device ID
 *       - in: query
 *         name: recipient
 *         schema:
 *           type: string
 *         description: Filter by recipient phone number
 *       - in: query
 *         name: messageType
 *         schema:
 *           type: string
 *           enum: [text, image, video, audio, document, location, contact, voice]
 *         description: Filter by message type
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [sent, failed, pending]
 *         description: Filter by message status
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter messages from this date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter messages until this date
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of messages to return
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination
 *     responses:
 *       200:
 *         description: Message history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 messages:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/MessageHistory'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     total:
 *                       type: integer
 *                     pages:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/', getMessageHistory as any);

/**
 * @swagger
 * /message-history/device/{deviceId}:
 *   get:
 *     summary: Get message history for a specific device
 *     tags: [Message History]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: The device ID to get message history for
 *       - in: query
 *         name: recipient
 *         schema:
 *           type: string
 *         description: Filter by recipient phone number
 *       - in: query
 *         name: messageType
 *         schema:
 *           type: string
 *           enum: [text, image, video, audio, document, location, contact, voice]
 *         description: Filter by message type
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [sent, failed, pending]
 *         description: Filter by message status
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter messages from this date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter messages until this date
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of messages to return
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination
 *     responses:
 *       200:
 *         description: Device message history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 messages:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/MessageHistory'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     total:
 *                       type: integer
 *                     pages:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Device not found
 *       500:
 *         description: Server error
 */
router.get('/device/:deviceId', getDeviceMessageHistory as any);

export default router;
