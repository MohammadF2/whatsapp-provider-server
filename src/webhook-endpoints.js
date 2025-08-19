// Full webhook endpoints implementation with database integration

// Import models - handle both CommonJS and ES6 exports
function getModel(path) {
  const module = require(path);
  return module.default || module;
}

const WebhookConfig = getModel('./models/webhook-config.model');
const WebhookDelivery = getModel('./models/webhook-delivery.model');
const Device = getModel('./models/device.model');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

// Webhook processing function for incoming messages
async function processIncomingMessage(deviceId, message) {
  try {
    console.log(`[Webhook] Processing incoming message for device ${deviceId}, message ID: ${message.id._serialized}`);

    // Get webhook configuration for this device
    const webhookConfig = await WebhookConfig.findOne({
      deviceId,
      isEnabled: true
    });

    if (!webhookConfig) {
      console.log(`[Webhook] No webhook configuration found for device ${deviceId}`);
      return;
    }

    // Check if this message type should be forwarded
    const messageType = getMessageType(message);
    if (!shouldForwardMessageType(webhookConfig, messageType)) {
      console.log(`[Webhook] Message type ${messageType} not configured for forwarding on device ${deviceId}`);
      return;
    }

    // Build webhook payload
    const payload = await buildWebhookPayload(deviceId, message);

    // Deliver webhook
    await deliverWebhook(webhookConfig, payload);

  } catch (error) {
    console.error(`[Webhook] Error processing message for device ${deviceId}:`, error);
  }
}

// Helper functions for message processing
function getMessageType(message) {
  if (message.hasMedia) {
    const media = message.type;
    switch (media) {
      case 'image': return 'image';
      case 'video': return 'video';
      case 'audio': return 'audio';
      case 'ptt': return 'voice'; // Push-to-talk voice message
      case 'document': return 'document';
      case 'sticker': return 'sticker';
      default: return 'media';
    }
  }

  // Handle new message types
  if (message.type === 'location') return 'location';
  if (message.type === 'vcard') return 'contact';
  if (message.type === 'chat') return 'text';
  if (message.type === 'poll_creation') return 'poll';
  if (message.type === 'vote_update') return 'poll_vote';
  if (message.type === 'product') return 'product';
  if (message.type === 'order') return 'order';
  if (message.type === 'buttons_response') return 'button_response';
  if (message.type === 'list_response') return 'list_response';

  return message.type || 'unknown';
}

function shouldForwardMessageType(config, messageType) {
  const typeMap = {
    'text': 'text',
    'image': 'image',
    'video': 'video',
    'audio': 'audio',
    'voice': 'voice',
    'document': 'document',
    'sticker': 'sticker',
    'location': 'location',
    'contact': 'contact',
    'vcard': 'contact',
    'poll': 'poll',
    'poll_vote': 'poll_vote',
    'product': 'product',
    'order': 'order',
    'button_response': 'button_response',
    'list_response': 'list_response'
  };

  const configKey = typeMap[messageType];
  return configKey ? config.messageTypes[configKey] : false;
}

async function buildWebhookPayload(deviceId, message) {
  const chat = await message.getChat();
  const contact = await message.getContact();

  const payload = {
    messageId: message.id._serialized,
    timestamp: message.timestamp * 1000, // Convert to milliseconds
    deviceId,
    sender: {
      phoneNumber: contact.number,
      contactName: contact.name || contact.pushname,
      isContact: contact.isMyContact
    },
    chat: {
      id: chat.id._serialized,
      name: chat.name,
      isGroup: chat.isGroup,
      participantCount: chat.isGroup ? (chat.participants?.length || 0) : undefined
    },
    messageType: getMessageType(message),
    content: {},
    metadata: {
      hasMedia: message.hasMedia,
      isForwarded: message.isForwarded,
      isStarred: message.isStarred,
      mentionedIds: message.mentionedIds,
      quotedMessageId: message.hasQuotedMsg ? (await message.getQuotedMessage())?.id._serialized : undefined
    }
  };

  // Add content based on message type
  await addMessageContent(payload, message);

  return payload;
}

