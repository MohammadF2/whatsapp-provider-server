import { Request, Response } from 'express';
import Device from '../models/device.model';
import { sendMessage, disconnectWhatsAppClient, testWhatsAppConnection as testWhatsAppConnectionService } from '../services/whatsapp.service';

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
