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
  sendContactMessage,
  sendPollMessage,
  getPollVotes,
  getProductInfo,
  getOrderInfo,
  sendButtonMessage,
  sendProductMessage,
  sendOrderMessage
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
 *               - content
 *             properties:
 *               deviceId:
 *                 type: string
 *                 description: The device ID to use for sending
 *               to:
 *                 type: string
 *                 description: The recipient's phone number or group ID
 *               content:
 *                 type: string
 *                 description: The text message content to send
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
 *               - type
 *               - file
 *             properties:
 *               deviceId:
 *                 type: string
 *                 description: The device ID to use for sending
 *               to:
 *                 type: string
 *                 description: The recipient's phone number or group ID
 *               type:
 *                 type: string
 *                 enum: [image, video, audio, document]
 *                 description: The type of file being sent
 *                 example: image
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
 *                   - phoneNumber
 *                 properties:
 *                   name:
 *                     type: string
 *                     description: The contact's name
 *                     example: "John Doe"
 *                   phoneNumber:
 *                     type: string
 *                     description: The contact's phone number
 *                     example: "+1234567890"
 *                   emails:
 *                     type: array
 *                     items:
 *                       type: string
 *                     description: Array of email addresses (optional)
 *                     example: ["john@example.com"]
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

/**
 * @swagger
 * /whatsapp/send-poll:
 *   post:
 *     summary: Send a poll message
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
 *               - pollName
 *               - pollOptions
 *             properties:
 *               deviceId:
 *                 type: string
 *                 description: The device ID to use for sending
 *               to:
 *                 type: string
 *                 description: The recipient's phone number or group ID
 *               pollName:
 *                 type: string
 *                 description: The name/question of the poll
 *                 example: "What's your favorite color?"
 *               pollOptions:
 *                 type: array
 *                 items:
 *                   type: string
 *                 minItems: 2
 *                 maxItems: 12
 *                 description: Array of poll options (2-12 options)
 *                 example: ["Red", "Blue", "Green", "Yellow"]
 *               allowMultipleAnswers:
 *                 type: boolean
 *                 default: false
 *                 description: Whether to allow multiple answers
 *               messageSecret:
 *                 type: array
 *                 items:
 *                   type: number
 *                 description: Custom message secret (32 numbers array)
 *     responses:
 *       200:
 *         description: Poll sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 messageId:
 *                   type: string
 *                 poll:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                     options:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                           localId:
 *                             type: number
 *                     allowMultipleAnswers:
 *                       type: boolean
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Device not found
 *       500:
 *         description: Server error
 */
router.post('/send-poll', sendPollMessage as any);

/**
 * @swagger
 * /whatsapp/poll-votes/{deviceId}/{messageId}:
 *   get:
 *     summary: Get poll votes for a specific poll message
 *     tags: [WhatsApp]
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
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *         description: The poll message ID
 *     responses:
 *       200:
 *         description: Poll votes retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 messageId:
 *                   type: string
 *                 votes:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       voter:
 *                         type: string
 *                         description: The person who voted
 *                       selectedOptions:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             id:
 *                               type: number
 *                             name:
 *                               type: string
 *                       interractedAtTs:
 *                         type: number
 *                         description: Timestamp when voted
 *       400:
 *         description: Invalid input or not a poll message
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Device or message not found
 *       500:
 *         description: Server error
 */
router.get('/poll-votes/:deviceId/:messageId', getPollVotes as any);

/**
 * @swagger
 * /whatsapp/product-info/{deviceId}/{messageId}:
 *   get:
 *     summary: Get product information from a product message
 *     tags: [WhatsApp]
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
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *         description: The product message ID
 *     responses:
 *       200:
 *         description: Product information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 messageId:
 *                   type: string
 *                 product:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       description: Product ID
 *                     name:
 *                       type: string
 *                       description: Product name
 *                     price:
 *                       type: string
 *                       description: Product price
 *                     currency:
 *                       type: string
 *                       description: Currency
 *                     quantity:
 *                       type: number
 *                       description: Product quantity
 *                     thumbnailUrl:
 *                       type: string
 *                       description: Product thumbnail URL
 *                     data:
 *                       type: object
 *                       description: Additional product data
 *       400:
 *         description: Invalid input or not a product message
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Device or message not found
 *       500:
 *         description: Server error
 */
router.get('/product-info/:deviceId/:messageId', getProductInfo as any);

/**
 * @swagger
 * /whatsapp/order-info/{deviceId}/{messageId}:
 *   get:
 *     summary: Get order information from an order message
 *     tags: [WhatsApp]
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
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *         description: The order message ID
 *     responses:
 *       200:
 *         description: Order information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 messageId:
 *                   type: string
 *                 order:
 *                   type: object
 *                   properties:
 *                     createdAt:
 *                       type: number
 *                       description: Order creation timestamp
 *                     currency:
 *                       type: string
 *                       description: Order currency
 *                     subtotal:
 *                       type: string
 *                       description: Order subtotal
 *                     total:
 *                       type: string
 *                       description: Order total
 *       400:
 *         description: Invalid input or not an order message
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Device or message not found
 *       500:
 *         description: Server error
 */
