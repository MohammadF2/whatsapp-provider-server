import { Request, Response } from 'express';
import Device from '../models/device.model';
import { activeClients } from '../services/whatsapp.service';

/**
 * Check if a contact has blocked you
 * 
 * This function attempts to determine if a contact has blocked you by checking
 * various indicators:
 * 1. Attempts to get the contact's profile picture
 * 2. Attempts to get the contact's about info
 * 3. Checks if the contact is in any common groups
 * 
 * If all of these fail in specific ways, it's likely the contact has blocked you.
 */
export const checkIfBlocked = async (req: Request, res: Response) => {
  try {
    const { deviceId, phoneNumber } = req.params;
    const userId = req.user._id;

    if (!deviceId || !phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters: deviceId, phoneNumber'
      });
    }

    // Check if device exists and belongs to user
    const device = await Device.findOne({ _id: deviceId, user: userId });
    if (!device) {
      return res.status(404).json({ 
        success: false, 
        message: 'Device not found' 
      });
    }

    // Check if device is connected
    if (device.status !== 'connected') {
      return res.status(400).json({ 
        success: false, 
        message: 'Device is not connected to WhatsApp' 
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
    const formattedNumber = formatPhoneNumber(phoneNumber);

    // Get the contact
    const contact = await client.getContactById(formattedNumber);
    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Contact not found',
        isBlocked: false
      });
    }

    // Check if the number is registered on WhatsApp
    if (!contact.isWAContact) {
      return res.status(200).json({
        success: true,
        isBlocked: false,
        reason: 'Number is not registered on WhatsApp'
      });
    }

    // Perform checks to determine if contact has blocked you
    let isBlocked = false;
    let reason = '';
    let blockIndicators = 0;

    try {
      // Check 1: Try to get profile picture
      const profilePic = await contact.getProfilePicUrl();
      if (!profilePic) {
        blockIndicators++;
      }
    } catch (error) {
      blockIndicators++;
      reason += 'Cannot retrieve profile picture. ';
    }

    try {
      // Check 2: Try to get about info
      const about = await contact.getAbout();
      if (about === null) {
        blockIndicators++;
        reason += 'Cannot retrieve about info. ';
      }
    } catch (error) {
      blockIndicators++;
      reason += 'Cannot retrieve about info. ';
    }

    try {
      // Check 3: Check common groups
      const commonGroups = await contact.getCommonGroups();
      // If you have common groups but can't see profile pic or about, likely blocked
      if (commonGroups.length > 0 && blockIndicators >= 2) {
        blockIndicators++;
        reason += 'Has common groups but other indicators suggest blocking. ';
      }
    } catch (error) {
      // Error getting common groups is not necessarily an indicator of being blocked
    }

    // Determine if contact has likely blocked you
    // If 2 or more indicators are present, it's likely you're blocked
    isBlocked = blockIndicators >= 2;

    if (!reason && isBlocked) {
      reason = 'Multiple blocking indicators detected.';
    }

    return res.status(200).json({
      success: true,
      isBlocked,
      reason: isBlocked ? reason.trim() : 'Not blocked',
      contact: {
        id: contact.id._serialized,
        name: contact.name || contact.pushname || '',
        number: contact.number
      }
    });
  } catch (error: any) {
    console.error('[Contact] Error checking if contact has blocked:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to check if contact has blocked',
      error: error.message
    });
  }
};

// Helper function to format phone number
const formatPhoneNumber = (phone: string): string => {
  // If it's already a properly formatted individual ID, return it as is
  if (phone.endsWith('@c.us')) {
    return phone;
  }

  // Remove any non-digit characters for regular phone numbers
  const digits = phone.replace(/\D/g, '');

  // Regular phone number
  return `${digits}@c.us`;
};
