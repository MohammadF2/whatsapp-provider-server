import { Request, Response } from 'express';
import WebhookConfig from '../models/webhook-config.model';
import WebhookDelivery from '../models/webhook-delivery.model';
import Device from '../models/device.model';
// import WebhookService from '../services/webhook.service';

// HTTP Status Codes
const HTTP_STATUS_CODES = {
  OK: 200,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500
};

/**
 * Configure webhook for a device
 */
export const configureWebhook = async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;
    const { 
      webhookUrl, 
      isEnabled = true, 
      authHeaders = {}, 
      messageTypes = {
        text: true,
        image: true,
        audio: true,
        video: true,
        document: true,
        sticker: true,
        location: true,
        contact: true,
        voice: true
      },
      retryConfig = {
        maxRetries: 3,
        retryDelay: 1000,
        backoffMultiplier: 2
      }
    } = req.body;
    const userId = req.user._id;

    // Validate required fields
    if (!webhookUrl) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: 'Webhook URL is required'
      });
    }

    // Validate URL format
    try {
      new URL(webhookUrl);
    } catch {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: 'Invalid webhook URL format'
      });
    }

    // Check if device exists and belongs to user
    const device = await Device.findOne({ _id: deviceId, user: userId });
    if (!device) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: 'Device not found'
      });
    }

    // Create or update webhook configuration
    const webhookConfig = await WebhookConfig.findOneAndUpdate(
      { deviceId, userId },
      {
        deviceId,
        userId,
        webhookUrl,
        isEnabled,
        authHeaders,
        messageTypes,
        retryConfig,
        failedDeliveries: 0
      },
      { 
        upsert: true, 
        new: true,
        setDefaultsOnInsert: true
      }
    );

    console.log(`[Webhook] Configured webhook for device ${deviceId}: ${webhookUrl}`);

    return res.status(HTTP_STATUS_CODES.OK).json({
      success: true,
      message: 'Webhook configured successfully',
      webhook: {
        id: webhookConfig._id,
        deviceId: webhookConfig.deviceId,
        webhookUrl: webhookConfig.webhookUrl,
        isEnabled: webhookConfig.isEnabled,
        messageTypes: webhookConfig.messageTypes,
        retryConfig: webhookConfig.retryConfig,
        createdAt: webhookConfig.createdAt,
        updatedAt: webhookConfig.updatedAt
      }
    });

  } catch (error: any) {
    console.error('[Webhook] Error configuring webhook:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to configure webhook',
      error: error.message
    });
  }
};

/**
 * Get webhook configuration for a device
 */
export const getWebhookConfig = async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user._id;

    // Check if device exists and belongs to user
    const device = await Device.findOne({ _id: deviceId, user: userId });
    if (!device) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: 'Device not found'
      });
    }

    // Get webhook configuration
    const webhookConfig = await WebhookConfig.findOne({ deviceId, userId });

    if (!webhookConfig) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: 'Webhook not configured for this device'
      });
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      success: true,
      webhook: {
        id: webhookConfig._id,
        deviceId: webhookConfig.deviceId,
        webhookUrl: webhookConfig.webhookUrl,
        isEnabled: webhookConfig.isEnabled,
        messageTypes: webhookConfig.messageTypes,
        retryConfig: webhookConfig.retryConfig,
        lastDeliveryAttempt: webhookConfig.lastDeliveryAttempt,
        lastSuccessfulDelivery: webhookConfig.lastSuccessfulDelivery,
        failedDeliveries: webhookConfig.failedDeliveries,
        createdAt: webhookConfig.createdAt,
        updatedAt: webhookConfig.updatedAt
      }
    });

  } catch (error: any) {
    console.error('[Webhook] Error getting webhook config:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to get webhook configuration',
      error: error.message
    });
  }
};

/**
 * Delete webhook configuration for a device
 */
