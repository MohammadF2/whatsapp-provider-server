import { Message } from 'whatsapp-web.js';

/**
 * Simple webhook manager to avoid circular dependencies
 */
class WebhookManager {
  private static instance: WebhookManager;
  private webhookProcessor?: (deviceId: string, message: Message) => Promise<void>;

  public static getInstance(): WebhookManager {
    if (!WebhookManager.instance) {
      WebhookManager.instance = new WebhookManager();
    }
    return WebhookManager.instance;
  }

  /**
   * Set the webhook processor function
   */
  setWebhookProcessor(processor: (deviceId: string, message: Message) => Promise<void>): void {
    this.webhookProcessor = processor;
    console.log('[WebhookManager] Webhook processor configured');
  }

  /**
   * Process incoming message for webhooks
   */
  async processMessage(deviceId: string, message: Message): Promise<void> {
    try {
      if (this.webhookProcessor && !message.fromMe) {
        console.log(`[WebhookManager] Processing incoming message for device ${deviceId}: ${message.id._serialized}`);
        await this.webhookProcessor(deviceId, message);
      }
    } catch (error) {
      console.error(`[WebhookManager] Error processing message for device ${deviceId}:`, error);
    }
  }
}

export default WebhookManager;