router.get('/order-info/:deviceId/:messageId', getOrderInfo as any);

/**
 * @swagger
 * /whatsapp/send-buttons:
 *   post:
 *     summary: Send a button message (DEPRECATED but may still work)
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
 *               - body
 *               - buttons
 *             properties:
 *               deviceId:
 *                 type: string
 *                 description: The device ID to use for sending
 *               to:
 *                 type: string
 *                 description: The recipient's phone number or group ID
 *               body:
 *                 type: string
 *                 description: The main message body
 *                 example: "Please choose an option:"
 *               buttons:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       description: Custom button ID (optional)
 *                       example: "btn_1"
 *                     body:
 *                       type: string
 *                       description: Button text
 *                       example: "Option 1"
 *                 minItems: 1
 *                 maxItems: 3
 *                 description: Array of buttons (1-3 buttons)
 *                 example: [{"id": "btn_1", "body": "Yes"}, {"id": "btn_2", "body": "No"}]
 *               title:
 *                 type: string
 *                 description: Optional title for the message
 *                 example: "Confirmation"
 *               footer:
 *                 type: string
 *                 description: Optional footer for the message
 *                 example: "Please select one option"
 *     responses:
 *       200:
 *         description: Button message sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 messageId:
 *                   type: string
 *                 buttons:
 *                   type: object
 *                   properties:
 *                     body:
 *                       type: string
 *                     buttons:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           body:
 *                             type: string
 *                     title:
 *                       type: string
 *                     footer:
 *                       type: string
 *                 note:
 *                   type: string
 *                   description: Deprecation notice
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Device not found
 *       500:
 *         description: Server error
 */
router.post('/send-buttons', sendButtonMessage as any);

/**
 * @swagger
 * /whatsapp/send-product:
 *   post:
 *     summary: Send a product message (Future feature - fallback to text)
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
 *               - productId
 *             properties:
 *               deviceId:
 *                 type: string
 *                 description: The device ID to use for sending
 *               to:
 *                 type: string
 *                 description: The recipient's phone number or group ID
 *               productId:
 *                 type: string
 *                 description: The product ID from your catalog
 *                 example: "product_123"
 *               businessOwnerJid:
 *                 type: string
 *                 description: Business owner JID (optional)
 *                 example: "business@c.us"
 *               catalogId:
 *                 type: string
 *                 description: Catalog ID (optional)
 *                 example: "catalog_456"
 *     responses:
 *       200:
 *         description: Product message sent successfully (as fallback text)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 messageId:
 *                   type: string
 *                 product:
 *                   type: object
 *                   properties:
 *                     productId:
 *                       type: string
 *                     businessOwnerJid:
 *                       type: string
 *                     catalogId:
 *                       type: string
 *                 note:
 *                   type: string
 *                   description: Feature availability notice
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Device not found
 *       500:
 *         description: Server error
 */
router.post('/send-product', sendProductMessage as any);

/**
 * @swagger
 * /whatsapp/send-order:
 *   post:
 *     summary: Send an order message (Future feature - fallback to text)
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
 *               - orderId
 *             properties:
 *               deviceId:
 *                 type: string
 *                 description: The device ID to use for sending
 *               to:
 *                 type: string
 *                 description: The recipient's phone number or group ID
 *               orderId:
 *                 type: string
 *                 description: The order ID
 *                 example: "order_789"
 *               thumbnail:
 *                 type: string
 *                 description: Order thumbnail URL (optional)
 *                 example: "https://example.com/order-thumb.jpg"
 *               itemCount:
 *                 type: number
 *                 description: Number of items in the order
 *                 example: 3
 *               priceAmount:
 *                 type: string
 *                 description: Total price amount
 *                 example: "99.99"
 *               priceCurrency:
 *                 type: string
 *                 description: Price currency
 *                 example: "USD"
 *               message:
 *                 type: string
 *                 description: Additional order message
 *                 example: "Your order has been confirmed!"
 *     responses:
 *       200:
 *         description: Order message sent successfully (as fallback text)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 messageId:
 *                   type: string
 *                 order:
 *                   type: object
 *                   properties:
 *                     orderId:
 *                       type: string
 *                     thumbnail:
 *                       type: string
 *                     itemCount:
 *                       type: number
 *                     priceAmount:
 *                       type: string
 *                     priceCurrency:
 *                       type: string
 *                     message:
 *                       type: string
 *                 note:
 *                   type: string
 *                   description: Feature availability notice
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Device not found
 *       500:
 *         description: Server error
 */
router.post('/send-order', sendOrderMessage as any);

export default router;
