import mongoose, { Document, Schema } from 'mongoose';

export interface IWhatsAppClient extends Document {
  deviceId: string;
  status: 'disconnected' | 'connecting' | 'connected';
  lastActive: Date;
  lastReconnect?: Date;
  sessionExists: boolean;
  metadata?: {
    name?: string;
    number?: string;
    wid?: string;
    platform?: string;
    phoneVersion?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const WhatsAppClientSchema = new Schema<IWhatsAppClient>(
  {
    deviceId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    status: {
      type: String,
      enum: ['disconnected', 'connecting', 'connected'],
      default: 'disconnected'
    },
    lastActive: {
      type: Date,
      default: Date.now
    },
    lastReconnect: {
      type: Date
    },
    sessionExists: {
      type: Boolean,
      default: false
    },
    metadata: {
      name: String,
      number: String,
      wid: String,
      platform: String,
      phoneVersion: String
    }
  },
  {
    timestamps: true
  }
);

// Create indexes for better query performance
WhatsAppClientSchema.index({ deviceId: 1 });
WhatsAppClientSchema.index({ status: 1 });
WhatsAppClientSchema.index({ lastActive: 1 });

const WhatsAppClient = mongoose.model<IWhatsAppClient>('WhatsAppClient', WhatsAppClientSchema);

export default WhatsAppClient;
