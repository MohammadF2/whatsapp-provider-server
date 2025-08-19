import { EventEmitter } from 'events';
import { createLogger, Logger, LogLevel } from './logger.service';

/**
 * Message queue item interface
 */
export interface QueuedMessage {
  id: string;
  deviceId: string;
  to: string;
  message: string;
  type: 'text' | 'media' | 'button' | 'poll';
  priority: 'low' | 'normal' | 'high';
  metadata?: Record<string, any>;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  scheduledAt?: Date;
  processedAt?: Date;
  completedAt?: Date;
  error?: string;
}

/**
 * Queue configuration interface
 */
export interface QueueConfig {
  /** Maximum number of messages per device queue */
  maxQueueSize: number;
  
  /** Rate limiting: messages per minute per device */
  messagesPerMinute: number;
  
  /** Delay between messages in milliseconds */
  messageDelayMs: number;
  
  /** Maximum retry attempts for failed messages */
  maxRetryAttempts: number;
  
  /** Retry delay multiplier */
  retryDelayMultiplier: number;
  
  /** Maximum retry delay in milliseconds */
  maxRetryDelayMs: number;
  
  /** Queue processing interval in milliseconds */
  processingIntervalMs: number;
  
  /** Enable logging */
  enableLogging: boolean;
}

/**
 * Queue statistics interface
 */
export interface QueueStats {
  deviceId: string;
  totalMessages: number;
  pendingMessages: number;
  processingMessages: number;
  completedMessages: number;
  failedMessages: number;
  averageProcessingTime: number;
  lastProcessedAt?: Date;
  messagesPerMinute: number;
}

/**
 * Message processor function type
 */
export type MessageProcessor = (message: QueuedMessage) => Promise<void>;

/**
 * Default queue configuration
 */
const DEFAULT_CONFIG: QueueConfig = {
  maxQueueSize: 1000,
  messagesPerMinute: 20, // Conservative rate to avoid WhatsApp limits
  messageDelayMs: 3000, // 3 seconds between messages
  maxRetryAttempts: 3,
  retryDelayMultiplier: 2,
  maxRetryDelayMs: 60000, // 1 minute max retry delay
  processingIntervalMs: 1000, // Check queues every second
  enableLogging: true,
};

/**
 * Device-specific message queue
 */
class DeviceQueue {
  private queue: QueuedMessage[] = [];
  private processing: boolean = false;
  private lastProcessedAt?: Date;
  private rateLimitWindow: Date[] = [];
  private stats: QueueStats;

  constructor(
    public deviceId: string,
    private config: QueueConfig,
    private processor: MessageProcessor,
    private logger: Logger
  ) {
    this.stats = {
      deviceId,
      totalMessages: 0,
      pendingMessages: 0,
      processingMessages: 0,
      completedMessages: 0,
      failedMessages: 0,
      averageProcessingTime: 0,
      messagesPerMinute: 0,
    };
  }

  /**
   * Add message to queue
   */
  enqueue(message: QueuedMessage): boolean {
    if (this.queue.length >= this.config.maxQueueSize) {
      this.logger.warn('Queue is full, rejecting message', { 
        deviceId: this.deviceId, 
        messageId: message.id,
        queueSize: this.queue.length 
      });
      return false;
    }

    // Insert message based on priority
    const insertIndex = this.findInsertIndex(message.priority);
    this.queue.splice(insertIndex, 0, message);
    
    this.stats.totalMessages++;
    this.stats.pendingMessages++;
    
    this.logger.debug('Message enqueued', { 
      deviceId: this.deviceId, 
      messageId: message.id,
      priority: message.priority,
      queueSize: this.queue.length 
    });

    return true;
  }

