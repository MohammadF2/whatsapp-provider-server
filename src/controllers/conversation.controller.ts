import { Request, Response } from 'express';
import { activeClients } from '../services/whatsapp.service';
import Conversation from '../models/conversation.model';
import Message from '../models/message.model';
import Device from '../models/device.model';

/**
 * Get all conversations for a device
 * @param req Request
 * @param res Response
 */
export const getConversations = async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;
    const refresh = req.query.refresh === 'true';
    const userId = req.user._id;

    // Check if device exists and belongs to user
    const device = await Device.findOne({ _id: deviceId, user: userId });
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    // Check if device is connected
    if (device.status !== 'connected') {
      return res.status(400).json({ success: false, message: 'Device is not connected to WhatsApp' });
    }

    // If refresh is true, fetch conversations from WhatsApp
    if (refresh) {
      const client = await activeClients.getClient(deviceId);
      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'WhatsApp client not found or not connected'
        });
      }

      // Fetch chats from WhatsApp
      const chats = await client.getChats();

      // Update conversations in database
      for (const chat of chats) {
        const lastMessage = chat.lastMessage ? {
          content: chat.lastMessage.body,
          timestamp: chat.lastMessage.timestamp ? new Date(chat.lastMessage.timestamp * 1000) : new Date(),
          fromMe: chat.lastMessage.fromMe,
          sender: chat.lastMessage.author || undefined
        } : undefined;

        // Get participants for group chats
        let participants = [];
        if (chat.isGroup) {
          try {
            // Use getParticipants() method if available, or fallback to empty array
            const participantsObj = await (chat as any).getParticipants?.() || [];
            participants = participantsObj.map((p: any) => ({
              id: p.id._serialized,
              name: p.name || undefined,
              isAdmin: p.isAdmin || false
            }));
          } catch (error) {
            console.error(`Error fetching participants for chat ${chat.name}:`, error);
          }
        }

        // Update or create conversation
        await Conversation.findOneAndUpdate(
          { deviceId, chatId: chat.id._serialized },
          {
            name: chat.name,
            isGroup: chat.isGroup,
            lastMessage,
            unreadCount: chat.unreadCount,
            participants: chat.isGroup ? participants : [],
            lastUpdated: new Date()
          },
          { upsert: true, new: true }
        );
      }
    }

    // Get conversations from database
    const conversations = await Conversation.find({ deviceId }).sort({ 'lastMessage.timestamp': -1 });

    return res.status(200).json({
      success: true,
      conversations
    });
  } catch (error: any) {
    console.error('[Conversation] Error getting conversations:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get conversations',
      error: error.message
    });
  }
};

/**
 * Get messages for a specific conversation
 * @param req Request
 * @param res Response
 */
export const getMessages = async (req: Request, res: Response) => {
  try {
    const { deviceId, chatId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const before = req.query.before as string;
    const userId = req.user._id;

    // Check if device exists and belongs to user
    const device = await Device.findOne({ _id: deviceId, user: userId });
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    // Check if conversation exists
    const conversation = await Conversation.findOne({ deviceId, chatId });
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    // Build query
    const query: any = { deviceId, chatId };

    // If before is provided, get messages before that message
    if (before) {
      const beforeMessage = await Message.findOne({ messageId: before });
      if (beforeMessage) {
        query.timestamp = { $lt: beforeMessage.timestamp };
      }
    }

    // Get messages from database
    const messages = await Message.find(query)
      .sort({ timestamp: -1 })
      .limit(limit);

    return res.status(200).json({
      success: true,
      messages
    });
  } catch (error: any) {
    console.error('[Conversation] Error getting messages:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get messages',
      error: error.message
    });
  }
};

/**
 * Mark a conversation as read
 * @param req Request
 * @param res Response
 */
export const markAsRead = async (req: Request, res: Response) => {
  try {
    const { deviceId, chatId } = req.params;
    const userId = req.user._id;

    // Check if device exists and belongs to user
    const device = await Device.findOne({ _id: deviceId, user: userId });
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    // Check if conversation exists
    const conversation = await Conversation.findOne({ deviceId, chatId });
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    // Get WhatsApp client
    const client = await activeClients.getClient(deviceId);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'WhatsApp client not found or not connected'
      });
    }

    // Get chat from WhatsApp
    const chat = await client.getChatById(chatId);
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Chat not found in WhatsApp' });
    }

    // Mark chat as read
    await chat.sendSeen();

    // Update conversation in database
    await Conversation.findOneAndUpdate(
      { deviceId, chatId },
      { unreadCount: 0 }
    );

    return res.status(200).json({
      success: true,
      message: 'Conversation marked as read'
    });
  } catch (error: any) {
    console.error('[Conversation] Error marking conversation as read:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to mark conversation as read',
      error: error.message
    });
  }
};
