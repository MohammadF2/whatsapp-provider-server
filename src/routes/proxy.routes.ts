import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import { getProxyMonitoringService } from '../services/proxy-monitoring.service';
import { getMessageQueueService } from '../services/message-queue.service';
import { getDecodoProxyService } from '../services/decodo-proxy.service';
import ProxyDeviceMapping from '../models/proxy-device-mapping.model';
import { isDecodoEnabled, isMessageQueueEnabled, isMonitoringEnabled } from '../config/proxy.config';

const router = Router();

/**
 * @swagger
 * /api/proxy/status:
 *   get:
 *     summary: Get proxy service status
 *     tags: [Proxy]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Proxy service status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 decodoEnabled:
 *                   type: boolean
 *                 messageQueueEnabled:
 *                   type: boolean
 *                 monitoringEnabled:
 *                   type: boolean
 *                 services:
 *                   type: object
 */
router.get('/status', authenticateToken, async (req: Request, res: Response) => {
  try {
    const status = {
      decodoEnabled: isDecodoEnabled(),
      messageQueueEnabled: isMessageQueueEnabled(),
      monitoringEnabled: isMonitoringEnabled(),
      services: {
        proxy: null as any,
        messageQueue: null as any,
        monitoring: null as any,
      },
    };

    // Get proxy service status
    if (isDecodoEnabled()) {
      try {
        const proxyService = getDecodoProxyService();
        const cachedProxies = proxyService.getAllCachedProxies();
        status.services.proxy = {
          enabled: true,
          cachedProxies: cachedProxies.length,
          proxies: cachedProxies.map(p => ({
            id: p.id,
            country: p.country,
            networkType: p.networkType,
            isActive: p.isActive,
            lastUsed: p.lastUsed,
          })),
        };
      } catch (error) {
        status.services.proxy = { enabled: true, error: (error as Error).message };
      }
    }

    // Get message queue status
    if (isMessageQueueEnabled()) {
      try {
        const messageQueueService = getMessageQueueService();
        const queueHealth = messageQueueService.getQueueHealth();
        const allStats = messageQueueService.getAllQueueStats();
        
        status.services.messageQueue = {
          enabled: true,
          health: queueHealth,
          activeQueues: messageQueueService.getActiveQueueCount(),
          queueStats: allStats,
        };
      } catch (error) {
        status.services.messageQueue = { enabled: true, error: (error as Error).message };
      }
    }

    // Get monitoring status
    if (isMonitoringEnabled()) {
      try {
        const monitoringService = getProxyMonitoringService();
        const monitoringStatus = monitoringService.getStatus();
        const currentMetrics = monitoringService.getCurrentMetrics();
        const activeAlerts = monitoringService.getActiveAlerts();
        
        status.services.monitoring = {
          enabled: true,
          status: monitoringStatus,
          currentMetrics,
          activeAlerts: activeAlerts.length,
          alerts: activeAlerts,
        };
      } catch (error) {
        status.services.monitoring = { enabled: true, error: (error as Error).message };
      }
    }

    res.json(status);
  } catch (error) {
    console.error('Error getting proxy status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get proxy status',
      error: (error as Error).message
    });
  }
});

/**
 * @swagger
 * /api/proxy/metrics:
 *   get:
 *     summary: Get monitoring metrics
 *     tags: [Proxy]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Limit number of metrics entries
 *     responses:
 *       200:
 *         description: Monitoring metrics
 */
router.get('/metrics', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!isMonitoringEnabled()) {
      res.status(400).json({
        success: false,
        message: 'Monitoring is not enabled',
      });
      return;
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const monitoringService = getProxyMonitoringService();
    const metrics = monitoringService.getMetricsHistory(limit);

    res.json({
      success: true,
      metrics,
      count: metrics.length,
    });
  } catch (error) {
    console.error('Error getting metrics:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get metrics',
      error: (error as Error).message 
    });
  }
});

/**
 * @swagger
 * /api/proxy/alerts:
 *   get:
 *     summary: Get active alerts
 *     tags: [Proxy]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Active alerts
 */
