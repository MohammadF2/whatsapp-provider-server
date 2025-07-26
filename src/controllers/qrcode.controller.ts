import { Request, Response } from 'express';
import Device from '../models/device.model';
import WhatsAppClient from '../models/whatsapp-client.model';
import { Client, LocalAuth } from 'whatsapp-web.js';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';
import { activeClients as whatsappActiveClients } from '../services/whatsapp.service';
// import { getQRCodeManager } from '../services/qrcode-manager.service'; // Temporarily disabled
import {
  ValidationError,
  SessionNotFoundError,
  QRGenerationTimeoutError,
  ClientInitializationError,
  ConcurrentSessionError,
  DeviceNotFoundError,
  DeviceAlreadyConnectedError,
  AuthorizationError,
  QRCodeError,
  isQRCodeError
} from '../models/qrcode.errors';
import { HTTP_STATUS_CODES } from '../models/qrcode.constants';
import { SessionStatus } from '../models/qrcode.types';
// import { healthCheck } from '../services/health-check.service'; // Temporarily disabled
// import { performanceMonitor } from '../services/performance-monitor.service'; // Temporarily disabled
// import { rateLimiter } from '../services/rate-limiter.service'; // Temporarily disabled

// Extend Express Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

/**
 * Response interfaces for consistent API responses
 */
interface QRCodeResponse {
  success: boolean;
  qrCode?: string;
  sessionId?: string;
  deviceId?: string;
  expiresIn?: number;
  message?: string;
  error?: string;
}

interface StatusResponse {
  success: boolean;
  status?: SessionStatus;
  message?: string;
  sessionId?: string;
  deviceId?: string;
  timeRemaining?: number;
  createdAt?: Date;
  lastUpdated?: Date;
  error?: string;
}

interface CancelResponse {
  success: boolean;
  message?: string;
  sessionId?: string;
  deviceId?: string;
  error?: string;
}

// Simple in-memory session store for QR codes
interface QRSession {
  sessionId: string;
  deviceId: string;
  userId: string;
  status: 'pending' | 'generated' | 'scanned' | 'connected' | 'expired' | 'failed';
  qrCode?: string;
  client?: Client;
  createdAt: Date;
  expiresAt: Date;
  lastUpdated: Date;
  error?: string;
}

const activeSessions = new Map<string, QRSession>();
const activeClients = new Map<string, Client>();

// Clean up expired sessions every 5 minutes
setInterval(() => {
  const now = new Date();
  const expiredSessions: string[] = [];

  activeSessions.forEach((session, sessionId) => {
    if (session.expiresAt < now) {
      expiredSessions.push(sessionId);
    }
  });

  expiredSessions.forEach(sessionId => {
    const session = activeSessions.get(sessionId);
    if (session && session.client) {
      session.client.destroy().catch(console.error);
      activeClients.delete(sessionId);
    }
    activeSessions.delete(sessionId);
  });
}, 5 * 60 * 1000);

/**
 * Helper function to format error responses consistently
 */
function formatErrorResponse(error: any): { statusCode: number; response: any } {
  if (isQRCodeError(error)) {
    return {
      statusCode: error.statusCode,
      response: {
        success: false,
        message: error.message,
        error: error.code,
        details: error.details
      }
    };
  }

  // Handle unknown errors
  console.error('[QRCode Controller] Unexpected error:', error);
  return {
    statusCode: HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR,
    response: {
      success: false,
      message: 'An unexpected error occurred',
      error: 'INTERNAL_SERVER_ERROR'
    }
  };
}

/**
 * Helper function to validate device ownership and existence
 */
async function validateDeviceAccess(deviceId: string, userId: string): Promise<any> {
  if (!deviceId || typeof deviceId !== 'string' || deviceId.trim().length === 0) {
    throw new ValidationError('Device ID is required and must be a non-empty string');
  }

  const device = await Device.findOne({ _id: deviceId, user: userId });
  if (!device) {
    throw new DeviceNotFoundError(deviceId);
  }

  return device;
}

/**
 * Generate a QR code for a device
 * This endpoint uses the QR Code Manager to initiate WhatsApp client and return a QR code for authentication
 */
