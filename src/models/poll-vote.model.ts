import mongoose, { Document, Schema } from 'mongoose';

export interface IPollVote extends Document {
  deviceId: string;
  messageId: string;
  pollMessageId: string;
  voter: string;
  selectedOptions: Array<{
    id: number;
    name: string;
  }>;
  interractedAtTs: number;
  createdAt: Date;
  updatedAt: Date;
}

const PollVoteSchema: Schema = new Schema({
  deviceId: {
    type: String,
    required: true,
    index: true
  },
  messageId: {
    type: String,
    required: true,
    index: true
  },
  pollMessageId: {
    type: String,
    required: true,
    index: true
  },
  voter: {
    type: String,
    required: true,
    index: true
  },
  selectedOptions: [{
    id: {
      type: Number,
      required: true
    },
    name: {
      type: String,
      required: true
    }
  }],
  interractedAtTs: {
    type: Number,
    required: true
  }
}, {
  timestamps: true
});

// Compound indexes for efficient queries
PollVoteSchema.index({ deviceId: 1, pollMessageId: 1 });
PollVoteSchema.index({ deviceId: 1, voter: 1 });
PollVoteSchema.index({ pollMessageId: 1, voter: 1 });

export default mongoose.model<IPollVote>('PollVote', PollVoteSchema);
