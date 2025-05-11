import express from 'express';
import {
  createDevice,
  getDevices,
  getDeviceById,
  updateDevice,
  deleteDevice
} from '../controllers/device.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticate as any);

// Create a new device
router.post('/', createDevice as any);

// Get all devices for a user
router.get('/', getDevices as any);

// Get a single device by ID
router.get('/:id', getDeviceById as any);

// Update a device
router.put('/:id', updateDevice as any);

// Delete a device
router.delete('/:id', deleteDevice as any);

export default router;