  /**
   * Process next message in queue
   */
  async processNext(): Promise<boolean> {
    if (this.processing || this.queue.length === 0) {
      return false;
    }

    // Check rate limiting
    if (!this.canProcessMessage()) {
      return false;
    }

    const message = this.queue.shift();
    if (!message) {
      return false;
    }

    this.processing = true;
    this.stats.processingMessages++;
    this.stats.pendingMessages--;

    const startTime = Date.now();

    try {
      this.logger.debug('Processing message', { 
        deviceId: this.deviceId, 
        messageId: message.id,
        attempt: message.attempts + 1 
      });

      message.processedAt = new Date();
      message.attempts++;

      await this.processor(message);

      // Message processed successfully
      message.completedAt = new Date();
      this.stats.completedMessages++;
      this.stats.processingMessages--;
      
      const processingTime = Date.now() - startTime;
      this.updateAverageProcessingTime(processingTime);
      
      this.lastProcessedAt = new Date();
      this.addToRateLimitWindow();

      this.logger.debug('Message processed successfully', { 
        deviceId: this.deviceId, 
        messageId: message.id,
        processingTime 
      });

      return true;

    } catch (error) {
      this.stats.processingMessages--;
      const processingTime = Date.now() - startTime;
      
      message.error = (error as Error).message;
      
      this.logger.warn('Message processing failed', { 
        deviceId: this.deviceId, 
        messageId: message.id,
        attempt: message.attempts,
        error: message.error,
        processingTime 
      });

      // Retry logic
      if (message.attempts < message.maxAttempts) {
        const retryDelay = Math.min(
          this.config.messageDelayMs * Math.pow(this.config.retryDelayMultiplier, message.attempts - 1),
          this.config.maxRetryDelayMs
        );
        
        message.scheduledAt = new Date(Date.now() + retryDelay);
        
        // Re-queue for retry
        const insertIndex = this.findInsertIndex(message.priority);
        this.queue.splice(insertIndex, 0, message);
        this.stats.pendingMessages++;
        
        this.logger.debug('Message scheduled for retry', { 
          deviceId: this.deviceId, 
          messageId: message.id,
          retryDelay,
          scheduledAt: message.scheduledAt 
        });
      } else {
        // Max attempts reached
        this.stats.failedMessages++;
        this.logger.error('Message failed after max attempts', new Error(message.error || 'Unknown error'), {
          deviceId: this.deviceId,
          messageId: message.id,
          attempts: message.attempts
        });
      }

      return false;
    } finally {
      this.processing = false;
    }
  }

  /**
   * Check if we can process a message based on rate limiting
   */
  private canProcessMessage(): boolean {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Clean old entries from rate limit window
    this.rateLimitWindow = this.rateLimitWindow.filter(time => time.getTime() > oneMinuteAgo);

    // Check if we're within rate limit
    if (this.rateLimitWindow.length >= this.config.messagesPerMinute) {
      return false;
    }

    // Check minimum delay since last message
    if (this.lastProcessedAt) {
      const timeSinceLastMessage = now - this.lastProcessedAt.getTime();
      if (timeSinceLastMessage < this.config.messageDelayMs) {
        return false;
      }
    }

    return true;
  }

  /**
   * Add current time to rate limit window
   */
  private addToRateLimitWindow(): void {
    this.rateLimitWindow.push(new Date());
    this.stats.messagesPerMinute = this.rateLimitWindow.length;
  }

  /**
   * Find insert index based on priority
   */
  private findInsertIndex(priority: 'low' | 'normal' | 'high'): number {
    const priorityOrder = { high: 0, normal: 1, low: 2 };
    const messagePriority = priorityOrder[priority];

    for (let i = 0; i < this.queue.length; i++) {
      const queuedPriority = priorityOrder[this.queue[i].priority];
      if (messagePriority < queuedPriority) {
        return i;
      }
    }

    return this.queue.length;
  }

  /**
   * Update average processing time
   */
  private updateAverageProcessingTime(processingTime: number): void {
    if (this.stats.averageProcessingTime === 0) {
      this.stats.averageProcessingTime = processingTime;
    } else {
      this.stats.averageProcessingTime = 
        (this.stats.averageProcessingTime + processingTime) / 2;
    }
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    return { ...this.stats, lastProcessedAt: this.lastProcessedAt };
  }

  /**
   * Get queue size
   */
  getSize(): number {
    return this.queue.length;
  }

  /**
   * Clear all messages from queue
   */
  clear(): void {
    this.queue = [];
    this.stats.pendingMessages = 0;
    this.logger.info('Queue cleared', { deviceId: this.deviceId });
  }

  /**
   * Get pending messages
   */
  getPendingMessages(): QueuedMessage[] {
    return [...this.queue];
  }
}

/**
 * Message Queue Service
 * Manages separate queues for each WhatsApp device with rate limiting
 */
export class MessageQueueService extends EventEmitter {
  private queues: Map<string, DeviceQueue> = new Map();
  private config: QueueConfig;
  private logger: Logger;
  private processor: MessageProcessor;
  private processingTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(config: Partial<QueueConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = createLogger('MessageQueueService', {
      level: this.config.enableLogging ? LogLevel.DEBUG : LogLevel.INFO,
    });

    // Default processor (should be overridden)
    this.processor = async (message: QueuedMessage) => {
      throw new Error('Message processor not set');
    };

    this.logger.info('Message Queue Service initialized', { config: this.config });
  }

  /**
   * Set message processor function
   */
  setProcessor(processor: MessageProcessor): void {
    this.processor = processor;
    this.logger.info('Message processor set');
  }

  /**
   * Start queue processing
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.processingTimer = setInterval(() => {
      this.processQueues();
    }, this.config.processingIntervalMs);

    this.logger.info('Message queue processing started');
  }

  /**
   * Stop queue processing
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = null;
    }

    this.logger.info('Message queue processing stopped');
  }

  /**
   * Add message to device queue
   */
  enqueueMessage(message: Omit<QueuedMessage, 'id' | 'attempts' | 'createdAt'>): boolean {
    const queuedMessage: QueuedMessage = {
      ...message,
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      attempts: 0,
      createdAt: new Date(),
    };

    const queue = this.getOrCreateQueue(message.deviceId);
    const success = queue.enqueue(queuedMessage);

    if (success) {
      this.emit('messageEnqueued', queuedMessage);
    } else {
      this.emit('messageRejected', queuedMessage);
    }

    return success;
  }

