import { Request, Response } from 'express';
import Device from '../models/device.model';
import MessageHistory from '../models/message-history.model';
import {
  sendMessage,
  disconnectWhatsAppClient,
  testWhatsAppConnection as testWhatsAppConnectionService,
  activeClients
} from '../services/whatsapp.service';
import { 
  sendMessageWithSelenium, 
  disconnectWhatsAppClientWithSelenium 
} from '../services/whatsapp-selenium.service';
import { MessageMedia, Poll, Buttons } from 'whatsapp-web.js';
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

    // Determine whether to use Selenium based on device configuration
    let result;
    if (device.seleniumConfig?.browserType) {
      console.log(`[WhatsApp Controller] Using Selenium for device ${deviceId}`);
      result = await sendMessageWithSelenium(deviceId, to, message);
    } else {
      console.log(`[WhatsApp Controller] Using default WhatsApp client for device ${deviceId}`);
      result = await sendMessage(deviceId, to, message);
    }
    
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

    // Determine whether to use Selenium based on device configuration
    let result;
    if (device.seleniumConfig?.browserType) {
      console.log(`[WhatsApp Controller] Using Selenium to disconnect device ${deviceId}`);
      result = await disconnectWhatsAppClientWithSelenium(deviceId);
    } else {
      console.log(`[WhatsApp Controller] Using default method to disconnect device ${deviceId}`);
      result = await disconnectWhatsAppClient(deviceId);
    }

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

    // Get the WhatsApp client - try memory first, then database
    let client = activeClients.getClientSync(deviceId);
    if (!client) {
      console.log(`[WhatsApp Controller] Client not found in memory for device ${deviceId}, checking database`);
      client = await activeClients.getClient(deviceId);
    }

    if (!client) {
      console.log(`[WhatsApp Controller] Client not found in memory or database for device ${deviceId}`);
      return res.status(404).json({
        success: false,
        message: 'WhatsApp client not found or not connected'
      });
    }

    console.log(`[WhatsApp Controller] Client found for device ${deviceId}`);

    // Format the phone number
    const formattedNumber = formatPhoneNumber(to);

    // Send the message
    const message = await client.sendMessage(formattedNumber, content);

    // Store the message in the database
    await MessageHistory.create({
      deviceId,
      userId,
      deviceName: device.name,
      deviceNumber: device.whatsappInfo?.number,
      recipient: formattedNumber,
      message: content,
      messageType: 'text',
      status: 'sent',
      messageId: message.id._serialized,
      timestamp: new Date()
    });

    return res.status(200).json({
      success: true,
      messageId: message.id._serialized
    });
  } catch (error: any) {
    console.error('[WhatsApp] Error sending text message:', error);

    // Store the failed message in the database
    try {
      const { deviceId, to, content } = req.body;
      const userId = req.user._id;
      const device = await Device.findOne({ _id: deviceId, user: userId });

      await MessageHistory.create({
        deviceId,
        userId,
        deviceName: device?.name,
        deviceNumber: device?.whatsappInfo?.number,
        recipient: formatPhoneNumber(to),
        message: content,
        messageType: 'text',
        status: 'failed',
        errorMessage: error.message,
        timestamp: new Date()
      });
    } catch (dbError) {
      console.error('[WhatsApp] Error storing failed message:', dbError);
    }

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

    // Get the WhatsApp client - try memory first, then database
    let client = activeClients.getClientSync(deviceId);
    if (!client) {
      console.log(`[WhatsApp Controller] Client not found in memory for device ${deviceId}, checking database`);
      client = await activeClients.getClient(deviceId);
    }

    if (!client) {
      console.log(`[WhatsApp Controller] Client not found in memory or database for device ${deviceId}`);
      return res.status(404).json({
        success: false,
        message: 'WhatsApp client not found or not connected'
      });
    }

    console.log(`[WhatsApp Controller] Client found for device ${deviceId}`);

    // Format the phone number
    const formattedNumber = formatPhoneNumber(to);

    // Create message media from file
    const media = MessageMedia.fromFilePath(file.path);

    // Send the media message
    const message = await client.sendMessage(formattedNumber, media, {
      caption: caption || undefined,
      sendMediaAsDocument: type === 'document'
    });

    // Store the message in the database
    await MessageHistory.create({
      deviceId,
      userId,
      deviceName: device.name,
      deviceNumber: device.whatsappInfo?.number,
      recipient: formattedNumber,
      message: caption || `[${type.toUpperCase()}]`,
      messageType: type,
      status: 'sent',
      messageId: message.id._serialized,
      mediaUrl: file.path,
      caption: caption,
      timestamp: new Date()
    });

    // Clean up the temporary file
    fs.unlinkSync(file.path);

    return res.status(200).json({
      success: true,
      messageId: message.id._serialized
    });
  } catch (error: any) {
    console.error('[WhatsApp] Error sending file:', error);

    // Store the failed message in the database
    try {
      const { deviceId, to, type, caption } = req.body;
      const userId = req.user._id;
      const file = req.file;
      const device = await Device.findOne({ _id: deviceId, user: userId });

      await MessageHistory.create({
        deviceId,
        userId,
        deviceName: device?.name,
        deviceNumber: device?.whatsappInfo?.number,
        recipient: formatPhoneNumber(to),
        message: caption || `[${type.toUpperCase()}]`,
        messageType: type,
        status: 'failed',
        errorMessage: error.message,
        mediaUrl: file?.path,
        caption: caption,
        timestamp: new Date()
      });
    } catch (dbError) {
      console.error('[WhatsApp] Error storing failed message:', dbError);
    }

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
    const { deviceId, to, latitude, longitude, description } = req.body;
    const userId = req.user._id;

    if (!deviceId || !to || !latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: deviceId, to, latitude, longitude'
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

    // Validate latitude and longitude
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude must be numbers'
      });
    }

    if (latitude < -90 || latitude > 90) {
      return res.status(400).json({
        success: false,
        message: 'Latitude must be between -90 and 90'
      });
    }

    if (longitude < -180 || longitude > 180) {
      return res.status(400).json({
        success: false,
        message: 'Longitude must be between -180 and 180'
      });
    }

    // Get the WhatsApp client - try memory first, then database
    let client = activeClients.getClientSync(deviceId);
    if (!client) {
      console.log(`[WhatsApp Controller] Client not found in memory for device ${deviceId}, checking database`);
      client = await activeClients.getClient(deviceId);
    }

    if (!client) {
      console.log(`[WhatsApp Controller] Client not found in memory or database for device ${deviceId}`);
      return res.status(404).json({
        success: false,
        message: 'WhatsApp client not found or not connected'
      });
    }

    console.log(`[WhatsApp Controller] Client found for device ${deviceId}`);

    // Format the phone number
    const formattedNumber = formatPhoneNumber(to);

    // Create location object (WhatsApp.js expects string values)
    const locationObject = {
      latitude: latitude.toString(),
      longitude: longitude.toString(),
      name: description || undefined,
      address: description || undefined
    };

    // Send the location
    const message = await client.sendMessage(formattedNumber, locationObject);

    // Store the message in the database
    await MessageHistory.create({
      deviceId,
      userId,
      deviceName: device.name,
      deviceNumber: device.whatsappInfo?.number,
      recipient: formattedNumber,
      message: `Location: ${description || `${latitude},${longitude}`}`,
      messageType: 'location',
      status: 'sent',
      messageId: message.id._serialized,
      metadata: location,
      timestamp: new Date()
    });

    return res.status(200).json({
      success: true,
      messageId: message.id._serialized
    });
  } catch (error: any) {
    console.error('[WhatsApp] Error sending location:', error);

    // Store the failed message in the database
    try {
      const { deviceId, to, content } = req.body;
      const userId = req.user._id;
      const device = await Device.findOne({ _id: deviceId, user: userId });
      let locationData;

      try {
        locationData = JSON.parse(content);
      } catch (e) {
        locationData = { error: 'Invalid location data' };
      }

      await MessageHistory.create({
        deviceId,
        userId,
        deviceName: device?.name,
        deviceNumber: device?.whatsappInfo?.number,
        recipient: formatPhoneNumber(to),
        message: `Location: ${locationData.name || 'Unknown location'}`,
        messageType: 'location',
        status: 'failed',
        errorMessage: error.message,
        metadata: locationData,
        timestamp: new Date()
      });
    } catch (dbError) {
      console.error('[WhatsApp] Error storing failed location message:', dbError);
    }

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
    const { deviceId, to, contact } = req.body;
    const userId = req.user._id;

    if (!deviceId || !to || !contact) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: deviceId, to, contact'
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

    // Validate contact data (contact is already parsed from req.body)
    if (!contact.name || !contact.phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Contact must include name and phoneNumber'
      });
    }

    if (typeof contact.name !== 'string' || typeof contact.phoneNumber !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Contact name and phoneNumber must be strings'
      });
    }

    // Get the WhatsApp client - try memory first, then database
    let client = activeClients.getClientSync(deviceId);
    if (!client) {
      console.log(`[WhatsApp Controller] Client not found in memory for device ${deviceId}, checking database`);
      client = await activeClients.getClient(deviceId);
    }

    if (!client) {
      console.log(`[WhatsApp Controller] Client not found in memory or database for device ${deviceId}`);
      return res.status(404).json({
        success: false,
        message: 'WhatsApp client not found or not connected'
      });
    }

    console.log(`[WhatsApp Controller] Client found for device ${deviceId}`);

    // Format the phone number
    const formattedNumber = formatPhoneNumber(to);

    // Create vCard
    const vCard = createVCard(contact);

    // Send the contact as vCard
    const media = new MessageMedia('text/vcard', Buffer.from(vCard).toString('base64'), `${contact.name}.vcf`);
    const message = await client.sendMessage(formattedNumber, media);

    // Store the message in the database
    await MessageHistory.create({
      deviceId,
      userId,
      deviceName: device.name,
      deviceNumber: device.whatsappInfo?.number,
      recipient: formattedNumber,
      message: `Contact: ${contact.name}`,
      messageType: 'contact',
      status: 'sent',
      messageId: message.id._serialized,
      metadata: contact,
      timestamp: new Date()
    });

    return res.status(200).json({
      success: true,
      messageId: message.id._serialized
    });
  } catch (error: any) {
    console.error('[WhatsApp] Error sending contact:', error);

    // Store the failed message in the database
    try {
      const { deviceId, to, content } = req.body;
      const userId = req.user._id;
      const device = await Device.findOne({ _id: deviceId, user: userId });
      let contactData;

      try {
        contactData = JSON.parse(content);
      } catch (e) {
        contactData = { error: 'Invalid contact data' };
      }

      await MessageHistory.create({
        deviceId,
        userId,
        deviceName: device?.name,
        deviceNumber: device?.whatsappInfo?.number,
        recipient: formatPhoneNumber(to),
        message: `Contact: ${contactData.name || 'Unknown contact'}`,
        messageType: 'contact',
        status: 'failed',
        errorMessage: error.message,
        metadata: contactData,
        timestamp: new Date()
      });
    } catch (dbError) {
      console.error('[WhatsApp] Error storing failed contact message:', dbError);
    }

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

  // Add phone numbers - handle both phoneNumber (singular) and phones (array) formats
  if (contact.phoneNumber) {
    // Single phone number format (from Swagger API)
    vCard += `TEL;type=CELL;type=pref:${contact.phoneNumber}\n`;
  } else if (contact.phones && Array.isArray(contact.phones)) {
    // Multiple phone numbers format (legacy)
    contact.phones.forEach((phone: string, index: number) => {
      vCard += `TEL;type=CELL${index === 0 ? ';type=pref' : ''}:${phone}\n`;
    });
  }

  // Add emails if available
  if (contact.emails && contact.emails.length) {
    contact.emails.forEach((email: string, index: number) => {
      vCard += `EMAIL${index === 0 ? ';type=pref' : ''}:${email}\n`;
    });
  }

  vCard += 'END:VCARD';
  return vCard;
};