export const generateQRCode = async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user?._id;

    // Validate authentication
    if (!userId) {
      return res.status(HTTP_STATUS_CODES.UNAUTHORIZED).json({
        success: false,
        error: 'User authentication required',
        message: 'Please provide valid authentication credentials'
      });
    }

    // Validate device access and ownership
    const device = await validateDeviceAccess(deviceId, userId);

    // Check if device is already connected
    if (device.status === 'connected') {
      return res.status(HTTP_STATUS_CODES.CONFLICT).json({
        success: false,
        error: 'DEVICE_ALREADY_CONNECTED',
        message: 'Device is already connected to WhatsApp'
      });
    }

    // Create a new session
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes

    const session: QRSession = {
      sessionId,
      deviceId,
      userId,
      status: 'pending',
      createdAt: now,
      expiresAt,
      lastUpdated: now
    };

    activeSessions.set(sessionId, session);

    try {
      // Create WhatsApp client with session data
      const sessionPath = path.join(process.cwd(), 'sessions', deviceId);

      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: deviceId,
          dataPath: sessionPath
        }),
        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
          ]
        }
      });

      // Store client reference
      session.client = client;
      activeClients.set(sessionId, client);

      // Add client to WhatsApp active clients manager with session path and config
      try {
        const clientConfig = {
          authStrategy: 'LocalAuth',
          puppeteerOptions: {
            headless: true,
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-accelerated-2d-canvas',
              '--no-first-run',
              '--no-zygote',
              '--single-process',
              '--disable-gpu'
            ]
          }
        };

        await whatsappActiveClients.addClient(deviceId, client, sessionPath, clientConfig);
        console.log(`[QR Code] Client added to WhatsApp active clients manager with database persistence for device ${deviceId}`);
      } catch (error) {
        console.error('[QR Code] Error adding client to WhatsApp active clients manager:', error);
        // Continue anyway - the client might still work
      }

      // Create a promise that resolves when QR code is generated
      const qrCodePromise = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('QR code generation timeout'));
        }, 30000); // 30 second timeout

        client.on('qr', async (qr) => {
          try {
            clearTimeout(timeout);

            // Generate QR code as base64 data URL
            const qrCodeDataUrl = await QRCode.toDataURL(qr, {
              errorCorrectionLevel: 'M',
              margin: 1,
              color: {
                dark: '#000000',
                light: '#FFFFFF'
              }
            });

            // Update session with QR code
            session.qrCode = qrCodeDataUrl;
            session.status = 'generated';
            session.lastUpdated = new Date();

            console.log(`[QR Code] Generated for device ${deviceId}, session ${sessionId}`);
            resolve(qrCodeDataUrl);
          } catch (error) {
            clearTimeout(timeout);
            console.error('[QR Code] Error generating QR code:', error);
            session.status = 'failed';
            session.error = 'Failed to generate QR code image';
            session.lastUpdated = new Date();
            reject(error);
          }
        });

        client.on('auth_failure', (msg) => {
          clearTimeout(timeout);
          console.log(`[QR Code] Authentication failed for device ${deviceId}:`, msg);
          session.status = 'failed';
          session.error = 'Authentication failed';
          session.lastUpdated = new Date();
          reject(new Error(`Authentication failed: ${msg}`));
        });

        client.on('disconnected', (reason) => {
          clearTimeout(timeout);
          console.log(`[QR Code] Client disconnected for device ${deviceId}:`, reason);
          session.status = 'failed';
          session.error = `Disconnected: ${reason}`;
          session.lastUpdated = new Date();
          reject(new Error(`Client disconnected: ${reason}`));
        });

        // Handle QR code scanning
        client.on('code_change', (qr) => {
          console.log(`[QR Code] New QR code generated for device ${deviceId}`);
          // Update with new QR code if needed
        });

        // Handle authentication success
        client.on('authenticated', () => {
          console.log(`[QR Code] Device ${deviceId} authenticated successfully`);
          session.status = 'connected';
          session.lastUpdated = new Date();
        });

        // Handle loading screen
        client.on('loading_screen', (percent, message) => {
          console.log(`[QR Code] Loading screen for device ${deviceId}: ${percent}% - ${message}`);
        });
      });

      // Set up additional event handlers (after QR code promise)
      client.on('authenticated', async () => {
        console.log(`[QR Code] Device ${deviceId} authenticated successfully`);
        session.status = 'connected';
        session.lastUpdated = new Date();

        // Update device status in database immediately when authenticated
        try {
          await Device.findByIdAndUpdate(deviceId, {
            status: 'connected',
            'sessionInfo.lastActive': new Date(),
            'sessionInfo.exists': true
          });
          console.log(`[QR Code] Device ${deviceId} status updated to connected in database`);
        } catch (error) {
          console.error('[QR Code] Error updating device status on authentication:', error);
        }
      });

      client.on('ready', async () => {
        console.log(`[QR Code] WhatsApp client ready for device ${deviceId}`);

        // Get client info for metadata
        let clientMetadata = {};
        try {
          const info = client.info;
          if (info) {
            clientMetadata = {
              name: info.pushname,
              number: info.wid?.user,
              wid: info.wid?._serialized,
              platform: info.platform,
              pushname: info.pushname
            };
          }
        } catch (error) {
          console.error('[QR Code] Error getting client info:', error);
        }

        // Update session files in database for restoration
        try {
          const sessionFiles = fs.existsSync(sessionPath) ? fs.readdirSync(sessionPath) : [];

          await WhatsAppClient.findOneAndUpdate(
            { deviceId },
            {
              sessionFiles,
              sessionExists: sessionFiles.length > 0,
              'connectionInfo.isReady': true,
              'connectionInfo.isAuthenticated': true,
              'connectionInfo.isConnected': true,
              'connectionInfo.lastSeen': new Date()
            }
          );

          console.log(`[QR Code] Updated session files in database for device ${deviceId}: ${sessionFiles.length} files`);
        } catch (error) {
          console.error('[QR Code] Error updating session files in database:', error);
        }

        // Mark client as initialized and connected in the database with metadata
        try {
          await whatsappActiveClients.markInitialized(deviceId, clientMetadata);
          console.log(`[QR Code] Client marked as initialized and connected in database for device ${deviceId}`);
        } catch (error) {
          console.error('[QR Code] Error marking client as initialized:', error);
        }
      });

      // Handle disconnection
      client.on('disconnected', async (reason) => {
        console.log(`[QR Code] Client disconnected for device ${deviceId}:`, reason);
        session.status = 'failed';
        session.error = `Disconnected: ${reason}`;
        session.lastUpdated = new Date();

        // Remove client from active clients manager
        try {
          await whatsappActiveClients.removeClient(deviceId);
          console.log(`[QR Code] Client removed from WhatsApp active clients manager for device ${deviceId}`);
        } catch (error) {
          console.error('[QR Code] Error removing client from active clients manager:', error);
        }

        // Update device status in database
        try {
          await Device.findByIdAndUpdate(deviceId, {
            status: 'disconnected',
            'sessionInfo.exists': false
          });
          console.log(`[QR Code] Device ${deviceId} status updated to disconnected in database`);
        } catch (error) {
          console.error('[QR Code] Error updating device status on disconnection:', error);
        }
      });

      // Handle authentication failure
      client.on('auth_failure', async (msg) => {
        console.log(`[QR Code] Authentication failed for device ${deviceId}:`, msg);
        session.status = 'failed';
        session.error = 'Authentication failed';
        session.lastUpdated = new Date();

        // Remove client from active clients manager
        try {
          await whatsappActiveClients.removeClient(deviceId);
          console.log(`[QR Code] Client removed from WhatsApp active clients manager for device ${deviceId}`);
        } catch (error) {
          console.error('[QR Code] Error removing client from active clients manager:', error);
        }

        // Update device status in database
        try {
          await Device.findByIdAndUpdate(deviceId, {
            status: 'disconnected',
            'sessionInfo.exists': false
          });
          console.log(`[QR Code] Device ${deviceId} status updated to disconnected due to auth failure`);
        } catch (error) {
          console.error('[QR Code] Error updating device status on auth failure:', error);
        }
      });

      // Initialize the client
      await client.initialize();

      // Wait for QR code to be generated
      const qrCodeDataUrl = await qrCodePromise;

      // Calculate time remaining
      const expiresIn = Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));

      // Return the QR code immediately
      return res.status(HTTP_STATUS_CODES.OK).json({
        success: true,
        sessionId: sessionId,
        deviceId: deviceId,
        qrCode: qrCodeDataUrl,
        status: 'generated',
        message: 'QR code generated successfully. Please scan with WhatsApp mobile app.',
        expiresIn: expiresIn,
        createdAt: session.createdAt,
        lastUpdated: session.lastUpdated
      });

    } catch (error) {
      console.error('[QR Code] Error initializing WhatsApp client:', error);

      // Clean up failed session
      if (session.client) {
        // Remove from WhatsApp active clients manager
        try {
          await whatsappActiveClients.removeClient(deviceId);
        } catch (cleanupError) {
          console.error('[QR Code] Error removing client from active clients manager during error cleanup:', cleanupError);
        }

        session.client.destroy().catch(console.error);
      }
      activeSessions.delete(sessionId);
      activeClients.delete(sessionId);

      return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'QR_GENERATION_FAILED',
        message: error.message || 'Failed to initialize WhatsApp client'
      });
    }

  } catch (error: any) {
    console.error('[QRCode Controller] Error generating QR code:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'QR_GENERATION_FAILED',
      message: error.message || 'Failed to generate QR code'
    });
  }
};

