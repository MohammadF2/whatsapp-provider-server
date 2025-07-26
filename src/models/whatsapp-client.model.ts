import mongoose, { Document, Schema } from 'mongoose';

export interface IWhatsAppClient extends Document {
  deviceId: string;
  status: 'disconnected' | 'connecting' | 'connected';
  lastActive: Date;
  lastReconnect?: Date;
  sessionExists: boolean;
  sessionPath: string; // Full path to session directory
  sessionFiles?: string[]; // List of session files for verification
  clientConfig?: {
    authStrategy: string;
    puppeteerOptions?: any;
    webVersion?: string;
    webVersionCache?: any;
  };
  connectionInfo?: {
    isReady: boolean;
    isAuthenticated: boolean;
    batteryLevel?: number;
    isConnected: boolean;
    lastSeen?: Date;
  };
  metadata?: {
    name?: string;
    number?: string;
    wid?: string;
    platform?: string;
    phoneVersion?: string;
    pushname?: string;
    profilePicUrl?: string;
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
    sessionPath: {
      type: String,
      required: true
    },
    sessionFiles: [{
      type: String
    }],
    clientConfig: {
      authStrategy: String,
      puppeteerOptions: Schema.Types.Mixed,
      webVersion: String,
      webVersionCache: Schema.Types.Mixed
    },
    connectionInfo: {
      isReady: { type: Boolean, default: false },
      isAuthenticated: { type: Boolean, default: false },
      batteryLevel: Number,
      isConnected: { type: Boolean, default: false },
      lastSeen: Date
    },
    metadata: {
      name: String,
      number: String,
      wid: String,
      platform: String,
      phoneVersion: String,
      pushname: String,
      profilePicUrl: String
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
