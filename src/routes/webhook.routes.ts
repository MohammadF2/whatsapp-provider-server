import { Router } from 'express';
import { 
  configureWebhook, 
  getWebhookConfig, 
  deleteWebhook, 
  getWebhookDeliveries, 
  getWebhookStats, 
  testWebhook 
} from '../controllers/webhook.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// Apply authentication middleware to all webhook routes
router.use(authenticateToken);

/**
 * @swagger
 * components:
 *   schemas:
 *     WebhookConfig:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Webhook configuration ID
 *         deviceId:
 *           type: string
 *           description: Device ID
 *         webhookUrl:
 *           type: string
 *           description: Webhook endpoint URL
 *         isEnabled:
 *           type: boolean
 *           description: Whether webhook is enabled
 *         messageTypes:
 *           type: object
 *           properties:
 *             text:
 *               type: boolean
 *             image:
 *               type: boolean
 *             audio:
 *               type: boolean
 *             video:
 *               type: boolean
 *             document:
 *               type: boolean
 *             sticker:
 *               type: boolean
 *             location:
 *               type: boolean
 *             contact:
 *               type: boolean
 *             voice:
 *               type: boolean
 *         retryConfig:
 *           type: object
 *           properties:
 *             maxRetries:
 *               type: number
 *             retryDelay:
 *               type: number
 *             backoffMultiplier:
 *               type: number
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     
 *     WebhookPayload:
 *       type: object
 *       properties:
 *         messageId:
 *           type: string
 *           description: Unique message identifier
 *         timestamp:
 *           type: number
 *           description: Message timestamp in milliseconds
 *         deviceId:
 *           type: string
 *           description: Device ID that received the message
 *         sender:
 *           type: object
 *           properties:
 *             phoneNumber:
 *               type: string
 *             contactName:
 *               type: string
 *             isContact:
 *               type: boolean
 *         chat:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *             name:
 *               type: string
 *             isGroup:
 *               type: boolean
 *             participantCount:
 *               type: number
 *         messageType:
 *           type: string
 *           enum: [text, image, audio, video, document, sticker, location, contact, voice]
 *         content:
 *           type: object
 *           properties:
 *             text:
 *               type: string
 *             caption:
 *               type: string
 *             mediaUrl:
 *               type: string
 *             fileName:
 *               type: string
 *             fileSize:
 *               type: number
 *             mimeType:
 *               type: string
 *         metadata:
 *           type: object
 *           properties:
 *             hasMedia:
 *               type: boolean
 *             isForwarded:
 *               type: boolean
 *             isStarred:
 *               type: boolean
 */

/**
 * @swagger
 * /webhooks/device/{deviceId}/configure:
 *   post:
 *     summary: Configure webhook for a device
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: Device ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - webhookUrl
 *             properties:
 *               webhookUrl:
 *                 type: string
 *                 format: uri
 *                 description: Webhook endpoint URL
 *                 example: https://your-app.com/webhook/whatsapp
 *               isEnabled:
 *                 type: boolean
 *                 default: true
 *                 description: Enable/disable webhook
 *               authHeaders:
 *                 type: object
 *                 description: Authentication headers to send with webhook
 *                 example:
 *                   Authorization: "Bearer your-token"
 *                   X-API-Key: "your-api-key"
 *               messageTypes:
 *                 type: object
 *                 description: Message types to forward
 *                 properties:
 *                   text:
 *                     type: boolean
 *                     default: true
 *                   image:
 *                     type: boolean
 *                     default: true
 *                   audio:
 *                     type: boolean
 *                     default: true
 *                   video:
 *                     type: boolean
 *                     default: true
 *                   document:
 *                     type: boolean
 *                     default: true
 *                   sticker:
 *                     type: boolean
 *                     default: true
 *                   location:
 *                     type: boolean
 *                     default: true
 *                   contact:
 *                     type: boolean
 *                     default: true
 *                   voice:
 *                     type: boolean
 *                     default: true
 *               retryConfig:
 *                 type: object
 *                 description: Retry configuration for failed deliveries
 *                 properties:
 *                   maxRetries:
 *                     type: number
 *                     default: 3
 *                   retryDelay:
 *                     type: number
 *                     default: 1000
 *                     description: Initial retry delay in milliseconds
 *                   backoffMultiplier:
 *                     type: number
 *                     default: 2
 *                     description: Backoff multiplier for retry delays
 *     responses:
 *       200:
 *         description: Webhook configured successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 webhook:
 *                   $ref: '#/components/schemas/WebhookConfig'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Device not found
 *       500:
 *         description: Server error
 */
router.post('/device/:deviceId/configure', configureWebhook);

/**
 * @swagger
 * /webhooks/device/{deviceId}/config:
 *   get:
 *     summary: Get webhook configuration for a device
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: Device ID
 *     responses:
 *       200:
 *         description: Webhook configuration retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 webhook:
 *                   $ref: '#/components/schemas/WebhookConfig'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Device or webhook not found
 *       500:
 *         description: Server error
 */
router.get('/device/:deviceId/config', getWebhookConfig);

/**
 * @swagger
 * /webhooks/device/{deviceId}/config:
 *   delete:
 *     summary: Delete webhook configuration for a device
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: Device ID
 *     responses:
 *       200:
 *         description: Webhook configuration deleted successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Device or webhook not found
 *       500:
 *         description: Server error
 */
router.delete('/device/:deviceId/config', deleteWebhook);

/**
 * @swagger
 * /webhooks/device/{deviceId}/deliveries:
 *   get:
 *     summary: Get webhook delivery logs for a device
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: Device ID
 *       - in: query
 *         name: page
 *         schema:
 *           type: number
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: number
 *           default: 50
 *         description: Items per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, success, failed, retrying]
 *         description: Filter by delivery status
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter deliveries from this date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter deliveries until this date
 *     responses:
 *       200:
 *         description: Webhook deliveries retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Device not found
 *       500:
 *         description: Server error
 */
router.get('/device/:deviceId/deliveries', getWebhookDeliveries);

/**
 * @swagger
 * /webhooks/device/{deviceId}/stats:
 *   get:
 *     summary: Get webhook delivery statistics for a device
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: Device ID
 *       - in: query
 *         name: days
 *         schema:
 *           type: number
 *           default: 7
 *         description: Number of days to include in statistics
 *     responses:
 *       200:
 *         description: Webhook statistics retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Device not found
 *       500:
 *         description: Server error
 */
router.get('/device/:deviceId/stats', getWebhookStats);

/**
 * @swagger
 * /webhooks/device/{deviceId}/test:
 *   post:
 *     summary: Send a test webhook for a device
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: Device ID
 *     responses:
 *       200:
 *         description: Test webhook sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 testPayload:
 *                   $ref: '#/components/schemas/WebhookPayload'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Device or webhook not found
 *       500:
 *         description: Server error
 */
router.post('/device/:deviceId/test', testWebhook);

export default router;
