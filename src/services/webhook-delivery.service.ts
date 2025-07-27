import axios, { AxiosResponse } from 'axios';
import WebhookConfig, { IWebhookConfig } from '../models/webhook-config.model';
import WebhookDelivery, { IWebhookDelivery } from '../models/webhook-delivery.model';

export class WebhookDeliveryService {
  private static instance: WebhookDeliveryService;
  private retryQueue: Map<string, NodeJS.Timeout> = new Map();

  public static getInstance(): WebhookDeliveryService {
    if (!WebhookDeliveryService.instance) {
      WebhookDeliveryService.instance = new WebhookDeliveryService();
    }
    return WebhookDeliveryService.instance;
  }

  /**
   * Attempt webhook delivery with retry logic
   */
  async attemptDelivery(delivery: IWebhookDelivery, config: IWebhookConfig): Promise<void> {
    try {
      console.log(`[Webhook] Attempting delivery ${delivery.attemptCount + 1}/${delivery.maxRetries} for message ${delivery.messageId}`);

      delivery.attemptCount += 1;
      delivery.status = 'retrying';
      await delivery.save();

      // Prepare headers
      const headers: { [key: string]: string } = {
        'Content-Type': 'application/json',
        'User-Agent': 'WhatsApp-Webhook/1.0',
        'X-Webhook-Delivery-ID': delivery._id.toString(),
        'X-Webhook-Device-ID': delivery.deviceId,
        'X-Webhook-Message-ID': delivery.messageId,
        ...config.authHeaders
      };

      // Make HTTP request
      const response: AxiosResponse = await axios.post(
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

      console.log(`[Webhook] Successfully delivered webhook for message ${delivery.messageId} to ${delivery.webhookUrl}`);

    } catch (error: any) {
      console.error(`[Webhook] Delivery attempt ${delivery.attemptCount} failed for message ${delivery.messageId}:`, error.message);

      delivery.errorMessage = error.message;
      delivery.httpStatus = error.response?.status;
      delivery.responseBody = error.response?.data ? JSON.stringify(error.response.data).substring(0, 1000) : undefined;

      // Check if we should retry
      if (delivery.attemptCount < delivery.maxRetries && this.shouldRetry(error)) {
        // Schedule retry
        const retryDelay = config.retryConfig.retryDelay * Math.pow(config.retryConfig.backoffMultiplier, delivery.attemptCount - 1);
        delivery.nextRetryAt = new Date(Date.now() + retryDelay);
        delivery.status = 'pending';

        // Schedule retry
        this.scheduleRetry(delivery._id.toString(), retryDelay, config);

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

  /**
   * Determine if error should trigger a retry
   */
  private shouldRetry(error: any): boolean {
    // Retry on network errors and 5xx server errors
    if (!error.response) return true; // Network error
    if (error.response.status >= 500) return true; // Server error
    if (error.response.status === 429) return true; // Rate limited
    
    return false; // Don't retry on 4xx client errors
  }

  /**
   * Schedule retry for failed webhook delivery
   */
  private scheduleRetry(deliveryId: string, delay: number, config: IWebhookConfig): void {
    // Clear existing retry if any
    if (this.retryQueue.has(deliveryId)) {
      clearTimeout(this.retryQueue.get(deliveryId)!);
    }

    // Schedule new retry
    const timeout = setTimeout(async () => {
      try {
        const delivery = await WebhookDelivery.findById(deliveryId);
        if (delivery && delivery.status === 'pending') {
          await this.attemptDelivery(delivery, config);
        }
      } catch (error) {
        console.error(`[Webhook] Error in scheduled retry for delivery ${deliveryId}:`, error);
      } finally {
        this.retryQueue.delete(deliveryId);
      }
    }, delay);

    this.retryQueue.set(deliveryId, timeout);
  }

  /**
   * Process pending webhook deliveries (for server restart recovery)
   */
  async processPendingDeliveries(): Promise<void> {
    try {
      console.log('[Webhook] Processing pending webhook deliveries');

      const pendingDeliveries = await WebhookDelivery.find({
        status: 'pending',
        nextRetryAt: { $lte: new Date() }
      }).limit(100);

      console.log(`[Webhook] Found ${pendingDeliveries.length} pending deliveries to process`);

      for (const delivery of pendingDeliveries) {
        try {
          const config = await WebhookConfig.findById(delivery.webhookConfigId);
          if (config && config.isEnabled) {
            await this.attemptDelivery(delivery, config);
          } else {
            // Config not found or disabled, mark as failed
            delivery.status = 'failed';
            delivery.errorMessage = 'Webhook configuration not found or disabled';
            await delivery.save();
          }
        } catch (error) {
          console.error(`[Webhook] Error processing pending delivery ${delivery._id}:`, error);
        }
      }

    } catch (error) {
      console.error('[Webhook] Error processing pending deliveries:', error);
    }
  }

  /**
   * Clean up old delivery records
   */
  async cleanupOldDeliveries(): Promise<void> {
    try {
      const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
      
      const result = await WebhookDelivery.deleteMany({
        createdAt: { $lt: cutoffDate }
      });

      console.log(`[Webhook] Cleaned up ${result.deletedCount} old delivery records`);
    } catch (error) {
      console.error('[Webhook] Error cleaning up old deliveries:', error);
    }
  }

  /**
   * Get delivery statistics for a device
   */
  async getDeliveryStats(deviceId: string, days: number = 7): Promise<any> {
    try {
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

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

      return {
        totalDeliveries,
        stats,
        period: `${days} days`
      };
    } catch (error) {
      console.error('[Webhook] Error getting delivery stats:', error);
      return null;
    }
  }
}

export default WebhookDeliveryService;