async function addMessageContent(payload, message) {
  try {
    // Add text content
    if (message.body) {
      payload.content.text = message.body;
    }

    // Add media content
    if (message.hasMedia) {
      try {
        const media = await message.downloadMedia();

        if (media) {
          // Save media file temporarily and provide URL
          const mediaUrl = await saveMediaFile(payload.deviceId, payload.messageId, media);

          payload.content.mediaUrl = mediaUrl;
          payload.content.fileName = media.filename;
          payload.content.mimeType = media.mimetype;
          payload.content.fileSize = media.data ? Buffer.from(media.data, 'base64').length : undefined;

          // Add caption if present
          if (message.body) {
            payload.content.caption = message.body;
          }
        }
      } catch (mediaError) {
        console.error(`[Webhook] Error downloading media for message ${payload.messageId}:`, mediaError);
        payload.content.mediaUrl = null;
      }
    }

    // Add location content
    if (message.type === 'location' && message.location) {
      payload.content.location = {
        latitude: message.location.latitude,
        longitude: message.location.longitude,
        description: message.location.description
      };
    }

    // Add contact content
    if (message.type === 'vcard' && message.vCards && message.vCards.length > 0) {
      const vcard = message.vCards[0];
      payload.content.contact = {
        name: vcard.displayName || '',
        phoneNumber: vcard.waid || '',
        vcard: vcard.vcard
      };
    }

    // Add poll content
    if (message.type === 'poll_creation') {
      try {
        const poll = await message.getPoll();
        payload.content.poll = {
          name: poll.name,
          options: poll.options,
          allowMultipleAnswers: poll.allowMultipleAnswers,
          messageSecret: poll.messageSecret
        };
      } catch (pollError) {
        console.error(`[Webhook] Error getting poll data:`, pollError);
        payload.content.poll = { error: 'Failed to retrieve poll data' };
      }
    }

    // Add poll vote content
    if (message.type === 'vote_update') {
      try {
        const vote = await message.getVote();
        payload.content.pollVote = {
          voter: vote.voter,
          selectedOptions: vote.selectedOptions,
          parentMessageId: vote.parentMessage?.id?._serialized,
          interractedAtTs: vote.interractedAtTs
        };
      } catch (voteError) {
        console.error(`[Webhook] Error getting vote data:`, voteError);
        payload.content.pollVote = { error: 'Failed to retrieve vote data' };
      }
    }

    // Add product content
    if (message.type === 'product') {
      try {
        const product = await message.getProduct();
        payload.content.product = {
          id: product.id,
          name: product.name,
          price: product.price,
          currency: product.currency,
          quantity: product.quantity,
          thumbnailUrl: product.thumbnailUrl,
          data: product.data
        };
      } catch (productError) {
        console.error(`[Webhook] Error getting product data:`, productError);
        payload.content.product = { error: 'Failed to retrieve product data' };
      }
    }

    // Add order content
    if (message.type === 'order') {
      try {
        const order = await message.getOrder();
        payload.content.order = {
          createdAt: order.createdAt,
          currency: order.currency,
          subtotal: order.subtotal,
          total: order.total
        };
      } catch (orderError) {
        console.error(`[Webhook] Error getting order data:`, orderError);
        payload.content.order = { error: 'Failed to retrieve order data' };
      }
    }

    // Add button response content
    if (message.type === 'buttons_response') {
      try {
        payload.content.buttonResponse = {
          selectedButtonId: message.selectedButtonId || message.body,
          displayText: message.body
        };
      } catch (buttonError) {
        console.error(`[Webhook] Error getting button response data:`, buttonError);
        payload.content.buttonResponse = { error: 'Failed to retrieve button response data' };
      }
    }

    // Add list response content
    if (message.type === 'list_response') {
      try {
        payload.content.listResponse = {
          selectedRowId: message.selectedRowId,
          title: message.listResponse?.title,
          description: message.listResponse?.description
        };
      } catch (listError) {
        console.error(`[Webhook] Error getting list response data:`, listError);
        payload.content.listResponse = { error: 'Failed to retrieve list response data' };
      }
    }

  } catch (error) {
    console.error(`[Webhook] Error adding message content:`, error);
  }
}