export const deleteWebhook = async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user._id;

    // Check if device exists and belongs to user
    const device = await Device.findOne({ _id: deviceId, user: userId });
    if (!device) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: 'Device not found'
      });
    }

    // Delete webhook configuration
    const result = await WebhookConfig.findOneAndDelete({ deviceId, userId });

    if (!result) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: 'Webhook not configured for this device'
      });
    }

    console.log(`[Webhook] Deleted webhook configuration for device ${deviceId}`);

    return res.status(HTTP_STATUS_CODES.OK).json({
      success: true,
      message: 'Webhook configuration deleted successfully'
    });

  } catch (error: any) {
    console.error('[Webhook] Error deleting webhook:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to delete webhook configuration',
      error: error.message
    });
  }
};

/**
 * Get webhook delivery logs for a device
 */
export const getWebhookDeliveries = async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;
    const { 
      page = 1, 
      limit = 50, 
      status,
      startDate,
      endDate 
    } = req.query;
    const userId = req.user._id;

    // Check if device exists and belongs to user
    const device = await Device.findOne({ _id: deviceId, user: userId });
    if (!device) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: 'Device not found'
      });
    }

    // Build query
    const query: any = { deviceId };
    
    if (status) {
      query.status = status;
    }
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate as string);
      if (endDate) query.createdAt.$lte = new Date(endDate as string);
    }

    // Get deliveries with pagination
    const skip = (Number(page) - 1) * Number(limit);
    const deliveries = await WebhookDelivery.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .select('-payload -responseBody'); // Exclude large fields

    const total = await WebhookDelivery.countDocuments(query);

    return res.status(HTTP_STATUS_CODES.OK).json({
      success: true,
      deliveries,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });

  } catch (error: any) {
    console.error('[Webhook] Error getting webhook deliveries:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to get webhook deliveries',
      error: error.message
    });
  }
};

/**
 * Get webhook delivery statistics for a device
 */
export const getWebhookStats = async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;
    const { days = 7 } = req.query;
    const userId = req.user._id;

    // Check if device exists and belongs to user
    const device = await Device.findOne({ _id: deviceId, user: userId });
    if (!device) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: 'Device not found'
      });
    }

    // const webhookService = WebhookService.getInstance();
    // const stats = await webhookService.getDeliveryStats(deviceId, Number(days));

    return res.status(HTTP_STATUS_CODES.OK).json({
      success: true,
      stats: { message: 'Stats endpoint temporarily disabled' }
    });

  } catch (error: any) {
    console.error('[Webhook] Error getting webhook stats:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to get webhook statistics',
      error: error.message
    });
  }
};

/**
 * Test webhook endpoint - sends a test payload
 */
export const testWebhook = async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user._id;

    // Check if device exists and belongs to user
    const device = await Device.findOne({ _id: deviceId, user: userId });
    if (!device) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: 'Device not found'
      });
    }

    // Get webhook configuration
    const webhookConfig = await WebhookConfig.findOne({ deviceId, userId });
    if (!webhookConfig) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: 'Webhook not configured for this device'
      });
    }

    // Create test payload
    const testPayload = {
      messageId: `test_${Date.now()}`,
      timestamp: Date.now(),
      deviceId,
      sender: {
        phoneNumber: '1234567890',
        contactName: 'Test Contact',
        isContact: false
      },
      chat: {
        id: 'test_chat_id',
        name: 'Test Chat',
        isGroup: false
      },
      messageType: 'text',
      content: {
        text: 'This is a test message from WhatsApp Webhook System'
      },
      metadata: {
        hasMedia: false,
        isForwarded: false,
        isStarred: false,
        isTest: true
      }
    };

    // const webhookService = WebhookService.getInstance();
    // await webhookService.deliverWebhook(webhookConfig, testPayload);

    return res.status(HTTP_STATUS_CODES.OK).json({
      success: true,
      message: 'Test webhook endpoint temporarily disabled',
      testPayload
    });

  } catch (error: any) {
    console.error('[Webhook] Error testing webhook:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to test webhook',
      error: error.message
    });
  }
};
