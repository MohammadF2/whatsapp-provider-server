import { Request, Response } from 'express';
import Device from '../models/device.model';
import { disconnectWhatsAppClient } from '../services/whatsapp.service';

// Create a new device
export const createDevice = async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    const userId = req.user._id;

    const device = await Device.create({
      name,
      user: userId,
      status: 'disconnected'
    });

    res.status(201).json(device);
  } catch (error) {
    console.error('Create device error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get all devices for a user
export const getDevices = async (req: Request, res: Response) => {
  try {
    const userId = req.user._id;
    const devices = await Device.find({ user: userId });
    res.json(devices);
  } catch (error) {
    console.error('Get devices error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get a single device by ID
export const getDeviceById = async (req: Request, res: Response) => {
  try {
    const deviceId = req.params.id;
    const userId = req.user._id;

    const device = await Device.findOne({ _id: deviceId, user: userId });
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    res.json(device);
  } catch (error) {
    console.error('Get device by ID error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Update a device
export const updateDevice = async (req: Request, res: Response) => {
  try {
    const deviceId = req.params.id;
    const userId = req.user._id;
    const { name } = req.body;

    const device = await Device.findOneAndUpdate(
      { _id: deviceId, user: userId },
      { name },
      { new: true }
    );

    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    res.json(device);
  } catch (error) {
    console.error('Update device error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Delete a device
export const deleteDevice = async (req: Request, res: Response) => {
  try {
    const deviceId = req.params.id;
    const userId = req.user._id;

    const device = await Device.findOne({ _id: deviceId, user: userId });
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    // Disconnect WhatsApp client if connected
    if (device.status !== 'disconnected') {
      await disconnectWhatsAppClient(deviceId);
    }

    await Device.deleteOne({ _id: deviceId });
    res.json({ message: 'Device deleted successfully' });
  } catch (error) {
    console.error('Delete device error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
