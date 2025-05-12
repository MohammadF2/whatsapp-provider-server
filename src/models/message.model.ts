import mongoose, { Document, Schema } from 'mongoose';

export interface IMessage extends Document {
  messageId: string;
  deviceId: string;
  chatId: string;
  content: string;
  contentType: 'text' | 'image' | 'video' | 'audio' | 'document' | 'location' | 'contact' | 'sticker';
  timestamp: Date;
  fromMe: boolean;
  sender?: {
    id: string;
    name?: string;
    pushname?: string;
  };
  quoted?: {
    id: string;
    content: string;
    sender?: string;
  };
  media?: {
    url?: string;
    mimetype: string;
    filename?: string;
    caption?: string;
  };
  location?: {
    latitude: number;
    longitude: number;
    address?: string;
  };
  contact?: {
    name: string;
    number: string;
  };
  hasMedia: boolean;
  isForwarded: boolean;
  isStarred: boolean;
  isStatus: boolean;
  isViewOnce: boolean;
  ack: number; // 0: pending, 1: sent, 2: delivered, 3: read
}

const MessageSchema = new Schema<IMessage>(
  {
    messageId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    deviceId: {
      type: String,
      required: true,
      index: true
    },
    chatId: {
      type: String,
      required: true,
      index: true
    },
    content: {
      type: String,
      required: true
    },
    contentType: {
      type: String,
      enum: ['text', 'image', 'video', 'audio', 'document', 'location', 'contact', 'sticker'],
      default: 'text'
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true
    },
    fromMe: {
      type: Boolean,
      default: false
    },
    sender: {
      id: String,
      name: String,
      pushname: String
    },
    quoted: {
      id: String,
      content: String,
      sender: String
    },
    media: {
      url: String,
      mimetype: String,
      filename: String,
      caption: String
    },
    location: {
      latitude: Number,
      longitude: Number,
      address: String
    },
    contact: {
      name: String,
      number: String
    },
    hasMedia: {
      type: Boolean,
      default: false
    },
    isForwarded: {
      type: Boolean,
      default: false
    },
    isStarred: {
      type: Boolean,
      default: false
    },
    isStatus: {
      type: Boolean,
      default: false
    },
    isViewOnce: {
      type: Boolean,
      default: false
    },
    ack: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

// Create compound indexes for common queries
MessageSchema.index({ deviceId: 1, chatId: 1, timestamp: -1 });
MessageSchema.index({ deviceId: 1, chatId: 1, fromMe: 1 });

const Message = mongoose.model<IMessage>('Message', MessageSchema);

export default Message;