router.get('/alerts', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!isMonitoringEnabled()) {
      res.status(400).json({
        success: false,
        message: 'Monitoring is not enabled',
      });
      return;
    }

    const monitoringService = getProxyMonitoringService();
    const alerts = monitoringService.getActiveAlerts();

    res.json({
      success: true,
      alerts,
      count: alerts.length,
    });
  } catch (error) {
    console.error('Error getting alerts:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get alerts',
      error: (error as Error).message 
    });
  }
});

/**
 * @swagger
 * /api/proxy/alerts/{alertId}/resolve:
 *   post:
 *     summary: Resolve an alert
 *     tags: [Proxy]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: alertId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Alert resolved
 */
router.post('/alerts/:alertId/resolve', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!isMonitoringEnabled()) {
      res.status(400).json({
        success: false,
        message: 'Monitoring is not enabled',
      });
      return;
    }

    const { alertId } = req.params;
    const monitoringService = getProxyMonitoringService();
    const resolved = monitoringService.resolveAlert(alertId);

    if (resolved) {
      res.json({
        success: true,
        message: 'Alert resolved successfully',
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Alert not found',
      });
    }
  } catch (error) {
    console.error('Error resolving alert:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to resolve alert',
      error: (error as Error).message 
    });
  }
});

/**
 * @swagger
 * /api/proxy/mappings:
 *   get:
 *     summary: Get proxy device mappings
 *     tags: [Proxy]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: deviceId
 *         schema:
 *           type: string
 *         description: Filter by device ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, inactive, failed]
 *         description: Filter by status
 *     responses:
 *       200:
 *         description: Proxy device mappings
 */
router.get('/mappings', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { deviceId, status } = req.query;
    const filter: any = {};

    if (deviceId) {
      filter.deviceId = deviceId;
    }
    if (status) {
      filter.status = status;
    }

    const mappings = await ProxyDeviceMapping.find(filter)
      .sort({ assignedAt: -1 })
      .limit(100);

    res.json({
      success: true,
      mappings,
      count: mappings.length,
    });
  } catch (error) {
    console.error('Error getting proxy mappings:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get proxy mappings',
      error: (error as Error).message 
    });
  }
});

/**
 * @swagger
 * /api/proxy/queue/{deviceId}:
 *   get:
 *     summary: Get queue status for a device
 *     tags: [Proxy]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Device queue status
 */
router.get('/queue/:deviceId', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!isMessageQueueEnabled()) {
      res.status(400).json({
        success: false,
        message: 'Message queue is not enabled',
      });
      return;
    }

    const { deviceId } = req.params;
    const messageQueueService = getMessageQueueService();
    
    const stats = messageQueueService.getQueueStats(deviceId);
    const pendingMessages = messageQueueService.getPendingMessages(deviceId);

    if (!stats) {
      res.status(404).json({
        success: false,
        message: 'Queue not found for device',
      });
      return;
    }

    res.json({
      success: true,
      deviceId,
      stats,
      pendingMessages: pendingMessages.length,
      messages: pendingMessages.slice(0, 10), // Return first 10 pending messages
    });
  } catch (error) {
    console.error('Error getting queue status:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get queue status',
      error: (error as Error).message 
    });
  }
});

/**
 * @swagger
 * /api/proxy/queue/{deviceId}/clear:
 *   post:
 *     summary: Clear queue for a device
 *     tags: [Proxy]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Queue cleared
 */
router.post('/queue/:deviceId/clear', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!isMessageQueueEnabled()) {
      res.status(400).json({
        success: false,
        message: 'Message queue is not enabled',
      });
      return;
    }

    const { deviceId } = req.params;
    const messageQueueService = getMessageQueueService();
    
    messageQueueService.clearQueue(deviceId);

    res.json({
      success: true,
      message: 'Queue cleared successfully',
    });
  } catch (error) {
    console.error('Error clearing queue:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to clear queue',
      error: (error as Error).message 
    });
  }
});

export default router;
