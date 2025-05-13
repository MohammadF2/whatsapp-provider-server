import express from 'express';
import { checkIfBlocked } from '../controllers/contact.controller';
import { authenticate } from '../middleware/auth.middleware';

/**
 * @swagger
 * components:
 *   schemas:
 *     ContactBlockCheckResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           description: Indicates if the operation was successful
 *         isBlocked:
 *           type: boolean
 *           description: Indicates if the contact has blocked you
 *         reason:
 *           type: string
 *           description: Reason for the block status determination
 *         contact:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *               description: The contact's ID
 *             name:
 *               type: string
 *               description: The contact's name
 *             number:
 *               type: string
 *               description: The contact's phone number
 */

/**
 * @swagger
 * tags:
 *   name: Contacts
 *   description: Contact operations
 */

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticate as any);

/**
 * @swagger
 * /contacts/check-blocked/{deviceId}/{phoneNumber}:
 *   get:
 *     summary: Check if a contact has blocked you
 *     tags: [Contacts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: The device ID to use for checking
 *       - in: path
 *         name: phoneNumber
 *         required: true
 *         schema:
 *           type: string
 *         description: The phone number to check
 *     responses:
 *       200:
 *         description: Block check result
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ContactBlockCheckResponse'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Device or contact not found
 *       500:
 *         description: Server error
 */
router.get('/check-blocked/:deviceId/:phoneNumber', checkIfBlocked as any);

export default router;
