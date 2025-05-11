import mongoose, { Document, Schema } from 'mongoose';

export interface IDevice extends Document {
  name: string;
  user: mongoose.Types.ObjectId;
  status: 'disconnected' | 'connecting' | 'connected';
  whatsappInfo?: {
    name?: string;
    number?: string;
    profilePicUrl?: string;
  };
  sessionInfo?: {
    exists: boolean;
    lastActive?: Date;
    lastReconnect?: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

const deviceSchema = new Schema<IDevice>(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    status: {
      type: String,
      enum: ['disconnected', 'connecting', 'connected'],
      default: 'disconnected'
    },
    whatsappInfo: {
      name: String,
      number: String,
      profilePicUrl: String
    },
    sessionInfo: {
      exists: {
        type: Boolean,
        default: false
      },
      lastActive: Date,
      lastReconnect: Date
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model<IDevice>('Device', deviceSchema);