// Send a poll message
export const sendPollMessage = async (req: Request, res: Response) => {
  try {
    const { deviceId, to, pollName, pollOptions, allowMultipleAnswers = false, messageSecret } = req.body;
    const userId = req.user._id;

    if (!deviceId || !to || !pollName || !pollOptions || !Array.isArray(pollOptions)) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: deviceId, to, pollName, pollOptions (array)'
      });
    }

    if (pollOptions.length < 2 || pollOptions.length > 12) {
      return res.status(400).json({
        success: false,
        message: 'Poll must have between 2 and 12 options'
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
    let client = activeClients.getClientSync(deviceId);
    if (!client) {
      console.log(`[WhatsApp Controller] Client not found in memory for device ${deviceId}, checking database`);
      client = await activeClients.getClient(deviceId);
    }

    if (!client) {
      console.log(`[WhatsApp Controller] Client not found in memory or database for device ${deviceId}`);
      return res.status(404).json({
        success: false,
        message: 'WhatsApp client not found or not connected'
      });
    }

    console.log(`[WhatsApp Controller] Client found for device ${deviceId}`);

    // Format the phone number
    const formattedNumber = formatPhoneNumber(to);

    // Format poll options for WhatsApp Web.js (Poll constructor expects string array)
    const formattedOptions = pollOptions.map((option: string) => option);

    // Create poll options
    const pollSendOptions = {
      allowMultipleAnswers: allowMultipleAnswers,
      messageSecret: messageSecret || undefined
    };

    // Create and send the poll
    const poll = new Poll(pollName, formattedOptions, pollSendOptions);
    const message = await client.sendMessage(formattedNumber, poll);

    // Store the message in the database
    await MessageHistory.create({
      deviceId,
      userId,
      deviceName: device.name,
      deviceNumber: device.whatsappInfo?.number,
      recipient: formattedNumber,
      message: `Poll: ${pollName}`,
      messageType: 'poll',
      status: 'sent',
      messageId: message.id._serialized,
      metadata: {
        pollName,
        pollOptions: pollOptions.map((option: string, index: number) => ({
          name: option,
          localId: index
        })),
        allowMultipleAnswers,
        messageSecret
      },
      timestamp: new Date()
    });

    return res.status(200).json({
      success: true,
      messageId: message.id._serialized,
      poll: {
        name: pollName,
        options: pollOptions.map((option: string, index: number) => ({
          name: option,
          localId: index
        })),
        allowMultipleAnswers
      }
    });
  } catch (error: any) {
    console.error('[WhatsApp] Error sending poll:', error);

    // Store the failed message in the database
    try {
      const { deviceId, to, pollName } = req.body;
      const userId = req.user._id;
      const device = await Device.findOne({ _id: deviceId, user: userId });

      await MessageHistory.create({
        deviceId,
        userId,
        deviceName: device?.name,
        deviceNumber: device?.whatsappInfo?.number,
        recipient: formatPhoneNumber(to),
        message: `Poll: ${pollName}`,
        messageType: 'poll',
        status: 'failed',
        errorMessage: error.message,
        timestamp: new Date()
      });
    } catch (dbError) {
      console.error('[WhatsApp] Error storing failed poll message:', dbError);
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to send poll',
      error: error.message
    });
  }
};

