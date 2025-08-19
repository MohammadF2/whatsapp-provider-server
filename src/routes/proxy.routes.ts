import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import { getProxyMonitoringService } from '../services/proxy-monitoring.service';
import { getMessageQueueService } from '../services/message-queue.service';
import { getDecodoProxyService } from '../services/decodo-proxy.service';
import ProxyDeviceMapping from '../models/proxy-device-mapping.model';
import { isDecodoEnabled, isMessageQueueEnabled, isMonitoringEnabled } from '../config/proxy.config';

const router = Router();