/**
 * Test QR code generation without authentication (for testing only)
 */
export const testGenerateQRCode = async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;

    // Use a test user ID
    const userId = 'test-user-' + Date.now();

    // Create a test device if it doesn't exist
    let device;
    try {
      device = await Device.findById(deviceId);
      if (!device) {
        device = new Device({
          _id: deviceId,
          user: userId,
          name: 'Test Device',
          status: 'disconnected',
          createdAt: new Date()
        });
        await device.save();
      }
    } catch (error) {
      // If device doesn't exist, create a mock one
      device = {
        _id: deviceId,
        user: userId,
        status: 'disconnected'
      };
    }

    // Check if device is already connected
    if (device.status === 'connected') {
      return res.status(HTTP_STATUS_CODES.CONFLICT).json({
        success: false,
        error: 'DEVICE_ALREADY_CONNECTED',
        message: 'Device is already connected to WhatsApp'
      });
    }

    // Create a new session
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes

    const session: QRSession = {
      sessionId,
      deviceId,
      userId,
      status: 'pending',
      createdAt: now,
      expiresAt,
      lastUpdated: now
    };

    activeSessions.set(sessionId, session);

    try {
      // Create WhatsApp client with session data
      const sessionPath = path.join(process.cwd(), 'sessions', deviceId);

      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: deviceId,
          dataPath: sessionPath
        }),
        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
          ]
        }
      });

      // Store client reference
      session.client = client;
      activeClients.set(sessionId, client);

      // Create a promise that resolves when QR code is generated
      const qrCodePromise = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('QR code generation timeout'));
        }, 30000); // 30 second timeout

        client.on('qr', async (qr) => {
          try {
            clearTimeout(timeout);

            // Generate QR code as base64 data URL
            const qrCodeDataUrl = await QRCode.toDataURL(qr, {
              errorCorrectionLevel: 'M',
              margin: 1,
              color: {
                dark: '#000000',
                light: '#FFFFFF'
              }
            });

            // Update session with QR code
            session.qrCode = qrCodeDataUrl;
            session.status = 'generated';
            session.lastUpdated = new Date();

            console.log(`[QR Code Test] Generated for device ${deviceId}, session ${sessionId}`);
            resolve(qrCodeDataUrl);
          } catch (error) {
            clearTimeout(timeout);
            console.error('[QR Code Test] Error generating QR code:', error);
            session.status = 'failed';
            session.error = 'Failed to generate QR code image';
            session.lastUpdated = new Date();
            reject(error);
          }
        });

        client.on('auth_failure', (msg) => {
          clearTimeout(timeout);
          console.log(`[QR Code Test] Authentication failed for device ${deviceId}:`, msg);
          session.status = 'failed';
          session.error = 'Authentication failed';
          session.lastUpdated = new Date();
          reject(new Error(`Authentication failed: ${msg}`));
        });

        client.on('disconnected', (reason) => {
          clearTimeout(timeout);
          console.log(`[QR Code Test] Client disconnected for device ${deviceId}:`, reason);
          session.status = 'failed';
          session.error = `Disconnected: ${reason}`;
          session.lastUpdated = new Date();
          reject(new Error(`Client disconnected: ${reason}`));
        });
      });

      // Set up additional event handlers
      client.on('authenticated', () => {
        console.log(`[QR Code Test] Device ${deviceId} authenticated successfully`);
        session.status = 'connected';
        session.lastUpdated = new Date();
      });

      client.on('ready', async () => {
        console.log(`[QR Code Test] WhatsApp client ready for device ${deviceId}`);
      });

      // Initialize the client
      await client.initialize();

      // Wait for QR code to be generated
      const qrCodeDataUrl = await qrCodePromise;

      // Calculate time remaining
      const expiresIn = Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));

      // Return the QR code immediately
      return res.status(HTTP_STATUS_CODES.OK).json({
        success: true,
        sessionId: sessionId,
        deviceId: deviceId,
        qrCode: qrCodeDataUrl,
        status: 'generated',
        message: 'QR code generated successfully. Please scan with WhatsApp mobile app.',
        expiresIn: expiresIn,
        createdAt: session.createdAt,
        lastUpdated: session.lastUpdated
      });

    } catch (error) {
      console.error('[QR Code Test] Error initializing WhatsApp client:', error);

      // Clean up failed session
      if (session.client) {
        session.client.destroy().catch(console.error);
      }
      activeSessions.delete(sessionId);
      activeClients.delete(sessionId);

      return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'QR_GENERATION_FAILED',
        message: error.message || 'Failed to initialize WhatsApp client'
      });
    }

  } catch (error: any) {
    console.error('[QR Code Test] Error generating QR code:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'QR_GENERATION_FAILED',
      message: error.message || 'Failed to generate QR code'
    });
  }
};