// Get poll votes for a specific message
export const getPollVotes = async (req: Request, res: Response) => {
  try {
    const { deviceId, messageId } = req.params;
    const userId = req.user._id;

    if (!deviceId || !messageId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters: deviceId, messageId'
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
    let client = activeClients.getClientSync(deviceId);
    if (!client) {
      console.log(`[WhatsApp Controller] Client not found in memory for device ${deviceId}, checking database`);
      client = await activeClients.getClient(deviceId);
    }

    if (!client) {
      console.log(`[WhatsApp Controller] Client not found in memory or database for device ${deviceId}`);
      return res.status(404).json({
        success: false,
        message: 'WhatsApp client not found or not connected'
      });
    }

    console.log(`[WhatsApp Controller] Client found for device ${deviceId}`);

    // Get the message by ID
    const message = await client.getMessageById(messageId);

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Check if it's a poll message
    if (message.type !== 'poll_creation') {
      return res.status(400).json({
        success: false,
        message: 'Message is not a poll'
      });
    }

    // Note: Poll vote retrieval is not yet fully supported in whatsapp-web.js
    // This is a placeholder for when the feature becomes available
    return res.status(200).json({
      success: true,
      message: 'Poll vote retrieval is coming soon in whatsapp-web.js',
      messageId: messageId,
      pollInfo: {
        type: message.type,
        body: message.body,
        timestamp: message.timestamp
      }
    });

  } catch (error: any) {
    console.error('[WhatsApp] Error getting poll votes:', error);

    return res.status(500).json({
      success: false,
      message: 'Failed to get poll votes',
      error: error.message
    });
  }
};

// Get product information from a message
export const getProductInfo = async (req: Request, res: Response) => {
  try {
    const { deviceId, messageId } = req.params;
    const userId = req.user._id;

    if (!deviceId || !messageId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters: deviceId, messageId'
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
    let client = activeClients.getClientSync(deviceId);
    if (!client) {
      console.log(`[WhatsApp Controller] Client not found in memory for device ${deviceId}, checking database`);
      client = await activeClients.getClient(deviceId);
    }

    if (!client) {
      console.log(`[WhatsApp Controller] Client not found in memory or database for device ${deviceId}`);
      return res.status(404).json({
        success: false,
        message: 'WhatsApp client not found or not connected'
      });
    }

    console.log(`[WhatsApp Controller] Client found for device ${deviceId}`);

    // Get the message by ID
    const message = await client.getMessageById(messageId);

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Check if it's a product message
    if (message.type !== 'product') {
      return res.status(400).json({
        success: false,
        message: 'Message is not a product'
      });
    }

    // Get product information (if available in whatsapp-web.js)
    let product: any;
    try {
      // Note: getProduct() method may not be available in current whatsapp-web.js version
      if (typeof (message as any).getProduct === 'function') {
        product = await (message as any).getProduct();
      } else {
        // Fallback: extract product info from message body or metadata
        product = {
          id: 'unknown',
          name: message.body || 'Product',
          price: 'N/A',
          currency: 'N/A',
          quantity: 1,
          thumbnailUrl: null,
          data: message
        };
      }
    } catch (productError) {
      console.error('[WhatsApp] Error getting product:', productError);
      product = {
        id: 'error',
        name: 'Product information unavailable',
        price: 'N/A',
        currency: 'N/A',
        quantity: 0,
        thumbnailUrl: null,
        data: { error: productError.message }
      };
    }

    return res.status(200).json({
      success: true,
      messageId: messageId,
      product: {
        id: product.id,
        name: product.name,
        price: product.price,
        currency: product.currency,
        quantity: product.quantity,
        thumbnailUrl: product.thumbnailUrl,
        data: product.data
      },
      note: 'Product information extraction depends on whatsapp-web.js version and message format'
    });

  } catch (error: any) {
    console.error('[WhatsApp] Error getting product info:', error);

    return res.status(500).json({
      success: false,
      message: 'Failed to get product information',
      error: error.message
    });
  }
};

// Get order information from a message
export const getOrderInfo = async (req: Request, res: Response) => {
  try {
    const { deviceId, messageId } = req.params;
    const userId = req.user._id;

    if (!deviceId || !messageId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters: deviceId, messageId'
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
    let client = activeClients.getClientSync(deviceId);
    if (!client) {
      console.log(`[WhatsApp Controller] Client not found in memory for device ${deviceId}, checking database`);
      client = await activeClients.getClient(deviceId);
    }

    if (!client) {
      console.log(`[WhatsApp Controller] Client not found in memory or database for device ${deviceId}`);
      return res.status(404).json({
        success: false,
        message: 'WhatsApp client not found or not connected'
      });
    }

    console.log(`[WhatsApp Controller] Client found for device ${deviceId}`);

    // Get the message by ID
    const message = await client.getMessageById(messageId);

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Check if it's an order message
    if (message.type !== 'order') {
      return res.status(400).json({
        success: false,
        message: 'Message is not an order'
      });
    }

    // Get order information (if available in whatsapp-web.js)
    let order: any;
    try {
      // Note: getOrder() method may not be available in current whatsapp-web.js version
      if (typeof (message as any).getOrder === 'function') {
        order = await (message as any).getOrder();
      } else {
        // Fallback: extract order info from message body or metadata
        order = {
          createdAt: message.timestamp || Date.now(),
          currency: 'N/A',
          subtotal: 'N/A',
          total: 'N/A'
        };
      }
    } catch (orderError) {
      console.error('[WhatsApp] Error getting order:', orderError);
      order = {
        createdAt: message.timestamp || Date.now(),
        currency: 'N/A',
        subtotal: 'Error',
        total: 'Error'
      };
    }

    return res.status(200).json({
      success: true,
      messageId: messageId,
      order: {
        createdAt: order.createdAt,
        currency: order.currency,
        subtotal: order.subtotal,
        total: order.total
      },
      note: 'Order information extraction depends on whatsapp-web.js version and message format'
    });

  } catch (error: any) {
    console.error('[WhatsApp] Error getting order info:', error);

    return res.status(500).json({
      success: false,
      message: 'Failed to get order information',
      error: error.message
    });
  }
};

// Send a button message (DEPRECATED but may still work)
export const sendButtonMessage = async (req: Request, res: Response) => {
  try {
    const { deviceId, to, body, buttons, title, footer } = req.body;
    const userId = req.user._id;

    if (!deviceId || !to || !body || !buttons || !Array.isArray(buttons)) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: deviceId, to, body, buttons (array)'
      });
    }

    if (buttons.length < 1 || buttons.length > 3) {
      return res.status(400).json({
        success: false,
        message: 'Buttons must have between 1 and 3 options'
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
    let client = activeClients.getClientSync(deviceId);
    if (!client) {
      console.log(`[WhatsApp Controller] Client not found in memory for device ${deviceId}, checking database`);
      client = await activeClients.getClient(deviceId);
    }

    if (!client) {
      console.log(`[WhatsApp Controller] Client not found in memory or database for device ${deviceId}`);
      return res.status(404).json({
        success: false,
        message: 'WhatsApp client not found or not connected'
      });
    }

    console.log(`[WhatsApp Controller] Client found for device ${deviceId}`);

    // Format the phone number
    const formattedNumber = formatPhoneNumber(to);

    // Format buttons for WhatsApp Web.js
    const formattedButtons = buttons.map((button: any, index: number) => ({
      id: button.id || `btn_${index}`,
      body: button.body || button.text
    }));

    // Create and send the button message with error handling
    const buttonMessage = new Buttons(body, formattedButtons, title || null, footer || null);
    let message: any;
    try {
      message = await client.sendMessage(formattedNumber, buttonMessage);
    } catch (sendError: any) {
      console.error(`[WhatsApp] Error sending button message:`, sendError);

      // If it's a serialization error, try to restart the client
      if (sendError.message.includes('serialize') || sendError.message.includes('getMessageModel')) {
        console.log(`[WhatsApp] Detected serialization error, attempting to restart client for device ${deviceId}`);

        try {
          // Remove the corrupted client
          activeClients.removeClient(deviceId);

          // Try to get a fresh client
          client = await activeClients.getClient(deviceId);

          if (client) {
            console.log(`[WhatsApp] Client restarted successfully, retrying button message send`);
            message = await client.sendMessage(formattedNumber, buttonMessage);
          } else {
            throw new Error('Failed to restart WhatsApp client');
          }
        } catch (restartError) {
          console.error(`[WhatsApp] Failed to restart client:`, restartError);

          // Fallback: Send a text message with button options
          try {
            const fallbackMessage = `${title ? title + '\n\n' : ''}${body}\n\n${buttons.map((btn: any, index: number) => `${index + 1}. ${btn.body}`).join('\n')}${footer ? '\n\n' + footer : ''}\n\n(Note: Button message failed, please reply with the number of your choice)`;
            const fallbackResponse = await client.sendMessage(formattedNumber, fallbackMessage);

            // Store the fallback message
            await MessageHistory.create({
              deviceId,
              userId,
              deviceName: device.name,
              deviceNumber: device.whatsappInfo?.number,
              recipient: formattedNumber,
              message: `Buttons (Fallback): ${body}`,
              messageType: 'text',
              status: 'sent',
              messageId: fallbackResponse.id._serialized,
              metadata: {
                originalType: 'buttons',
                body,
                buttons: formattedButtons,
                title,
                footer,
                fallbackReason: 'Client serialization error'
              },
              timestamp: new Date()
            });

            return res.status(200).json({
              success: true,
              messageId: fallbackResponse.id._serialized,
              fallback: true,
              message: 'Button message failed, sent as text fallback',
              buttons: {
                body,
                buttons: formattedButtons,
                title,
                footer
              }
            });
          } catch (fallbackError) {
            console.error(`[WhatsApp] Fallback message also failed:`, fallbackError);
            return res.status(500).json({
              success: false,
              message: 'WhatsApp client error. Please try reconnecting your device.',
              error: 'Client serialization error and fallback failed'
            });
          }
        }
      } else {
        throw sendError; // Re-throw if it's not a serialization error
      }
    }

    // Store the message in the database
    await MessageHistory.create({
      deviceId,
      userId,
      deviceName: device.name,
      deviceNumber: device.whatsappInfo?.number,
      recipient: formattedNumber,
      message: `Buttons: ${body}`,
      messageType: 'buttons',
      status: 'sent',
      messageId: message.id._serialized,
      metadata: {
        body,
        buttons: formattedButtons,
        title,
        footer
      },
      timestamp: new Date()
    });

    return res.status(200).json({
      success: true,
      messageId: message.id._serialized,
      buttons: {
        body,
        buttons: formattedButtons,
        title,
        footer
      },
      note: 'Button messages are deprecated in WhatsApp but may still work'
    });
  } catch (error: any) {
    console.error('[WhatsApp] Error sending button message:', error);

    // Store the failed message in the database
    try {
      const { deviceId, to, body } = req.body;
      const userId = req.user._id;
      const device = await Device.findOne({ _id: deviceId, user: userId });

      await MessageHistory.create({
        deviceId,
        userId,
        deviceName: device?.name,
        deviceNumber: device?.whatsappInfo?.number,
        recipient: formatPhoneNumber(to),
        message: `Buttons: ${body}`,
        messageType: 'buttons',
        status: 'failed',
        errorMessage: error.message,
        timestamp: new Date()
      });
    } catch (dbError) {
      console.error('[WhatsApp] Error storing failed button message:', dbError);
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to send button message',
      error: error.message
    });
  }
};

// Send a product message (Future feature - structure ready)
export const sendProductMessage = async (req: Request, res: Response) => {
  try {
    const { deviceId, to, productId, businessOwnerJid, catalogId } = req.body;
    const userId = req.user._id;

    if (!deviceId || !to || !productId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: deviceId, to, productId'
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
    let client = activeClients.getClientSync(deviceId);
    if (!client) {
      console.log(`[WhatsApp Controller] Client not found in memory for device ${deviceId}, checking database`);
      client = await activeClients.getClient(deviceId);
    }

    if (!client) {
      console.log(`[WhatsApp Controller] Client not found in memory or database for device ${deviceId}`);
      return res.status(404).json({
        success: false,
        message: 'WhatsApp client not found or not connected'
      });
    }

    console.log(`[WhatsApp Controller] Client found for device ${deviceId}`);

    // Format the phone number
    const formattedNumber = formatPhoneNumber(to);

    // Note: Product sending is not yet supported in whatsapp-web.js
    // This is a placeholder structure for when the feature becomes available
    const productMessage = {
      productId,
      businessOwnerJid: businessOwnerJid || undefined,
      catalogId: catalogId || undefined
    };

    // For now, send a text message with product information
    const fallbackMessage = `🛍️ Product Information\n\nProduct ID: ${productId}\n\nNote: Direct product messages are not yet supported in WhatsApp Web.js. This is a fallback text message.`;

    const message = await client.sendMessage(formattedNumber, fallbackMessage);

    // Store the message in the database
    await MessageHistory.create({
      deviceId,
      userId,
      deviceName: device.name,
      deviceNumber: device.whatsappInfo?.number,
      recipient: formattedNumber,
      message: `Product: ${productId}`,
      messageType: 'product',
      status: 'sent',
      messageId: message.id._serialized,
      metadata: productMessage,
      timestamp: new Date()
    });

    return res.status(200).json({
      success: true,
      messageId: message.id._serialized,
      product: productMessage,
      note: 'Product messages are not yet supported in WhatsApp Web.js. A fallback text message was sent instead.'
    });
  } catch (error: any) {
    console.error('[WhatsApp] Error sending product message:', error);

    return res.status(500).json({
      success: false,
      message: 'Failed to send product message',
      error: error.message
    });
  }
};

// Send an order message (Future feature - structure ready)
export const sendOrderMessage = async (req: Request, res: Response) => {
  try {
    const { deviceId, to, orderId, thumbnail, itemCount, priceAmount, priceCurrency, message: orderMessage } = req.body;
    const userId = req.user._id;

    if (!deviceId || !to || !orderId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: deviceId, to, orderId'
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
    let client = activeClients.getClientSync(deviceId);
    if (!client) {
      console.log(`[WhatsApp Controller] Client not found in memory for device ${deviceId}, checking database`);
      client = await activeClients.getClient(deviceId);
    }

    if (!client) {
      console.log(`[WhatsApp Controller] Client not found in memory or database for device ${deviceId}`);
      return res.status(404).json({
        success: false,
        message: 'WhatsApp client not found or not connected'
      });
    }

    console.log(`[WhatsApp Controller] Client found for device ${deviceId}`);

    // Format the phone number
    const formattedNumber = formatPhoneNumber(to);

    // Note: Order sending is not yet supported in whatsapp-web.js
    // This is a placeholder structure for when the feature becomes available
    const orderData = {
      orderId,
      thumbnail: thumbnail || undefined,
      itemCount: itemCount || 1,
      priceAmount: priceAmount || undefined,
      priceCurrency: priceCurrency || 'USD',
      message: orderMessage || undefined
    };

    // For now, send a text message with order information
    const fallbackMessage = `📦 Order Information\n\nOrder ID: ${orderId}\nItems: ${itemCount || 1}\nPrice: ${priceAmount ? `${priceAmount} ${priceCurrency || 'USD'}` : 'N/A'}\n\n${orderMessage || ''}\n\nNote: Direct order messages are not yet supported in WhatsApp Web.js. This is a fallback text message.`;

    const message = await client.sendMessage(formattedNumber, fallbackMessage);

    // Store the message in the database
    await MessageHistory.create({
      deviceId,
      userId,
      deviceName: device.name,
      deviceNumber: device.whatsappInfo?.number,
      recipient: formattedNumber,
      message: `Order: ${orderId}`,
      messageType: 'order',
      status: 'sent',
      messageId: message.id._serialized,
      metadata: orderData,
      timestamp: new Date()
    });

    return res.status(200).json({
      success: true,
      messageId: message.id._serialized,
      order: orderData,
      note: 'Order messages are not yet supported in WhatsApp Web.js. A fallback text message was sent instead.'
    });
  } catch (error: any) {
    console.error('[WhatsApp] Error sending order message:', error);

    return res.status(500).json({
      success: false,
      message: 'Failed to send order message',
      error: error.message
    });
  }
};