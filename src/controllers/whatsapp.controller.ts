import { Request, Response } from 'express';
import Device from '../models/device.model';
import {
  sendMessage,
  disconnectWhatsAppClient,
  testWhatsAppConnection as testWhatsAppConnectionService,
  activeClients
} from '../services/whatsapp.service';
import { MessageMedia } from 'whatsapp-web.js';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Send a message
export const sendWhatsAppMessage = async (req: Request, res: Response) => {
  try {
    console.log('[WhatsApp Controller] Send message request received');
    const { deviceId, to, message } = req.body;
    const userId = req.user._id;
    console.log(`[WhatsApp Controller] Device ID: ${deviceId}, To: ${to}, Message: ${message}, User ID: ${userId}`);

    // Check if device exists and belongs to user
    const device = await Device.findOne({ _id: deviceId, user: userId });
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    // Check if device is connected
    if (device.status !== 'connected') {
      return res.status(400).json({ message: 'Device is not connected to WhatsApp' });
    }

    // Send message

    const result = await sendMessage(deviceId, to, message);
    if (result.success) {
      res.json({ success: true, messageId: result.messageId });
    } else {
      // Check if the device needs to be reconnected
      if (result.needsReconnect) {
        // Update device status to disconnected
        await Device.findByIdAndUpdate(deviceId, { status: 'disconnected' });

        // Return a specific status code for reconnection needed
        return res.status(401).json({
          success: false,
          message: result.message,
          needsReconnect: true,
          deviceId: deviceId
        });
      }

      // For temporary errors, use a different status code
      if (result.temporary) {
        return res.status(503).json({
          success: false,
          message: result.message,
          temporary: true,
          deviceId: deviceId
        });
      }

      // For other errors
      res.status(500).json({
        success: false,
        message: result.message,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Send WhatsApp message error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Disconnect WhatsApp
export const disconnectWhatsApp = async (req: Request, res: Response) => {
  try {
    const deviceId = req.params.deviceId;
    const userId = req.user._id;

    // Check if device exists and belongs to user
    const device = await Device.findOne({ _id: deviceId, user: userId });
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    // Disconnect WhatsApp client
    const result = await disconnectWhatsAppClient(deviceId);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(500).json({ message: result.message });
    }
  } catch (error) {
    console.error('Disconnect WhatsApp error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Test WhatsApp connection
export const testWhatsAppConnection = async (req: Request, res: Response) => {
  try {
    const deviceId = req.params.deviceId;
    const userId = req.user._id;

    console.log(`[WhatsApp Controller] Testing connection for device ${deviceId}, user ${userId}`);

    // Check if device exists and belongs to user
    const device = await Device.findOne({ _id: deviceId, user: userId });
    if (!device) {
      console.log(`[WhatsApp Controller] Device not found: ${deviceId}`);
      return res.status(404).json({ message: 'Device not found' });
    }

    // Check if device is connected
    if (device.status !== 'connected') {
      console.log(`[WhatsApp Controller] Device not connected: ${deviceId}, status: ${device.status}`);
      return res.status(400).json({
        message: 'Device is not connected to WhatsApp',
        status: device.status
      });
    }

    console.log(`[WhatsApp Controller] Testing WhatsApp connection for device ${deviceId}`);
    // Test WhatsApp connection
    const result = await testWhatsAppConnectionService(deviceId);

    console.log(`[WhatsApp Controller] Test result for device ${deviceId}:`, result);
    if (result.success) {
      res.json(result);
    } else {
      // Check if the device needs to be reconnected
      if (result.needsReconnect) {
        // Update device status to disconnected
        await Device.findByIdAndUpdate(deviceId, { status: 'disconnected' });

        // Return a specific status code for reconnection needed
        return res.status(401).json({
          success: false,
          message: result.message,
          needsReconnect: true,
          deviceId: deviceId,
          ...result
        });
      }

      // For temporary errors, use a different status code
      if (result.temporary) {
        return res.status(503).json({
          success: false,
          message: result.message,
          temporary: true,
          deviceId: deviceId,
          ...result
        });
      }

      // For other errors
      res.status(500).json(result);
    }
  } catch (error) {
    const errorDeviceId = req.params.deviceId; // Store deviceId in a local variable to use in catch block
    console.error(`[WhatsApp Controller] Test connection error for device ${errorDeviceId}:`, error);
    res.status(500).json({
      message: 'Server error',
      error: error.message,
      stack: error.stack
    });
  }
};

// Send a text message (new API)
export const sendTextMessage = async (req: Request, res: Response) => {
  try {
    const { deviceId, to, content } = req.body;
    const userId = req.user._id;

    if (!deviceId || !to || !content) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: deviceId, to, content'
      });
    }

    // Check if device exists and belongs to user
    const device = await Device.findOne({ _id: deviceId, user: userId });
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    // Check if device is connected
    if (device.status !== 'connected') {
      return res.status(400).json({ success: false, message: 'Device is not connected to WhatsApp' });
    }

    // Get the WhatsApp client
    const client = await activeClients.getClient(deviceId);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'WhatsApp client not found or not connected'
      });
    }

    // Format the phone number
    const formattedNumber = formatPhoneNumber(to);

    // Send the message
    const message = await client.sendMessage(formattedNumber, content);

    return res.status(200).json({
      success: true,
      messageId: message.id._serialized
    });
  } catch (error: any) {
    console.error('[WhatsApp] Error sending text message:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send message',
      error: error.message
    });
  }
};

