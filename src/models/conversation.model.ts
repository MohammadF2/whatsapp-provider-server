import mongoose, { Document, Schema } from 'mongoose';

export interface IConversation extends Document {
  deviceId: string;
  chatId: string;
  name: string;
  isGroup: boolean;
  lastMessage?: {
    content: string;
    timestamp: Date;
    fromMe: boolean;
    sender?: string;
  };
  unreadCount?: number;
  profilePicUrl?: string;
  participants?: {
    id: string;
    name?: string;
    isAdmin?: boolean;
  }[];
  lastUpdated: Date;
}

const ConversationSchema = new Schema<IConversation>(
  {
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
    name: {
      type: String,
      required: true
    },
    isGroup: {
      type: Boolean,
      default: false
    },
    lastMessage: {
      content: String,
      timestamp: Date,
      fromMe: Boolean,
      sender: String
    },
    unreadCount: {
      type: Number,
      default: 0
    },
    profilePicUrl: String,
    participants: [
      {
        id: String,
        name: String,
        isAdmin: Boolean
      }
    ],
    lastUpdated: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

// Create a compound index for deviceId and chatId
ConversationSchema.index({ deviceId: 1, chatId: 1 }, { unique: true });

const Conversation = mongoose.model<IConversation>('Conversation', ConversationSchema);

export default Conversation;
