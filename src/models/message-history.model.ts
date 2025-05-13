import mongoose, { Document, Schema } from 'mongoose';

export interface IMessageHistory extends Document {
  deviceId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  recipient: string;
  message: string;
  messageType: string;
  status: string;
  timestamp: Date;
}

const messageHistorySchema = new Schema({
  deviceId: {
    type: Schema.Types.ObjectId,
    ref: 'Device',
    required: true
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  recipient: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  messageType: {
    type: String,
    default: 'text'
  },
  status: {
    type: String,
    default: 'sent'
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const MessageHistory = mongoose.model<IMessageHistory>('MessageHistory', messageHistorySchema);

export default MessageHistory;
