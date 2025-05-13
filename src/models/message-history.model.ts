import mongoose, { Document, Schema } from 'mongoose';

export interface IMessageHistory extends Document {
  deviceId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  deviceName?: string;
  deviceNumber?: string;
  recipient: string;
  message: string;
  messageType: 'text' | 'image' | 'video' | 'audio' | 'document' | 'location' | 'contact' | 'voice';
  status: 'sent' | 'failed' | 'pending';
  errorMessage?: string;
  messageId?: string;
  mediaUrl?: string;
  caption?: string;
  metadata?: any;
  timestamp: Date;
}

const messageHistorySchema = new Schema({
  deviceId: {
    type: Schema.Types.ObjectId,
    ref: 'Device',
    required: true,
    index: true
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  deviceName: {
    type: String
  },
  deviceNumber: {
    type: String
  },
  recipient: {
    type: String,
    required: true,
    index: true
  },
  message: {
    type: String,
    required: true
  },
  messageType: {
    type: String,
    enum: ['text', 'image', 'video', 'audio', 'document', 'location', 'contact', 'voice'],
    default: 'text',
    index: true
  },
  status: {
    type: String,
    enum: ['sent', 'failed', 'pending'],
    default: 'sent',
    index: true
  },
  errorMessage: {
    type: String
  },
  messageId: {
    type: String
  },
  mediaUrl: {
    type: String
  },
  caption: {
    type: String
  },
  metadata: {
    type: Schema.Types.Mixed
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
});

const MessageHistory = mongoose.model<IMessageHistory>('MessageHistory', messageHistorySchema);

export default MessageHistory;
