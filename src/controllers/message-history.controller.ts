import { Request, Response } from 'express';
import MessageHistory from '../models/message-history.model';

/**
 * Get message history for a user
 */
export const getMessageHistory = async (req: Request, res: Response) => {
  try {
    const userId = req.user._id;
    const { limit = 50, page = 1 } = req.query;
    
    // Calculate pagination
    const skip = (Number(page) - 1) * Number(limit);
    
    // Get message history
    const messages = await MessageHistory.find({ userId })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(Number(limit));
    
    // Get total count
    const total = await MessageHistory.countDocuments({ userId });
    
    return res.status(200).json({
      success: true,
      messages,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error: any) {
    console.error('[MessageHistory] Error getting message history:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get message history',
      error: error.message
    });
  }
};