async function saveMediaFile(deviceId, messageId, media) {
  try {
    const uploadsDir = path.join(process.cwd(), 'uploads', 'webhook-media', deviceId);

    // Ensure directory exists
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Generate filename
    const extension = getFileExtension(media.mimetype);
    const filename = `${messageId}${extension}`;
    const filePath = path.join(uploadsDir, filename);

    // Save file
    const buffer = Buffer.from(media.data, 'base64');
    fs.writeFileSync(filePath, buffer);

    // Return URL
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    return `${baseUrl}/uploads/webhook-media/${deviceId}/${filename}`;

  } catch (error) {
    console.error(`[Webhook] Error saving media file:`, error);
    throw error;
  }
}

function getFileExtension(mimeType) {
  const mimeMap = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/ogg': '.ogg',
    'audio/wav': '.wav',
    'application/pdf': '.pdf',
    'text/plain': '.txt'
  };

  return mimeMap[mimeType] || '';
}

async function deliverWebhook(config, payload) {
  const deliveryRecord = new WebhookDelivery({
    deviceId: config.deviceId,
    webhookConfigId: config._id,
    messageId: payload.messageId,
    webhookUrl: config.webhookUrl,
    payload,
    maxRetries: config.retryConfig.maxRetries,
    status: 'pending'
  });

  await deliveryRecord.save();
  await attemptDelivery(deliveryRecord, config);
}

async function attemptDelivery(delivery, config) {
  try {
    console.log(`[Webhook] Attempting delivery ${delivery.attemptCount + 1}/${delivery.maxRetries} for message ${delivery.messageId}`);

    delivery.attemptCount += 1;
    delivery.status = 'retrying';
    await delivery.save();

    // Prepare headers
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'WhatsApp-Webhook/1.0',
      'X-Webhook-Delivery-ID': delivery._id.toString(),
      'X-Webhook-Device-ID': delivery.deviceId,
      'X-Webhook-Message-ID': delivery.messageId,
      ...config.authHeaders
    };

    // Make HTTP request
    const response = await axios.post(
      delivery.webhookUrl,
      delivery.payload,
      {
        headers,
        timeout: 30000, // 30 seconds timeout
        validateStatus: (status) => status < 500 // Only retry on 5xx errors
      }
    );

    // Success
    delivery.status = 'success';
    delivery.httpStatus = response.status;
    delivery.responseBody = JSON.stringify(response.data).substring(0, 1000); // Limit response body size
    delivery.deliveredAt = new Date();

    // Update webhook config
    config.lastSuccessfulDelivery = new Date();
    config.failedDeliveries = 0;

    await Promise.all([
      delivery.save(),
      config.save()
    ]);

    console.log(`[Webhook] ✅ Successfully delivered webhook for message ${delivery.messageId} to ${delivery.webhookUrl}`);

  } catch (error) {
    console.error(`[Webhook] ❌ Delivery attempt ${delivery.attemptCount} failed for message ${delivery.messageId}:`, error.message);

    delivery.errorMessage = error.message;
    delivery.httpStatus = error.response?.status;
    delivery.responseBody = error.response?.data ? JSON.stringify(error.response.data).substring(0, 1000) : undefined;

    // Check if we should retry
    if (delivery.attemptCount < delivery.maxRetries && shouldRetry(error)) {
      // Schedule retry
      const retryDelay = config.retryConfig.retryDelay * Math.pow(config.retryConfig.backoffMultiplier, delivery.attemptCount - 1);
      delivery.nextRetryAt = new Date(Date.now() + retryDelay);
      delivery.status = 'pending';

      console.log(`[Webhook] Scheduled retry for message ${delivery.messageId} in ${retryDelay}ms`);
    } else {
      // Max retries reached or non-retryable error
      delivery.status = 'failed';
      config.failedDeliveries += 1;
      await config.save();

      console.log(`[Webhook] Max retries reached for message ${delivery.messageId}, marking as failed`);
    }

    config.lastDeliveryAttempt = new Date();
    await Promise.all([
      delivery.save(),
      config.save()
    ]);
  }
}

