import { Request, Response } from 'express';
import Device from '../models/device.model';
import { initWhatsAppClient, activeClients } from '../services/whatsapp.service';
import qrcode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';

/**
 * Generate a QR code for a device
 * This endpoint initiates a WhatsApp client and returns a QR code for authentication
 */
export const generateQRCode = async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user._id;

    // Check if device exists and belongs to user
    const device = await Device.findOne({ _id: deviceId, user: userId });
    if (!device) {
      return res.status(404).json({ 
        success: false, 
        message: 'Device not found' 
      });
    }

    // Check if device is already connected
    if (device.status === 'connected') {
      return res.status(400).json({
        success: false,
        message: 'Device is already connected to WhatsApp'
      });
    }

    // Generate a unique session ID for this QR code request
    const sessionId = uuidv4();

    // Create a promise that will resolve when the QR code is generated
    const qrCodePromise = new Promise<string>((resolve, reject) => {
      // Set a timeout to reject the promise if QR code is not generated within 30 seconds
      const timeout = setTimeout(() => {
        reject(new Error('QR code generation timed out'));
      }, 30000);

      // Initialize WhatsApp client
      initWhatsAppClient(deviceId, sessionId, {
        emit: (event: string, ...args: any[]) => {
          if (event === 'qr') {
            // QR code received, resolve the promise
            clearTimeout(timeout);
            resolve(args[0]);
          } else if (event === 'ready') {
            // Client is ready, no need for QR code
            clearTimeout(timeout);
            reject(new Error('Client is already authenticated'));
          }
        }
      }).catch(error => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    // Wait for QR code to be generated
    const qrString = await qrCodePromise;

    // Generate QR code image
    const qrImage = await qrcode.toDataURL(qrString);

    // Return QR code image and session ID
    return res.status(200).json({
      success: true,
      qrCode: qrImage,
      sessionId,
      deviceId,
      expiresIn: 60, // QR code expires in 60 seconds
      message: 'Scan this QR code with your WhatsApp app to authenticate'
    });
  } catch (error: any) {
    console.error('[QRCode Controller] Error generating QR code:', error);
    
    // Check if the error is because the client is already authenticated
    if (error.message === 'Client is already authenticated') {
      return res.status(400).json({
        success: false,
        message: 'Device is already authenticated'
      });
    }
    
    // Check if the error is because of timeout
    if (error.message === 'QR code generation timed out') {
      return res.status(408).json({
        success: false,
        message: 'QR code generation timed out. Please try again.'
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Failed to generate QR code',
      error: error.message
    });
  }
};

/**
 * Check the status of a QR code session
 * This endpoint checks if a device has been authenticated after scanning a QR code
 */
export const checkQRCodeStatus = async (req: Request, res: Response) => {
  try {
    const { deviceId, sessionId } = req.params;
    const userId = req.user._id;

    // Check if device exists and belongs to user
    const device = await Device.findOne({ _id: deviceId, user: userId });
    if (!device) {
      return res.status(404).json({ 
        success: false, 
        message: 'Device not found' 
      });
    }

    // Check if device is connected
    if (device.status === 'connected') {
      return res.status(200).json({
        success: true,
        status: 'connected',
        message: 'Device is connected to WhatsApp'
      });
    }

    // Check if client exists
    const clientExists = await activeClients.hasClient(deviceId);
    if (clientExists) {
      return res.status(200).json({
        success: true,
        status: 'connecting',
        message: 'Device is in the process of connecting to WhatsApp'
      });
    }

    // Client doesn't exist, QR code session has expired or failed
    return res.status(200).json({
      success: true,
      status: 'expired',
      message: 'QR code session has expired or failed. Please generate a new QR code.'
    });
  } catch (error: any) {
    console.error('[QRCode Controller] Error checking QR code status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to check QR code status',
      error: error.message
    });
  }
};