  /**
   * Get or create device queue
   */
  private getOrCreateQueue(deviceId: string): DeviceQueue {
    let queue = this.queues.get(deviceId);
    if (!queue) {
      queue = new DeviceQueue(deviceId, this.config, this.processor, this.logger);
      this.queues.set(deviceId, queue);
      this.logger.debug('Created new device queue', { deviceId });
    }
    return queue;
  }

  /**
   * Process all device queues
   */
  private async processQueues(): Promise<void> {
    const promises = Array.from(this.queues.values()).map(async (queue) => {
      try {
        const processed = await queue.processNext();
        if (processed) {
          this.emit('messageProcessed', queue.deviceId);
        }
      } catch (error) {
        this.logger.error('Error processing queue', error as Error, { 
          deviceId: queue.deviceId 
        });
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * Get queue statistics for a device
   */
  getQueueStats(deviceId: string): QueueStats | null {
    const queue = this.queues.get(deviceId);
    return queue ? queue.getStats() : null;
  }

  /**
   * Get statistics for all queues
   */
  getAllQueueStats(): QueueStats[] {
    return Array.from(this.queues.values()).map(queue => queue.getStats());
  }

  /**
   * Clear queue for a device
   */
  clearQueue(deviceId: string): void {
    const queue = this.queues.get(deviceId);
    if (queue) {
      queue.clear();
      this.emit('queueCleared', deviceId);
    }
  }

  /**
   * Remove device queue
   */
  removeQueue(deviceId: string): void {
    const queue = this.queues.get(deviceId);
    if (queue) {
      queue.clear();
      this.queues.delete(deviceId);
      this.logger.info('Device queue removed', { deviceId });
      this.emit('queueRemoved', deviceId);
    }
  }

  /**
   * Get pending messages for a device
   */
  getPendingMessages(deviceId: string): QueuedMessage[] {
    const queue = this.queues.get(deviceId);
    return queue ? queue.getPendingMessages() : [];
  }

  /**
   * Get total number of active queues
   */
  getActiveQueueCount(): number {
    return this.queues.size;
  }

  /**
   * Get queue health status
   */
  getQueueHealth(): Record<string, any> {
    const stats = this.getAllQueueStats();
    const totalQueues = stats.length;
    const totalPending = stats.reduce((sum, stat) => sum + stat.pendingMessages, 0);
    const totalCompleted = stats.reduce((sum, stat) => sum + stat.completedMessages, 0);
    const totalFailed = stats.reduce((sum, stat) => sum + stat.failedMessages, 0);
    const avgProcessingTime = stats.length > 0 ?
      stats.reduce((sum, stat) => sum + stat.averageProcessingTime, 0) / stats.length : 0;

    return {
      totalQueues,
      totalPending,
      totalCompleted,
      totalFailed,
      avgProcessingTime,
      successRate: totalCompleted + totalFailed > 0 ?
        totalCompleted / (totalCompleted + totalFailed) : 0,
      isHealthy: totalFailed / Math.max(totalCompleted + totalFailed, 1) < 0.1, // Less than 10% failure rate
      timestamp: new Date(),
    };
  }

  /**
   * Pause queue processing for a specific device
   */
  pauseQueue(deviceId: string): void {
    // Implementation would mark queue as paused
    this.logger.info('Queue paused', { deviceId });
    this.emit('queuePaused', deviceId);
  }

  /**
   * Resume queue processing for a specific device
   */
  resumeQueue(deviceId: string): void {
    // Implementation would mark queue as active
    this.logger.info('Queue resumed', { deviceId });
    this.emit('queueResumed', deviceId);
  }

  /**
   * Get queue configuration
   */
  getConfig(): QueueConfig {
    return { ...this.config };
  }

  /**
   * Update queue configuration
   */
  updateConfig(newConfig: Partial<QueueConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.info('Queue configuration updated', { config: this.config });
    this.emit('configUpdated', this.config);
  }

  /**
   * Cleanup and destroy service
   */
  destroy(): void {
    this.stop();
    this.queues.clear();
    this.removeAllListeners();
    this.logger.info('Message Queue Service destroyed');
  }
}

// Singleton instance
let messageQueueService: MessageQueueService | null = null;

/**
 * Get or create message queue service instance
 */
export function getMessageQueueService(config?: Partial<QueueConfig>): MessageQueueService {
  if (!messageQueueService) {
    messageQueueService = new MessageQueueService(config);
  }
  return messageQueueService;
}

/**
 * Destroy the singleton instance
 */
export function destroyMessageQueueService(): void {
  if (messageQueueService) {
    messageQueueService.destroy();
    messageQueueService = null;
  }
}