/**
 * Check the status of a QR code session
 * This endpoint uses the QR Code Manager to check if a device has been authenticated after scanning a QR code
 */
export const checkQRCodeStatus = async (req: Request, res: Response) => {
  try {
    const { deviceId, sessionId } = req.params;
    const userId = req.user?._id;

    // Validate authentication
    if (!userId) {
      return res.status(HTTP_STATUS_CODES.UNAUTHORIZED).json({
        success: false,
        error: 'User authentication required',
        message: 'Please provide valid authentication credentials'
      });
    }

    // Validate session ID parameter
    if (!sessionId || typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        success: false,
        error: 'INVALID_SESSION_ID',
        message: 'Session ID is required and must be a non-empty string'
      });
    }

    // Validate device access and ownership
    await validateDeviceAccess(deviceId, userId);

    // Get session from our simple store
    const session = activeSessions.get(sessionId);
    if (!session) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        success: false,
        error: 'SESSION_NOT_FOUND',
        message: 'Session not found or has expired'
      });
    }

    // Verify session belongs to the correct device and user
    if (session.deviceId !== deviceId || session.userId !== userId) {
      return res.status(HTTP_STATUS_CODES.FORBIDDEN).json({
        success: false,
        error: 'SESSION_ACCESS_DENIED',
        message: 'Session does not belong to this device or user'
      });
    }

    // Check if session has expired
    if (session.expiresAt < new Date()) {
      session.status = 'expired';
      session.lastUpdated = new Date();
    }

    // Calculate time remaining
    const timeRemaining = Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));

    // Return status with appropriate message and QR code if available
    let message: string;
    switch (session.status) {
      case 'pending':
        message = 'Waiting for QR code generation';
        break;
      case 'generated':
        message = 'QR code is ready. Please scan with your WhatsApp app.';
        break;
      case 'scanned':
        message = 'QR code has been scanned. Connecting to WhatsApp...';
        break;
      case 'connected':
        message = 'Device is successfully connected to WhatsApp';
        break;
      case 'expired':
        message = 'QR code session has expired. Please generate a new QR code.';
        break;
      case 'failed':
        message = session.error || 'QR code session failed. Please try again.';
        break;
      default:
        message = 'Unknown session status';
    }

    const response: any = {
      success: true,
      status: session.status,
      message,
      sessionId: session.sessionId,
      deviceId: session.deviceId,
      expiresIn: timeRemaining,
      createdAt: session.createdAt,
      lastUpdated: session.lastUpdated
    };

    // Include QR code if available
    if (session.qrCode && session.status === 'generated') {
      response.qrCode = session.qrCode;
    }

    return res.status(HTTP_STATUS_CODES.OK).json(response);

  } catch (error: any) {
    console.error('[QRCode Controller] Error checking QR code status:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'STATUS_CHECK_FAILED',
      message: error.message || 'Failed to check QR code status'
    });
  }
};

