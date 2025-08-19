import mongoose, { Document, Schema } from 'mongoose';

export interface IBusinessMessage extends Document {
  deviceId: string;
  messageId: string;
  messageType: 'product' | 'order';
  
  // Product information
  product?: {
    id: string;
    name: string;
    price: string;
    currency: string;
    quantity: number;
    thumbnailUrl?: string;
    data?: any;
  };
  
  // Order information
  order?: {
    createdAt: number;
    currency: string;
    subtotal: string;
    total: string;
  };
  
  // Message metadata
  from: string;
  to: string;
  timestamp: number;
  
  createdAt: Date;
  updatedAt: Date;
}

const BusinessMessageSchema: Schema = new Schema({
  deviceId: {
    type: String,
    required: true,
    index: true
  },
  messageId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  messageType: {
    type: String,
    required: true,
    enum: ['product', 'order'],
    index: true
  },
  product: {
    id: String,
    name: String,
    price: String,
    currency: String,
    quantity: Number,
    thumbnailUrl: String,
    data: Schema.Types.Mixed
  },
  order: {
    createdAt: Number,
    currency: String,
    subtotal: String,
    total: String
  },
  from: {
    type: String,
    required: true,
    index: true
  },
  to: {
    type: String,
    required: true,
    index: true
  },
  timestamp: {
    type: Number,
    required: true,
    index: true
  }
}, {
  timestamps: true
});

// Compound indexes for efficient queries
BusinessMessageSchema.index({ deviceId: 1, messageType: 1 });
BusinessMessageSchema.index({ deviceId: 1, from: 1 });
BusinessMessageSchema.index({ deviceId: 1, timestamp: -1 });

export default mongoose.model<IBusinessMessage>('BusinessMessage', BusinessMessageSchema);
