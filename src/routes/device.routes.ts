import express from 'express';
import {
  createDevice,
  getDevices,
  getDeviceById,
  updateDevice,
  deleteDevice
} from '../controllers/device.controller';
import { authenticate } from '../middleware/auth.middleware';

/**
 * @swagger
 * components:
 *   schemas:
 *     Device:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           description: The auto-generated ID of the device
 *         name:
 *           type: string
 *           description: The name of the device
 *         user:
 *           type: string
 *           description: The user ID who owns this device
 *         status:
 *           type: string
 *           enum: [disconnected, connecting, connected]
 *           description: The connection status of the device
 *         whatsappInfo:
 *           type: object
 *           properties:
 *             name:
 *               type: string
 *               description: WhatsApp account name
 *             number:
 *               type: string
 *               description: WhatsApp phone number
 *             profilePicUrl:
 *               type: string
 *               description: Profile picture URL
 *           description: WhatsApp account information
 *         sessionInfo:
 *           type: object
 *           properties:
 *             exists:
 *               type: boolean
 *               description: Whether a session exists
 *             lastActive:
 *               type: string
 *               format: date-time
 *               description: Last activity timestamp
 *             lastReconnect:
 *               type: string
 *               format: date-time
 *               description: Last reconnection timestamp
 *           description: Session information
 *         seleniumConfig:
 *           type: object
 *           properties:
 *             browserType:
 *               type: string
 *               enum: [chrome, firefox]
 *               description: Browser type for Selenium
 *             headless:
 *               type: boolean
 *               description: Whether to run browser in headless mode
 *             userAgent:
 *               type: string
 *               description: Custom user agent string
 *             autoConnect:
 *               type: boolean
 *               description: Whether to auto-connect on startup
 *             lastDriverInitialization:
 *               type: string
 *               format: date-time
 *               description: Last driver initialization timestamp
 *           description: Selenium configuration
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Device creation timestamp
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: Device last update timestamp
 *       example:
 *         _id: "60d0fe4f5311236168a109ca"
 *         name: "My WhatsApp Device"
 *         user: "60d0fe4f5311236168a109cb"
 *         status: "connected"
 *         whatsappInfo:
 *           name: "John Doe"
 *           number: "1234567890"
 *           profilePicUrl: "https://example.com/profile.jpg"
 *         sessionInfo:
 *           exists: true
 *           lastActive: "2023-06-21T12:00:00.000Z"
 *           lastReconnect: "2023-06-21T11:00:00.000Z"
 *         seleniumConfig:
 *           browserType: "chrome"
 *           headless: true
 *           autoConnect: true
 *         createdAt: "2023-06-21T10:00:00.000Z"
 *         updatedAt: "2023-06-21T12:00:00.000Z"
 *
 *     DeviceInput:
 *       type: object
 *       required:
 *         - name
 *       properties:
 *         name:
 *           type: string
 *           description: The name of the device
 *         seleniumConfig:
 *           type: object
 *           properties:
 *             browserType:
 *               type: string
 *               enum: [chrome, firefox]
 *               default: chrome
 *               description: Browser type for Selenium
 *             headless:
 *               type: boolean
 *               default: false
 *               description: Whether to run browser in headless mode
 *             userAgent:
 *               type: string
 *               description: Custom user agent string
 *             autoConnect:
 *               type: boolean
 *               default: true
 *               description: Whether to auto-connect on startup
 *           description: Optional Selenium configuration
 *       example:
 *         name: "My WhatsApp Device"
 *         seleniumConfig:
 *           browserType: "chrome"
 *           headless: true
 *           autoConnect: true
 */

/**
 * @swagger
 * tags:
 *   name: Devices
 *   description: Device management operations
 */

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticate as any);

/**
 * @swagger
 * /devices:
 *   post:
 *     summary: Create a new device
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DeviceInput'
 *     responses:
 *       201:
 *         description: Device created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 device:
 *                   $ref: '#/components/schemas/Device'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/', createDevice as any);

/**
 * @swagger
 * /devices:
 *   get:
 *     summary: Get all devices for the authenticated user
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of devices
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 devices:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Device'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/', getDevices as any);

/**
 * @swagger
 * /devices/{id}:
 *   get:
 *     summary: Get a single device by ID
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The device ID
 *     responses:
 *       200:
 *         description: Device details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 device:
 *                   $ref: '#/components/schemas/Device'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Device not found
 *       500:
 *         description: Server error
 */
router.get('/:id', getDeviceById as any);

/**
 * @swagger
 * /devices/{id}:
 *   put:
 *     summary: Update a device
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The device ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DeviceInput'
 *     responses:
 *       200:
 *         description: Device updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 device:
 *                   $ref: '#/components/schemas/Device'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Device not found
 *       500:
 *         description: Server error
 */
router.put('/:id', updateDevice as any);

/**
 * @swagger
 * /devices/{id}:
 *   delete:
 *     summary: Delete a device
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The device ID
 *     responses:
 *       200:
 *         description: Device deleted successfully
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
router.delete('/:id', deleteDevice as any);

export default router;