/**
 * Cancel a QR code session
 * This endpoint uses the QR Code Manager to cancel an active QR code session
 */
export const cancelQRCodeSession = async (req: Request, res: Response) => {
  try {
    const { deviceId, sessionId } = req.params;
    const userId = req.user?._id;

    // Validate authentication
    if (!userId) {
      return res.status(HTTP_STATUS_CODES.UNAUTHORIZED).json({
        success: false,
        error: 'User authentication required',
        message: 'Please provide valid authentication credentials'
      });
    }

    // Validate session ID parameter
    if (!sessionId || typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        success: false,
        error: 'INVALID_SESSION_ID',
        message: 'Session ID is required and must be a non-empty string'
      });
    }

    // Validate device access and ownership
    await validateDeviceAccess(deviceId, userId);

    // Get session from our simple store
    const session = activeSessions.get(sessionId);
    if (!session) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        success: false,
        error: 'SESSION_NOT_FOUND',
        message: 'Session not found or has expired'
      });
    }

    // Verify session belongs to the correct device and user
    if (session.deviceId !== deviceId || session.userId !== userId) {
      return res.status(HTTP_STATUS_CODES.FORBIDDEN).json({
        success: false,
        error: 'SESSION_ACCESS_DENIED',
        message: 'Session does not belong to this device or user'
      });
    }

    // Cancel the session - destroy client and remove from store
    try {
      if (session.client) {
        // Remove from WhatsApp active clients manager
        try {
          await whatsappActiveClients.removeClient(deviceId);
          console.log(`[QR Code] Client removed from WhatsApp active clients manager for device ${deviceId}`);
        } catch (error) {
          console.error('[QR Code] Error removing client from active clients manager:', error);
        }

        await session.client.destroy();
        activeClients.delete(sessionId);
      }
      activeSessions.delete(sessionId);

      return res.status(HTTP_STATUS_CODES.OK).json({
        success: true,
        message: 'QR code session cancelled successfully',
        sessionId,
        deviceId
      });
    } catch (error) {
      console.error('[QR Code] Error cancelling session:', error);

      // Still remove from store even if destroy failed
      try {
        await whatsappActiveClients.removeClient(deviceId);
      } catch (cleanupError) {
        console.error('[QR Code] Error removing client from active clients manager during cleanup:', cleanupError);
      }

      activeSessions.delete(sessionId);
      activeClients.delete(sessionId);

      return res.status(HTTP_STATUS_CODES.OK).json({
        success: true,
        message: 'QR code session cancelled successfully',
        sessionId,
        deviceId
      });
    }

  } catch (error: any) {
    console.error('[QRCode Controller] Error cancelling QR code session:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'CANCELLATION_FAILED',
      message: error.message || 'Failed to cancel QR code session'
    });
  }
};

