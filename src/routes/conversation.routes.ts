import express from 'express';
import {
  getConversations,
  getMessages,
  markAsRead
} from '../controllers/conversation.controller';
import { authenticate } from '../middleware/auth.middleware';

/**
 * @swagger
 * components:
 *   schemas:
 *     Conversation:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           description: The auto-generated ID of the conversation
 *         deviceId:
 *           type: string
 *           description: The device ID associated with this conversation
 *         chatId:
 *           type: string
 *           description: The WhatsApp chat ID
 *         name:
 *           type: string
 *           description: The name of the contact or group
 *         isGroup:
 *           type: boolean
 *           description: Whether this is a group conversation
 *         lastMessage:
 *           type: object
 *           properties:
 *             content:
 *               type: string
 *               description: The content of the last message
 *             timestamp:
 *               type: string
 *               format: date-time
 *               description: When the last message was sent
 *             fromMe:
 *               type: boolean
 *               description: Whether the last message was sent by the user
 *             sender:
 *               type: string
 *               description: The sender of the last message (for group chats)
 *         unreadCount:
 *           type: integer
 *           description: Number of unread messages
 *         profilePicUrl:
 *           type: string
 *           description: URL to the profile picture
 *         participants:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *               name:
 *                 type: string
 *               isAdmin:
 *                 type: boolean
 *           description: List of participants (for group chats)
 *         lastUpdated:
 *           type: string
 *           format: date-time
 *           description: When the conversation was last updated
 *       example:
 *         _id: "60d0fe4f5311236168a109ca"
 *         deviceId: "682238404114bbc39bef5198"
 *         chatId: "1234567890@c.us"
 *         name: "John Doe"
 *         isGroup: false
 *         lastMessage:
 *           content: "Hello, how are you?"
 *           timestamp: "2023-06-21T12:00:00.000Z"
 *           fromMe: false
 *         unreadCount: 2
 *         lastUpdated: "2023-06-21T12:00:00.000Z"
 *
 *     Message:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           description: The auto-generated ID of the message
 *         messageId:
 *           type: string
 *           description: The WhatsApp message ID
 *         deviceId:
 *           type: string
 *           description: The device ID associated with this message
 *         chatId:
 *           type: string
 *           description: The chat ID this message belongs to
 *         content:
 *           type: string
 *           description: The content of the message
 *         contentType:
 *           type: string
 *           enum: [text, image, video, audio, document, location, contact, sticker]
 *           description: The type of content
 *         timestamp:
 *           type: string
 *           format: date-time
 *           description: When the message was sent
 *         fromMe:
 *           type: boolean
 *           description: Whether the message was sent by the user
 *         sender:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *             name:
 *               type: string
 *             pushname:
 *               type: string
 *           description: Information about the sender
 *       example:
 *         _id: "60d0fe4f5311236168a109cb"
 *         messageId: "ABCDEF1234567890"
 *         deviceId: "682238404114bbc39bef5198"
 *         chatId: "1234567890@c.us"
 *         content: "Hello, how are you?"
 *         contentType: "text"
 *         timestamp: "2023-06-21T12:00:00.000Z"
 *         fromMe: false
 *         sender:
 *           id: "1234567890@c.us"
 *           name: "John Doe"
 */

/**
 * @swagger
 * tags:
 *   name: Conversations
 *   description: WhatsApp conversations and messages
 */

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticate as any);

/**
 * @swagger
 * /whatsapp/conversations/{deviceId}:
 *   get:
 *     summary: Get all conversations for a device
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: The device ID to get conversations for
 *       - in: query
 *         name: refresh
 *         schema:
 *           type: boolean
 *         description: Whether to refresh conversations from WhatsApp
 *     responses:
 *       200:
 *         description: List of conversations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 conversations:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Conversation'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Device not found
 *       500:
 *         description: Server error
 */
router.get('/conversations/:deviceId', getConversations as any);

/**
 * @swagger
 * /whatsapp/messages/{deviceId}/{chatId}:
 *   get:
 *     summary: Get messages for a specific conversation
 *     tags: [Conversations]
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
 *         name: chatId
 *         required: true
 *         schema:
 *           type: string
 *         description: The chat ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of messages to return
 *       - in: query
 *         name: before
 *         schema:
 *           type: string
 *         description: Message ID to get messages before
 *     responses:
 *       200:
 *         description: List of messages
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
 *                     $ref: '#/components/schemas/Message'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Device or conversation not found
 *       500:
 *         description: Server error
 */
router.get('/messages/:deviceId/:chatId', getMessages as any);

/**
 * @swagger
 * /whatsapp/read/{deviceId}/{chatId}:
 *   post:
 *     summary: Mark a conversation as read
 *     tags: [Conversations]
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
 *         name: chatId
 *         required: true
 *         schema:
 *           type: string
 *         description: The chat ID
 *     responses:
 *       200:
 *         description: Conversation marked as read
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
 *         description: Device or conversation not found
 *       500:
 *         description: Server error
 */
router.post('/read/:deviceId/:chatId', markAsRead as any);

export default router;
