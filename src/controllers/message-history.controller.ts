import { Request, Response } from 'express';
import MessageHistory from '../models/message-history.model';
import Device from '../models/device.model';
import mongoose from 'mongoose';

/**
 * Get message history for a user with filtering and sorting
 */
export const getMessageHistory = async (req: Request, res: Response) => {
  try {
    const userId = req.user._id;
    const {
      limit = 50,
      page = 1,
      deviceId,
      status,
      messageType,
      recipient,
      startDate,
      endDate,
      sortBy = 'timestamp',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    const query: any = { userId };

    // Add filters if provided
    if (deviceId) {
      query.deviceId = new mongoose.Types.ObjectId(deviceId as string);
    }

    if (status) {
      query.status = status;
    }

    if (messageType) {
      query.messageType = messageType;
    }

    if (recipient) {
      query.recipient = { $regex: recipient, $options: 'i' };
    }

    // Date range filter
    if (startDate || endDate) {
      query.timestamp = {};

      if (startDate) {
        query.timestamp.$gte = new Date(startDate as string);
      }

      if (endDate) {
        query.timestamp.$lte = new Date(endDate as string);
      }
    }

    // Calculate pagination
    const skip = (Number(page) - 1) * Number(limit);

    // Determine sort order
    const sort: any = {};
    sort[sortBy as string] = sortOrder === 'asc' ? 1 : -1;

    // Get message history
    const messages = await MessageHistory.find(query)
      .sort(sort)
      .skip(skip)
      .limit(Number(limit))
      .populate('deviceId', 'name whatsappInfo');

    // Get total count
    const total = await MessageHistory.countDocuments(query);

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

/**
 * Get message history for a specific device
 */
export const getDeviceMessageHistory = async (req: Request, res: Response) => {
  try {
    const userId = req.user._id;
    const deviceId = req.params.deviceId;
    const {
      limit = 50,
      page = 1,
      status,
      messageType,
      recipient,
      startDate,
      endDate,
      sortBy = 'timestamp',
      sortOrder = 'desc'
    } = req.query;

    // Verify device belongs to user
    const device = await Device.findOne({ _id: deviceId, user: userId });
    if (!device) {
      return res.status(404).json({
        success: false,
        message: 'Device not found'
      });
    }

    // Build query
    const query: any = {
      userId,
      deviceId: new mongoose.Types.ObjectId(deviceId)
    };

    // Add filters if provided
    if (status) {
      query.status = status;
    }

    if (messageType) {
      query.messageType = messageType;
    }

    if (recipient) {
      query.recipient = { $regex: recipient, $options: 'i' };
    }

    // Date range filter
    if (startDate || endDate) {
      query.timestamp = {};

      if (startDate) {
        query.timestamp.$gte = new Date(startDate as string);
      }

      if (endDate) {
        query.timestamp.$lte = new Date(endDate as string);
      }
    }

    // Calculate pagination
    const skip = (Number(page) - 1) * Number(limit);

    // Determine sort order
    const sort: any = {};
    sort[sortBy as string] = sortOrder === 'asc' ? 1 : -1;

    // Get message history
    const messages = await MessageHistory.find(query)
      .sort(sort)
      .skip(skip)
      .limit(Number(limit));

    // Get total count
    const total = await MessageHistory.countDocuments(query);

    return res.status(200).json({
      success: true,
      messages,
      device,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error: any) {
    console.error('[MessageHistory] Error getting device message history:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get device message history',
      error: error.message
    });
  }
};