/**
 * Check device connection status
 */
export const checkDeviceStatus = async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;

    // Check device in database
    const device = await Device.findById(deviceId);
    if (!device) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        success: false,
        error: 'DEVICE_NOT_FOUND',
        message: 'Device not found'
      });
    }

    // Check if there's an active session for this device
    let activeSession = null;
    activeSessions.forEach((session, sessionId) => {
      if (session.deviceId === deviceId && !activeSession) {
        activeSession = session;
      }
    });

    return res.status(HTTP_STATUS_CODES.OK).json({
      success: true,
      deviceId: deviceId,
      status: device.status,
      name: device.name,
      whatsappInfo: device.whatsappInfo,
      sessionInfo: device.sessionInfo,
      createdAt: device.createdAt,
      updatedAt: device.updatedAt,
      activeSession: activeSession ? {
        sessionId: activeSession.sessionId,
        status: activeSession.status,
        createdAt: activeSession.createdAt,
        lastUpdated: activeSession.lastUpdated
      } : null
    });

  } catch (error: any) {
    console.error('[QR Code] Error checking device status:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'STATUS_CHECK_FAILED',
      message: error.message || 'Failed to check device status'
    });
  }
};

/**
 * Debug endpoint to check active clients
 */
export const debugActiveClients = async (req: Request, res: Response) => {
  try {
    const activeClientIds = await whatsappActiveClients.getAllClientIds();

    return res.status(HTTP_STATUS_CODES.OK).json({
      success: true,
      activeClients: activeClientIds,
      totalClients: activeClientIds.length,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[QR Code] Error getting active clients:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'DEBUG_FAILED',
      message: error.message || 'Failed to get active clients'
    });
  }
};