// Send a file (image, document, audio, video)
export const sendFileMessage = async (req: Request, res: Response) => {
  try {
    const { deviceId, to, type, caption } = req.body;
    const userId = req.user._id;
    const file = req.file;

    if (!deviceId || !to || !type || !file) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: deviceId, to, type, file'
      });
    }

    // Check if device exists and belongs to user
    const device = await Device.findOne({ _id: deviceId, user: userId });
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    // Check if device is connected
    if (device.status !== 'connected') {
      return res.status(400).json({ success: false, message: 'Device is not connected to WhatsApp' });
    }

    // Get the WhatsApp client
    const client = await activeClients.getClient(deviceId);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'WhatsApp client not found or not connected'
      });
    }

    // Format the phone number
    const formattedNumber = formatPhoneNumber(to);

    // Create message media from file
    const media = MessageMedia.fromFilePath(file.path);

    // Send the media message
    const message = await client.sendMessage(formattedNumber, media, {
      caption: caption || undefined,
      sendMediaAsDocument: type === 'document'
    });

    // Clean up the temporary file
    fs.unlinkSync(file.path);

    return res.status(200).json({
      success: true,
      messageId: message.id._serialized
    });
  } catch (error: any) {
    console.error('[WhatsApp] Error sending file:', error);

    // Clean up the temporary file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to send file',
      error: error.message
    });
  }
};

// Send a location message
export const sendLocationMessage = async (req: Request, res: Response) => {
  try {
    const { deviceId, to, content } = req.body;
    const userId = req.user._id;

    if (!deviceId || !to || !content) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: deviceId, to, content'
      });
    }

    // Check if device exists and belongs to user
    const device = await Device.findOne({ _id: deviceId, user: userId });
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    // Check if device is connected
    if (device.status !== 'connected') {
      return res.status(400).json({ success: false, message: 'Device is not connected to WhatsApp' });
    }

    // Parse the location data
    let location;
    try {
      location = JSON.parse(content);
    } catch (e) {
      return res.status(400).json({
        success: false,
        message: 'Invalid location data'
      });
    }

    if (!location.latitude || !location.longitude) {
      return res.status(400).json({
        success: false,
        message: 'Location must include latitude and longitude'
      });
    }

    // Get the WhatsApp client
    const client = await activeClients.getClient(deviceId);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'WhatsApp client not found or not connected'
      });
    }

    // Format the phone number
    const formattedNumber = formatPhoneNumber(to);

    // Create location object
    const locationObject = {
      latitude: location.latitude,
      longitude: location.longitude,
      name: location.name || undefined,
      address: location.address || undefined
    };

    // Send the location
    const message = await client.sendMessage(formattedNumber, locationObject);

    return res.status(200).json({
      success: true,
      messageId: message.id._serialized
    });
  } catch (error: any) {
    console.error('[WhatsApp] Error sending location:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send location',
      error: error.message
    });
  }
};

// Send a contact message
export const sendContactMessage = async (req: Request, res: Response) => {
  try {
    const { deviceId, to, content } = req.body;
    const userId = req.user._id;

    if (!deviceId || !to || !content) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: deviceId, to, content'
      });
    }

    // Check if device exists and belongs to user
    const device = await Device.findOne({ _id: deviceId, user: userId });
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    // Check if device is connected
    if (device.status !== 'connected') {
      return res.status(400).json({ success: false, message: 'Device is not connected to WhatsApp' });
    }

    // Parse the contact data
    let contact;
    try {
      contact = JSON.parse(content);
    } catch (e) {
      return res.status(400).json({
        success: false,
        message: 'Invalid contact data'
      });
    }

    if (!contact.name || !contact.phones || !contact.phones.length) {
      return res.status(400).json({
        success: false,
        message: 'Contact must include name and at least one phone number'
      });
    }

    // Get the WhatsApp client
    const client = await activeClients.getClient(deviceId);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'WhatsApp client not found or not connected'
      });
    }

    // Format the phone number
    const formattedNumber = formatPhoneNumber(to);

    // Create vCard
    const vCard = createVCard(contact);

    // Send the contact as vCard
    const media = new MessageMedia('text/vcard', Buffer.from(vCard).toString('base64'), `${contact.name}.vcf`);
    const message = await client.sendMessage(formattedNumber, media);

    return res.status(200).json({
      success: true,
      messageId: message.id._serialized
    });
  } catch (error: any) {
    console.error('[WhatsApp] Error sending contact:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send contact',
      error: error.message
    });
  }
};

// Helper function to format phone number
const formatPhoneNumber = (phone: string): string => {
  // If it's already a properly formatted group ID, return it as is
  if (phone.endsWith('@g.us')) {
    return phone;
  }

  // If it's already a properly formatted individual ID, return it as is
  if (phone.endsWith('@c.us')) {
    return phone;
  }

  // If it looks like a group ID (contains hyphens or is very long)
  if (phone.includes('-') || (phone.length > 15 && !phone.includes('@'))) {
    return `${phone}@g.us`;
  }

  // Remove any non-digit characters for regular phone numbers
  const digits = phone.replace(/\D/g, '');

  // Regular phone number
  return `${digits}@c.us`;
};

// Helper function to create vCard
const createVCard = (contact: any): string => {
  let vCard = 'BEGIN:VCARD\n';
  vCard += 'VERSION:3.0\n';
  vCard += `FN:${contact.name}\n`;
  vCard += `N:${contact.name};;;;\n`;

  // Add phone numbers
  contact.phones.forEach((phone: string, index: number) => {
    vCard += `TEL;type=CELL${index === 0 ? ';type=pref' : ''}:${phone}\n`;
  });

  // Add emails if available
  if (contact.emails && contact.emails.length) {
    contact.emails.forEach((email: string, index: number) => {
      vCard += `EMAIL${index === 0 ? ';type=pref' : ''}:${email}\n`;
    });
  }

  vCard += 'END:VCARD';
  return vCard;
};