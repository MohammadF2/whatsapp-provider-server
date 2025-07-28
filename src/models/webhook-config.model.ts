import { Schema, Document, model } from 'mongoose';

export interface IWebhookConfig extends Document {
  deviceId: string;
  userId: string;
  webhookUrl: string;
  isEnabled: boolean;
  authHeaders?: {
    [key: string]: string;
  };
  messageTypes: {
    text: boolean;
    image: boolean;
    audio: boolean;
    video: boolean;
    document: boolean;
    sticker: boolean;
    location: boolean;
    contact: boolean;
    voice: boolean;
    poll: boolean;
    poll_vote: boolean;
    product: boolean;
    order: boolean;
    button_response: boolean;
    list_response: boolean;
  };
  retryConfig: {
    maxRetries: number;
    retryDelay: number; // in milliseconds
    backoffMultiplier: number;
  };
  lastDeliveryAttempt?: Date;
  lastSuccessfulDelivery?: Date;
  failedDeliveries: number;
  createdAt: Date;
  updatedAt: Date;
}

const WebhookConfigSchema = new Schema<IWebhookConfig>(
  {
    deviceId: {
      type: String,
      required: true,
      index: true
    },
    userId: {
      type: String,
      required: true,
      index: true
    },
    webhookUrl: {
      type: String,
      required: true,
      validate: {
        validator: function(url: string) {
          try {
            new URL(url);
            return true;
          } catch {
            return false;
          }
        },
        message: 'Invalid webhook URL format'
      }
    },
    isEnabled: {
      type: Boolean,
      default: true
    },
    authHeaders: {
      type: Schema.Types.Mixed,
      default: {}
    },
    messageTypes: {
      text: { type: Boolean, default: true },
      image: { type: Boolean, default: true },
      audio: { type: Boolean, default: true },
      video: { type: Boolean, default: true },
      document: { type: Boolean, default: true },
      sticker: { type: Boolean, default: true },
      location: { type: Boolean, default: true },
      contact: { type: Boolean, default: true },
      voice: { type: Boolean, default: true },
      poll: { type: Boolean, default: true },
      poll_vote: { type: Boolean, default: true },
      product: { type: Boolean, default: true },
      order: { type: Boolean, default: true },
      button_response: { type: Boolean, default: true },
      list_response: { type: Boolean, default: true }
    },
    retryConfig: {
      maxRetries: { type: Number, default: 3 },
      retryDelay: { type: Number, default: 1000 },
      backoffMultiplier: { type: Number, default: 2 }
    },
    lastDeliveryAttempt: Date,
    lastSuccessfulDelivery: Date,
    failedDeliveries: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

// Ensure unique webhook config per device
WebhookConfigSchema.index({ deviceId: 1 }, { unique: true });

// Index for user queries
WebhookConfigSchema.index({ userId: 1 });

export default model<IWebhookConfig>('WebhookConfig', WebhookConfigSchema);
