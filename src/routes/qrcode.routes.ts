import express from 'express';
import { generateQRCode, checkQRCodeStatus, cancelQRCodeSession, getHealth, getDetailedHealth, getMetrics } from '../controllers/qrcode.controller';
// import { debugActiveClients } from '../controllers/qrcode.controller'; // Temporarily disabled
// import { checkDeviceStatus } from '../controllers/qrcode.controller'; // Temporarily disabled
// import { testGenerateQRCode } from '../controllers/qrcode.controller'; // Temporarily disabled
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
 *           description: Base64 encoded QR code image (only present on success)
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
 *           description: Human-readable message about the operation
 *         error:
 *           type: string
 *           description: Error code for programmatic handling (only present on failure)
 *         retryAfter:
 *           type: integer
 *           description: Seconds to wait before retrying (only present when rate limited)
 *         remainingRequests:
 *           type: integer
 *           description: Number of remaining requests in current window (only present when rate limited)
 *         details:
 *           type: object
 *           description: Additional error details (only present on failure)
 *     QRCodeStatusResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           description: Indicates if the operation was successful
 *         status:
 *           type: string
 *           enum: [pending, generated, scanned, connected, expired, failed]
 *           description: The status of the QR code session (only present on success)
 *         message:
 *           type: string
 *           description: Human-readable message about the status
 *         sessionId:
 *           type: string
 *           description: The session ID
 *         deviceId:
 *           type: string
 *           description: The device ID
 *         timeRemaining:
 *           type: integer
 *           description: Number of seconds until the session expires
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: When the session was created
 *         lastUpdated:
 *           type: string
 *           format: date-time
 *           description: When the session was last updated
 *         error:
 *           type: string
 *           description: Error code for programmatic handling (only present on failure)
 *         retryAfter:
 *           type: integer
 *           description: Seconds to wait before retrying (only present when rate limited)
 *         remainingRequests:
 *           type: integer
 *           description: Number of remaining requests in current window (only present when rate limited)
 *         details:
 *           type: object
 *           description: Additional error details (only present on failure)
 *     QRCodeCancelResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           description: Indicates if the operation was successful
 *         message:
 *           type: string
 *           description: Human-readable message about the operation
 *         sessionId:
 *           type: string
 *           description: The cancelled session ID
 *         deviceId:
 *           type: string
 *           description: The device ID
 *         error:
 *           type: string
 *           description: Error code for programmatic handling (only present on failure)
 *         details:
 *           type: object
 *           description: Additional error details (only present on failure)
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
 *         description: Bad request (validation error, device already connected)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EnhancedErrorResponse'
 *       401:
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EnhancedErrorResponse'
 *       404:
 *         description: Device not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EnhancedErrorResponse'
 *       408:
 *         description: QR code generation timed out
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EnhancedErrorResponse'
 *       409:
 *         description: Conflict (device already connected, concurrent session)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EnhancedErrorResponse'
 *       429:
 *         $ref: '#/components/responses/RateLimitExceeded'
 *       500:
 *         description: Server error (client initialization failed)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EnhancedErrorResponse'
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
 *       400:
 *         description: Bad request (validation error)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EnhancedErrorResponse'
 *       401:
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EnhancedErrorResponse'
 *       403:
 *         description: Forbidden (session doesn't belong to user)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EnhancedErrorResponse'
 *       404:
 *         description: Device or session not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EnhancedErrorResponse'
 *       429:
 *         $ref: '#/components/responses/RateLimitExceeded'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EnhancedErrorResponse'
 */
router.get('/status/:deviceId/:sessionId', checkQRCodeStatus as any);

/**
 * @swagger
 * /qrcode/cancel/{deviceId}/{sessionId}:
 *   delete:
 *     summary: Cancel a QR code session
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
 *         description: The session ID to cancel
 *     responses:
 *       200:
 *         description: QR code session cancelled successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/QRCodeCancelResponse'
 *       400:
 *         description: Bad request (validation error)
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Forbidden (session doesn't belong to user)
 *       404:
 *         description: Device or session not found
 *       500:
 *         description: Server error
 */
router.delete('/cancel/:deviceId/:sessionId', cancelQRCodeSession as any);

/**
 * @swagger
 * /qrcode/health:
 *   get:
 *     summary: Get QR code system health status
 *     tags: [QRCode]
 *     responses:
 *       200:
 *         description: System is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: string
 *                   enum: [healthy, degraded, unhealthy, critical]
 *                   example: healthy
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       503:
 *         description: System is unhealthy
 *       429:
 *         description: Rate limit exceeded
 */
router.get('/health', getHealth as any);

/**
 * @swagger
 * /qrcode/health/detailed:
 *   get:
 *     summary: Get detailed QR code system health information
 *     tags: [QRCode]
 *     responses:
 *       200:
 *         description: Detailed system health information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 overall:
 *                   type: string
 *                   enum: [healthy, degraded, unhealthy, critical]
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 uptime:
 *                   type: number
 *                   description: System uptime in milliseconds
 *                 version:
 *                   type: string
 *                 checks:
 *                   type: object
 *                   additionalProperties:
 *                     type: object
 *                     properties:
 *                       status:
 *                         type: string
 *                         enum: [healthy, degraded, unhealthy, critical]
 *                       message:
 *                         type: string
 *                       timestamp:
 *                         type: string
 *                         format: date-time
 *                       duration:
 *                         type: number
 *       503:
 *         description: System is unhealthy
 *       429:
 *         description: Rate limit exceeded
 */
router.get('/health/detailed', getDetailedHealth as any);

/**
 * @swagger
 * /qrcode/metrics:
 *   get:
 *     summary: Get QR code system performance metrics
 *     tags: [QRCode]
 *     responses:
 *       200:
 *         description: Performance metrics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 summary:
 *                   type: object
 *                   properties:
 *                     totalOperations:
 *                       type: number
 *                     operationsWithAlerts:
 *                       type: number
 *                     overallSuccessRate:
 *                       type: number
 *                     averageResponseTime:
 *                       type: number
 *                     activeTimers:
 *                       type: number
 *                 metrics:
 *                   type: object
 *                   additionalProperties:
 *                     type: object
 *                     properties:
 *                       operation:
 *                         type: string
 *                       totalCount:
 *                         type: number
 *                       successCount:
 *                         type: number
 *                       failureCount:
 *                         type: number
 *                       successRate:
 *                         type: number
 *                       averageTime:
 *                         type: number
 *                       minTime:
 *                         type: number
 *                       maxTime:
 *                         type: number
 *                       p95Time:
 *                         type: number
 *                       p99Time:
 *                         type: number
 *                       lastExecutionTime:
 *                         type: string
 *                         format: date-time
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       429:
 *         description: Rate limit exceeded
 */
router.get('/metrics', getMetrics as any);

// Debug endpoint to check active clients
// router.get('/debug/active-clients', debugActiveClients); // Temporarily disabled

// Device status check endpoint
/**
 * @swagger
 * /api/qrcode/device/{deviceId}/status:
 *   get:
 *     summary: Check device connection status
 *     description: Check if a device is connected to WhatsApp and get session information
 *     tags: [QR Code]
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: Device ID to check status for
 *     responses:
 *       200:
 *         description: Device status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 deviceId:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum: [disconnected, connecting, connected]
 *                 activeSession:
 *                   type: object
 *                   nullable: true
 */
// router.get('/device/:deviceId/status', checkDeviceStatus); // Temporarily disabled

// Test endpoint without authentication (for testing only)
/**
 * @swagger
 * /api/qrcode/test/generate/{deviceId}:
 *   post:
 *     summary: Generate QR code for WhatsApp authentication (TEST - No Auth Required)
 *     description: Test endpoint that generates a real WhatsApp QR code without authentication
 *     tags: [QR Code]
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: Device ID for WhatsApp connection
 *     responses:
 *       200:
 *         description: QR code generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/QRCodeResponse'
 */
// router.post('/test/generate/:deviceId', testGenerateQRCode); // Temporarily disabled

export default router;