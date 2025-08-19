import { Schema, Document, model } from 'mongoose';

export interface IWebhookDelivery extends Document {
  deviceId: string;
  webhookConfigId: string;
  messageId: string;
  webhookUrl: string;
  payload: any;
  status: 'pending' | 'success' | 'failed' | 'retrying';
  httpStatus?: number;
  responseBody?: string;
  errorMessage?: string;
  attemptCount: number;
  maxRetries: number;
  nextRetryAt?: Date;
  deliveredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WebhookDeliverySchema = new Schema<IWebhookDelivery>(
  {
    deviceId: {
      type: String,
      required: true,
      index: true
    },
    webhookConfigId: {
      type: String,
      required: true,
      index: true
    },
    messageId: {
      type: String,
      required: true,
      index: true
    },
    webhookUrl: {
      type: String,
      required: true
    },
    payload: {
      type: Schema.Types.Mixed,
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'success', 'failed', 'retrying'],
      default: 'pending',
      index: true
    },
    httpStatus: Number,
    responseBody: String,
    errorMessage: String,
    attemptCount: {
      type: Number,
      default: 0
    },
    maxRetries: {
      type: Number,
      required: true
    },
    nextRetryAt: Date,
    deliveredAt: Date
  },
  {
    timestamps: true
  }
);

// Index for retry processing
WebhookDeliverySchema.index({ 
  status: 1, 
  nextRetryAt: 1 
});

// Index for cleanup and analytics
WebhookDeliverySchema.index({ 
  createdAt: 1 
});

// TTL index to automatically delete old delivery logs after 30 days
WebhookDeliverySchema.index({ 
  createdAt: 1 
}, { 
  expireAfterSeconds: 30 * 24 * 60 * 60 // 30 days
});

export default model<IWebhookDelivery>('WebhookDelivery', WebhookDeliverySchema);
