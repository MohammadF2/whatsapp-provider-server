import express, { Request, Response } from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import authRoutes from './routes/auth.routes';
import deviceRoutes from './routes/device.routes';
import whatsappRoutes from './routes/whatsapp.routes';
import conversationRoutes from './routes/conversation.routes';
// import webhookRoutes from './routes/webhook.routes';
// import webhookSimpleRoutes from './routes/webhook-simple.routes';
// import WebhookService from './services/webhook.service';
import messageHistoryRoutes from './routes/message-history.routes';
import contactRoutes from './routes/contact.routes';
import qrcodeRoutes from './routes/qrcode.routes';
import proxyRoutes from './routes/proxy.routes';
import { setupSocketHandlers } from './socket';
import { restoreActiveClients } from './services/whatsapp.service';
import swaggerSpec from './config/swagger';
import { initializeShutdownManager } from './services/shutdown-manager.service';
import WebhookManager from './services/webhook-manager.service';
import { getProxyMonitoringService, destroyProxyMonitoringService } from './services/proxy-monitoring.service';
import { getDecodoProxyService, destroyDecodoProxyService } from './services/decodo-proxy.service';
import { getMessageQueueService, destroyMessageQueueService } from './services/message-queue.service';
import { isDecodoEnabled, isMessageQueueEnabled, isMonitoringEnabled } from './config/proxy.config';

// Import webhook endpoints (JavaScript to avoid TypeScript issues)
const { setupWebhookEndpoints, processIncomingMessage } = require('./webhook-endpoints.js');

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:4200',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:4200',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files for webhook media
app.use('/uploads', express.static('uploads'));

// Swagger API Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  explorer: true,
  customCss: '.swagger-ui .topbar { display: none }',
  swaggerOptions: {
    docExpansion: 'none',
    persistAuthorization: true,
  },
}));

/**
 * @swagger
 * /:
 *   get:
 *     summary: API Health Check and Information
 *     tags: [System]
 *     responses:
 *       200:
 *         description: API is running successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "online"
 *                 message:
 *                   type: string
 *                   example: "WhatsApp API Provider is running"
 *                 version:
 *                   type: string
 *                   example: "1.0.0"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 endpoints:
 *                   type: object
 *                   properties:
 *                     auth:
 *                       type: string
 *                       example: "/api/auth"
 *                     devices:
 *                       type: string
 *                       example: "/api/devices"
 *                     whatsapp:
 *                       type: string
 *                       example: "/api/whatsapp"
 *                     messageHistory:
 *                       type: string
 *                       example: "/api/message-history"
 *                     contacts:
 *                       type: string
 *                       example: "/api/contacts"
 *                     qrcode:
 *                       type: string
 *                       example: "/api/qrcode"
 *                     documentation:
 *                       type: string
 *                       example: "/api-docs"
 */

// API Health Check endpoint
app.get('/api', (req, res) => {
  res.json({
    status: 'online',
    message: 'WhatsApp API Provider is running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: '/api/auth',
      devices: '/api/devices',
      whatsapp: '/api/whatsapp',
      messageHistory: '/api/message-history',
      contacts: '/api/contacts',
      qrcode: '/api/qrcode',
      documentation: '/api-docs'
    }
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/whatsapp', conversationRoutes); // Add conversation routes under the same prefix
app.use('/api/message-history', messageHistoryRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/qrcode', qrcodeRoutes);
app.use('/api/proxy', proxyRoutes);
// app.use('/api/webhooks', webhookSimpleRoutes);

// Set up webhook endpoints
setupWebhookEndpoints(app);

// Webhook status endpoint (inline to avoid circular dependency issues)
app.get('/api/webhooks/status', (req, res) => {
  res.json({
    success: true,
    message: 'Webhook system is available',
    status: 'ready',
    endpoints: [
      'POST /api/webhooks/device/:deviceId/configure',
      'GET /api/webhooks/device/:deviceId/config',
      'DELETE /api/webhooks/device/:deviceId/config',
      'POST /api/webhooks/device/:deviceId/test',
      'GET /api/webhooks/device/:deviceId/deliveries',
      'GET /api/webhooks/device/:deviceId/stats'
    ]
  });
});

// Socket.io setup
setupSocketHandlers(io);

// Connect to MongoDB (with fallback if MongoDB is not available)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp-api-provider';
mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log('Connected to MongoDB');

    // Set up webhook processor to avoid circular dependency
    try {
      const webhookManager = WebhookManager.getInstance();
      webhookManager.setWebhookProcessor(async (deviceId: string, message: any) => {
        await processIncomingMessage(deviceId, message);
      });
      console.log('✅ Webhook processor configured - incoming messages will trigger webhooks');
    } catch (error) {
      console.error('❌ Error setting up webhook processor:', error);
    }

    // Initialize proxy and monitoring services
    try {
      console.log('🔧 Initializing proxy and monitoring services...');

      // Initialize Decodo proxy service if enabled
      if (isDecodoEnabled()) {
        const proxyService = getDecodoProxyService();
        console.log('✅ Decodo proxy service initialized');
      }

      // Initialize message queue service if enabled
      if (isMessageQueueEnabled()) {
        const messageQueueService = getMessageQueueService();
        console.log('✅ Message queue service initialized');
      }

      // Initialize monitoring service if enabled
      if (isMonitoringEnabled()) {
        const monitoringService = getProxyMonitoringService();
        console.log('✅ Proxy monitoring service initialized');
      }

    } catch (error) {
      console.error('❌ Error initializing proxy services:', error);
    }

    // Restore active WhatsApp clients from database
    try {
      await restoreActiveClients();
    } catch (error) {
      console.error('Error restoring active WhatsApp clients:', error);
    }

    // Process pending webhook deliveries
    // try {
    //   const webhookService = WebhookService.getInstance();
    //   await webhookService.processPendingDeliveries();
    //   console.log('✅ Pending webhook deliveries processed');
    // } catch (error) {
    //   console.error('❌ Error processing pending webhook deliveries:', error);
    // }
  })
  .catch((error) => {
    console.error('MongoDB connection error:', error);
    console.log('Starting server without MongoDB connection...');
  })
  .finally(() => {
    // Start server regardless of MongoDB connection status
    const PORT = process.env.PORT || 3000; // Server port configuration // Changed to 3000 to avoid conflicts
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  });

// Initialize shutdown manager for graceful shutdown handling
initializeShutdownManager({
  shutdownTimeoutMs: 30000, // 30 seconds
  enableLogging: true,
  forceExitAfterTimeout: true,
});

// Add cleanup handlers for proxy services
process.on('SIGTERM', async () => {
  console.log('🧹 Cleaning up proxy and monitoring services...');
  try {
    destroyProxyMonitoringService();
    destroyMessageQueueService();
    destroyDecodoProxyService();
    console.log('✅ Proxy services cleaned up successfully');
  } catch (error) {
    console.error('❌ Error cleaning up proxy services:', error);
  }
});

process.on('SIGINT', async () => {
  console.log('🧹 Cleaning up proxy and monitoring services...');
  try {
    destroyProxyMonitoringService();
    destroyMessageQueueService();
    destroyDecodoProxyService();
    console.log('✅ Proxy services cleaned up successfully');
  } catch (error) {
    console.error('❌ Error cleaning up proxy services:', error);
  }
});