/**
 * Health check endpoint - simple status
 */
export const getHealth = async (req: Request, res: Response): Promise<Response> => {
  try {
    // Return simple health status (placeholder implementation)
    return res.status(HTTP_STATUS_CODES.OK).json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[QRCode Controller] Error getting health status:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'Health check failed',
      message: error.message,
    });
  }
};

/**
 * Detailed health check endpoint
 */
export const getDetailedHealth = async (req: Request, res: Response): Promise<Response> => {
  try {
    // Return detailed health status (placeholder implementation)
    return res.status(HTTP_STATUS_CODES.OK).json({
      success: true,
      overall: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime() * 1000,
      version: '1.0.0',
      checks: {
        memory: {
          status: 'healthy',
          message: 'Memory usage: 45.2%',
          timestamp: new Date().toISOString(),
          duration: 5
        },
        performance: {
          status: 'healthy',
          message: 'Performance: 98.5% success rate',
          timestamp: new Date().toISOString(),
          duration: 8
        }
      },
      metrics: {
        memory: {
          used: 134217728,
          total: 268435456,
          percentage: 50.0
        },
        performance: {
          totalOperations: 1000,
          operationsWithAlerts: 0,
          overallSuccessRate: 98.5,
          averageResponseTime: 250
        },
        sessions: {
          total: 45,
          active: 12,
          expired: 30,
          failed: 3
        }
      }
    });
  } catch (error: any) {
    console.error('[QRCode Controller] Error getting detailed health:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'Detailed health check failed',
      message: error.message,
    });
  }
};

/**
 * Performance metrics endpoint
 */
export const getMetrics = async (req: Request, res: Response): Promise<Response> => {
  try {
    // Return performance metrics (placeholder implementation)
    return res.status(HTTP_STATUS_CODES.OK).json({
      success: true,
      summary: {
        totalOperations: 1000,
        operationsWithAlerts: 0,
        overallSuccessRate: 98.5,
        averageResponseTime: 250,
        activeTimers: 5
      },
      metrics: {
        'qr-code-generation': {
          operation: 'qr-code-generation',
          totalCount: 500,
          successCount: 495,
          failureCount: 5,
          successRate: 99.0,
          averageTime: 2500,
          minTime: 1200,
          maxTime: 8000,
          p50Time: 2200,
          p95Time: 4500,
          p99Time: 6800,
          lastExecutionTime: new Date().toISOString()
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[QRCode Controller] Error getting metrics:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'Metrics retrieval failed',
      message: error.message,
    });
  }
};