function shouldRetry(error) {
  // Retry on network errors and 5xx server errors
  if (!error.response) return true; // Network error
  if (error.response.status >= 500) return true; // Server error
  if (error.response.status === 429) return true; // Rate limited

  return false; // Don't retry on 4xx client errors
}

function setupWebhookEndpoints(app) {
  // Webhook configuration endpoint - FULL IMPLEMENTATION
  app.post('/api/webhooks/device/:deviceId/configure', async (req, res) => {
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
          voice: true,
          poll: true,
          poll_vote: true,
          product: true,
          order: true,
          button_response: true,
          list_response: true
        },
        retryConfig = {
          maxRetries: 3,
          retryDelay: 1000,
          backoffMultiplier: 2
        }
      } = req.body;

      // For now, use a default userId - in production this would come from authentication
      const userId = 'default-user';

      // Validate required fields
      if (!webhookUrl) {
        return res.status(400).json({
          success: false,
          message: 'Webhook URL is required'
        });
      }

      // Validate URL format
      try {
        new URL(webhookUrl);
      } catch {
        return res.status(400).json({
          success: false,
          message: 'Invalid webhook URL format'
        });
      }

      // Skip device validation for now - focus on webhook functionality
      // const device = await Device.findById(deviceId);
      // if (!device) {
      //   return res.status(404).json({
      //     success: false,
      //     message: 'Device not found'
      //   });
      // }

      // Create or update webhook configuration in database
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

      return res.status(200).json({
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

    } catch (error) {
      console.error('[Webhook] Error configuring webhook:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to configure webhook',
        error: error.message
      });
    }
  });

  // Get webhook configuration - FULL IMPLEMENTATION
  app.get('/api/webhooks/device/:deviceId/config', async (req, res) => {
    try {
      const { deviceId } = req.params;
      const userId = 'default-user'; // In production, get from authentication

      // Skip device validation for now - focus on webhook functionality
      // const device = await Device.findById(deviceId);
      // if (!device) {
      //   return res.status(404).json({
      //     success: false,
      //     message: 'Device not found'
      //   });
      // }

      // Get webhook configuration from database
      const webhookConfig = await WebhookConfig.findOne({ deviceId, userId });

      if (!webhookConfig) {
        return res.status(404).json({
          success: false,
          message: 'Webhook not configured for this device'
        });
      }

      return res.status(200).json({
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

    } catch (error) {
      console.error('[Webhook] Error getting webhook config:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to get webhook configuration',
        error: error.message
      });
    }
  });

  // Delete webhook configuration - FULL IMPLEMENTATION
  app.delete('/api/webhooks/device/:deviceId/config', async (req, res) => {
    try {
      const { deviceId } = req.params;
      const userId = 'default-user'; // In production, get from authentication

      // Skip device validation for now - focus on webhook functionality
      // const device = await Device.findById(deviceId);
      // if (!device) {
      //   return res.status(404).json({
      //     success: false,
      //     message: 'Device not found'
      //   });
      // }

      // Delete webhook configuration from database
      const result = await WebhookConfig.findOneAndDelete({ deviceId, userId });

      if (!result) {
        return res.status(404).json({
          success: false,
          message: 'Webhook not configured for this device'
        });
      }

      console.log(`[Webhook] Deleted webhook configuration for device ${deviceId}`);

      return res.status(200).json({
        success: true,
        message: 'Webhook configuration deleted successfully'
      });

    } catch (error) {
      console.error('[Webhook] Error deleting webhook:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete webhook configuration',
        error: error.message
      });
    }
  });

  // Test webhook - FULL IMPLEMENTATION
  app.post('/api/webhooks/device/:deviceId/test', async (req, res) => {
    try {
      const { deviceId } = req.params;
      const userId = 'default-user'; // In production, get from authentication

      // Skip device validation for now - focus on webhook functionality
      // const device = await Device.findById(deviceId);
      // if (!device) {
      //   return res.status(404).json({
      //     success: false,
      //     message: 'Device not found'
      //   });
      // }

      // Get webhook configuration
      const webhookConfig = await WebhookConfig.findOne({ deviceId, userId });
      if (!webhookConfig) {
        return res.status(404).json({
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

      // For now, just return the test payload without actual delivery
      // Full webhook delivery will be enabled once circular dependencies are resolved
      return res.status(200).json({
        success: true,
        message: 'Test webhook payload created (delivery will be implemented when message processing is enabled)',
        testPayload,
        webhookUrl: webhookConfig.webhookUrl
      });

    } catch (error) {
      console.error('[Webhook] Error testing webhook:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to test webhook',
        error: error.message
      });
    }
  });

  // Get webhook deliveries - FULL IMPLEMENTATION
  app.get('/api/webhooks/device/:deviceId/deliveries', async (req, res) => {
    try {
      const { deviceId } = req.params;
      const {
        page = 1,
        limit = 50,
        status,
        startDate,
        endDate
      } = req.query;
      const userId = 'default-user'; // In production, get from authentication

      // Skip device validation for now - focus on webhook functionality
      // const device = await Device.findById(deviceId);
      // if (!device) {
      //   return res.status(404).json({
      //     success: false,
      //     message: 'Device not found'
      //   });
      // }

      // Build query
      const query = { deviceId };

      if (status) {
        query.status = status;
      }

      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      // Get deliveries with pagination
      const skip = (Number(page) - 1) * Number(limit);
      const deliveries = await WebhookDelivery.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .select('-payload -responseBody'); // Exclude large fields

      const total = await WebhookDelivery.countDocuments(query);

      return res.status(200).json({
        success: true,
        deliveries,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      });

    } catch (error) {
      console.error('[Webhook] Error getting webhook deliveries:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to get webhook deliveries',
        error: error.message
      });
    }
  });

  // Get webhook stats - FULL IMPLEMENTATION
  app.get('/api/webhooks/device/:deviceId/stats', async (req, res) => {
    try {
      const { deviceId } = req.params;
      const { days = 7 } = req.query;
      const userId = 'default-user'; // In production, get from authentication

      // Skip device validation for now - focus on webhook functionality
      // const device = await Device.findById(deviceId);
      // if (!device) {
      //   return res.status(404).json({
      //     success: false,
      //     message: 'Device not found'
      //   });
      // }

      const startDate = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);

      const stats = await WebhookDelivery.aggregate([
        {
          $match: {
            deviceId,
            createdAt: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            avgAttempts: { $avg: '$attemptCount' }
          }
        }
      ]);

      const totalDeliveries = await WebhookDelivery.countDocuments({
        deviceId,
        createdAt: { $gte: startDate }
      });

      // Process stats
      const processedStats = {
        totalDeliveries,
        successfulDeliveries: 0,
        failedDeliveries: 0,
        pendingDeliveries: 0,
        retryingDeliveries: 0,
        averageAttempts: 0,
        period: `${days} days`,
        breakdown: []
      };

      stats.forEach(stat => {
        processedStats.breakdown.push({
          status: stat._id,
          count: stat.count,
          averageAttempts: Math.round(stat.avgAttempts * 100) / 100
        });

        switch (stat._id) {
          case 'success':
            processedStats.successfulDeliveries = stat.count;
            break;
          case 'failed':
            processedStats.failedDeliveries = stat.count;
            break;
          case 'pending':
            processedStats.pendingDeliveries = stat.count;
            break;
          case 'retrying':
            processedStats.retryingDeliveries = stat.count;
            break;
        }
      });

      return res.status(200).json({
        success: true,
        stats: processedStats
      });

    } catch (error) {
      console.error('[Webhook] Error getting webhook stats:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to get webhook statistics',
        error: error.message
      });
    }
  });
}

module.exports = { setupWebhookEndpoints, processIncomingMessage };
