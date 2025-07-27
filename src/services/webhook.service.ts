import axios, { AxiosResponse } from 'axios';
import { Message, MessageMedia, Contact, Location } from 'whatsapp-web.js';
import WebhookConfig, { IWebhookConfig } from '../models/webhook-config.model';
import WebhookDelivery, { IWebhookDelivery } from '../models/webhook-delivery.model';
import WebhookDeliveryService from './webhook-delivery.service';
import path from 'path';
import fs from 'fs';

export interface WebhookPayload {
  messageId: string;
  timestamp: number;
  deviceId: string;
  sender: {
    phoneNumber: string;
    contactName?: string;
    isContact: boolean;
  };
  chat: {
    id: string;
    name?: string;
    isGroup: boolean;
    participantCount?: number;
  };
  messageType: string;
  content: {
    text?: string;
    caption?: string;
    mediaUrl?: string;
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
    duration?: number;
    dimensions?: {
      width: number;
      height: number;
    };
    location?: {
      latitude: number;
      longitude: number;
      description?: string;
    };
    contact?: {
      name: string;
      phoneNumber: string;
      vcard?: string;
    };
  };
  metadata: {
    hasMedia: boolean;
    isForwarded: boolean;
    isStarred: boolean;
    mentionedIds?: string[];
    quotedMessageId?: string;
  };
}

class WebhookService {
  private static instance: WebhookService;
  private retryQueue: Map<string, NodeJS.Timeout> = new Map();

  public static getInstance(): WebhookService {
    if (!WebhookService.instance) {
      WebhookService.instance = new WebhookService();
    }
    return WebhookService.instance;
  }

  /**
   * Process incoming WhatsApp message and trigger webhook if configured
   */
  async processIncomingMessage(deviceId: string, message: Message): Promise<void> {
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
      const messageType = this.getMessageType(message);
      if (!this.shouldForwardMessageType(webhookConfig, messageType)) {
        console.log(`[Webhook] Message type ${messageType} not configured for forwarding on device ${deviceId}`);
        return;
      }

      // Build webhook payload
      const payload = await this.buildWebhookPayload(deviceId, message);

      // Deliver webhook
      await this.deliverWebhook(webhookConfig, payload);

    } catch (error) {
      console.error(`[Webhook] Error processing message for device ${deviceId}:`, error);
    }
  }

  /**
   * Determine the message type from WhatsApp message
   */
  private getMessageType(message: Message): string {
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

    if (message.type === 'location') return 'location';
    if (message.type === 'vcard') return 'contact';
    if (message.type === 'chat') return 'text';
    
    return message.type || 'unknown';
  }

  /**
   * Check if message type should be forwarded based on configuration
   */
  private shouldForwardMessageType(config: IWebhookConfig, messageType: string): boolean {
    const typeMap: { [key: string]: keyof IWebhookConfig['messageTypes'] } = {
      'text': 'text',
      'image': 'image',
      'video': 'video',
      'audio': 'audio',
      'voice': 'voice',
      'document': 'document',
      'sticker': 'sticker',
      'location': 'location',
      'contact': 'contact',
      'vcard': 'contact'
    };

    const configKey = typeMap[messageType];
    return configKey ? config.messageTypes[configKey] : false;
  }

  /**
   * Build standardized webhook payload from WhatsApp message
   */
  private async buildWebhookPayload(deviceId: string, message: Message): Promise<WebhookPayload> {
    const chat = await message.getChat();
    const contact = await message.getContact();
    
    const payload: WebhookPayload = {
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
        participantCount: chat.isGroup ? (chat as any).participants?.length : undefined
      },
      messageType: this.getMessageType(message),
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
    await this.addMessageContent(payload, message);

    return payload;
  }

  /**
   * Add message content to payload based on message type
   */
  private async addMessageContent(payload: WebhookPayload, message: Message): Promise<void> {
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
            const mediaUrl = await this.saveMediaFile(payload.deviceId, payload.messageId, media);

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

    } catch (error) {
      console.error(`[Webhook] Error adding message content:`, error);
    }
  }

  /**
   * Save media file temporarily and return URL
   */
  private async saveMediaFile(deviceId: string, messageId: string, media: MessageMedia): Promise<string> {
    try {
      const uploadsDir = path.join(process.cwd(), 'uploads', 'webhook-media', deviceId);

      // Ensure directory exists
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      // Generate filename
      const extension = this.getFileExtension(media.mimetype);
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

  /**
   * Get file extension from MIME type
   */
  private getFileExtension(mimeType: string): string {
    const mimeMap: { [key: string]: string } = {
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

  /**
   * Deliver webhook payload to configured URL
   */
  async deliverWebhook(config: IWebhookConfig, payload: WebhookPayload): Promise<void> {
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

    const deliveryService = WebhookDeliveryService.getInstance();
    await deliveryService.attemptDelivery(deliveryRecord, config);
  }

  /**
   * Process pending webhook deliveries (for server restart recovery)
   */
  async processPendingDeliveries(): Promise<void> {
    const deliveryService = WebhookDeliveryService.getInstance();
    await deliveryService.processPendingDeliveries();
  }

  /**
   * Get delivery statistics for a device
   */
  async getDeliveryStats(deviceId: string, days: number = 7): Promise<any> {
    const deliveryService = WebhookDeliveryService.getInstance();
    return await deliveryService.getDeliveryStats(deviceId, days);
  }
}

export default WebhookService;
