/**
 * Retry Strategy Service
 * 
 * Provides advanced retry strategies with configurable backoff algorithms,
 * retry conditions, and integration with timeout management.
 */

import { createLogger, Logger, generateCorrelationId } from './logger.service';
import { timeoutManager, TimeoutOperation } from './timeout-manager.service';
import { QRCodeError, isQRCodeError, ErrorCategory } from '../models/qrcode.errors';

/**
 * Retry strategy types
 */
export enum RetryStrategy {
  /** Fixed delay between retries */
  FIXED = 'fixed',
  
  /** Exponential backoff with optional jitter */
  EXPONENTIAL = 'exponential',
  
  /** Linear increase in delay */
  LINEAR = 'linear',
  
  /** Custom delay calculation */
  CUSTOM = 'custom',
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  
  /** Retry strategy to use */
  strategy: RetryStrategy;
  
  /** Base delay in milliseconds */
  baseDelayMs: number;
  
  /** Maximum delay in milliseconds */
  maxDelayMs: number;
  
  /** Multiplier for exponential backoff */
  backoffMultiplier: number;
  
  /** Whether to add jitter to delays */
  useJitter: boolean;
  
  /** Jitter factor (0-1) */
  jitterFactor: number;
  
  /** Custom delay calculation function */
  customDelayFn?: (attempt: number, baseDelay: number) => number;
  
  /** Function to determine if error should be retried */
  shouldRetryFn?: (error: Error, attempt: number) => boolean;
  
  /** Timeout operation for retry attempts */
  timeoutOperation?: TimeoutOperation;
  
  /** Custom timeout for retry attempts */
  customTimeoutMs?: number;
}

/**
 * Default retry configurations for different operations
 */
export const DEFAULT_RETRY_CONFIGS: Record<string, RetryConfig> = {
  qrGeneration: {
    maxRetries: 3,
    strategy: RetryStrategy.EXPONENTIAL,
    baseDelayMs: 2000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    useJitter: true,
    jitterFactor: 0.25,
    timeoutOperation: 'qrGeneration',
  },
  
  browserLaunch: {
    maxRetries: 2,
    strategy: RetryStrategy.EXPONENTIAL,
    baseDelayMs: 3000,
    maxDelayMs: 15000,
    backoffMultiplier: 2,
    useJitter: true,
    jitterFactor: 0.3,
    timeoutOperation: 'browserLaunch',
  },
  
  clientInitialization: {
    maxRetries: 2,
    strategy: RetryStrategy.FIXED,
    baseDelayMs: 5000,
    maxDelayMs: 10000,
    backoffMultiplier: 1,
    useJitter: false,
    jitterFactor: 0,
    timeoutOperation: 'initialization',
  },
  
  networkOperation: {
    maxRetries: 4,
    strategy: RetryStrategy.EXPONENTIAL,
    baseDelayMs: 1000,
    maxDelayMs: 20000,
    backoffMultiplier: 1.5,
    useJitter: true,
    jitterFactor: 0.2,
    timeoutOperation: 'networkOperation',
  },
  
  sessionCleanup: {
    maxRetries: 2,
    strategy: RetryStrategy.LINEAR,
    baseDelayMs: 1000,
    maxDelayMs: 5000,
    backoffMultiplier: 1,
    useJitter: false,
    jitterFactor: 0,
    timeoutOperation: 'sessionCleanup',
  },
};

/**
 * Retry attempt information
 */
export interface RetryAttempt {
  attempt: number;
  maxRetries: number;
  delay: number;
  error?: Error;
  startTime: Date;
  context?: Record<string, any>;
}

/**
 * Retry result
 */
export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: RetryAttempt[];
  totalDuration: number;
}

/**
 * Retry Strategy Service
 */
export class RetryStrategyService {
  private readonly logger: Logger;
  private readonly configs: Map<string, RetryConfig> = new Map();

  constructor() {
    this.logger = createLogger('RetryStrategy', {
      enablePerformanceLogs: true,
    });
    
    // Load default configurations
    for (const [name, config] of Object.entries(DEFAULT_RETRY_CONFIGS)) {
      this.configs.set(name, config);
    }
    
    this.logger.info('Retry strategy service initialized', {
      defaultConfigs: Object.keys(DEFAULT_RETRY_CONFIGS),
    });
  }

  /**
   * Execute operation with retry strategy
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    configName: string,
    context?: Record<string, any>
  ): Promise<T> {
    const config = this.configs.get(configName);
    if (!config) {
      throw new Error(`Retry configuration '${configName}' not found`);
    }

    return await this.executeWithCustomRetry(operation, config, context);
  }

  /**
   * Execute operation with custom retry configuration
   */
  async executeWithCustomRetry<T>(
    operation: () => Promise<T>,
    config: RetryConfig,
    context?: Record<string, any>
  ): Promise<T> {
    const correlationId = generateCorrelationId();
    const contextLogger = this.logger.child(correlationId, { 
      retryConfig: config.strategy,
      maxRetries: config.maxRetries,
      ...context 
    });

    const attempts: RetryAttempt[] = [];
    const startTime = Date.now();
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
      const attemptStartTime = new Date();
      
      try {
        contextLogger.debug('Starting retry attempt', { 
          attempt, 
          maxRetries: config.maxRetries + 1,
        });

        let result: T;
        
        // Execute with timeout if configured
        if (config.timeoutOperation) {
          result = await timeoutManager.executeWithTimeout(
            operation,
            config.timeoutOperation,
            { ...context, attempt },
            config.customTimeoutMs
          );
        } else {
          result = await operation();
        }

        // Record successful attempt
        attempts.push({
          attempt,
          maxRetries: config.maxRetries,
          delay: 0,
          startTime: attemptStartTime,
          context,
        });

        if (attempt > 1) {
          contextLogger.info('Operation succeeded after retry', { 
            attempt,
            totalDuration: Date.now() - startTime,
          });
        }

        return result;
      } catch (error) {
        lastError = error as Error;
        
        contextLogger.warn('Retry attempt failed', { 
          attempt,
          error: lastError.message,
          errorType: lastError.constructor.name,
        });

        // Check if we should retry this error
        if (!this.shouldRetry(lastError, attempt, config)) {
          contextLogger.info('Error should not be retried', { 
            errorType: lastError.constructor.name,
            attempt,
          });
          
          attempts.push({
            attempt,
            maxRetries: config.maxRetries,
            delay: 0,
            error: lastError,
            startTime: attemptStartTime,
            context,
          });
          
          throw lastError;
        }

        // Don't retry if we've reached max attempts
        if (attempt > config.maxRetries) {
          contextLogger.error('Max retry attempts exceeded', lastError, { 
            totalAttempts: attempt,
            maxRetries: config.maxRetries,
            totalDuration: Date.now() - startTime,
          });
          break;
        }

        // Calculate delay for next attempt
        const delay = this.calculateDelay(attempt, config);
        
        attempts.push({
          attempt,
          maxRetries: config.maxRetries,
          delay,
          error: lastError,
          startTime: attemptStartTime,
          context,
        });

        contextLogger.debug('Waiting before retry', { 
          delay, 
          nextAttempt: attempt + 1,
          strategy: config.strategy,
        });
        
        await this.sleep(delay);
      }
    }

    // If we get here, all retries failed
    const totalDuration = Date.now() - startTime;
    contextLogger.error('All retry attempts failed', lastError, {
      totalAttempts: attempts.length,
      totalDuration,
    });

    throw lastError || new Error('Operation failed after all retry attempts');
  }

  /**
   * Set retry configuration for an operation
   */
  setRetryConfig(name: string, config: RetryConfig): void {
    this.configs.set(name, config);
    this.logger.info('Retry configuration updated', { name, config });
  }

  /**
   * Get retry configuration for an operation
   */
  getRetryConfig(name: string): RetryConfig | undefined {
    return this.configs.get(name);
  }

  /**
   * Get all retry configurations
   */
  getAllRetryConfigs(): Record<string, RetryConfig> {
    const configs: Record<string, RetryConfig> = {};
    for (const [name, config] of this.configs) {
      configs[name] = config;
    }
    return configs;
  }

  /**
   * Calculate delay for retry attempt
   */
  private calculateDelay(attempt: number, config: RetryConfig): number {
    let delay: number;

    switch (config.strategy) {
      case RetryStrategy.FIXED:
        delay = config.baseDelayMs;
        break;
        
      case RetryStrategy.EXPONENTIAL:
        delay = config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
        break;
        
      case RetryStrategy.LINEAR:
        delay = config.baseDelayMs * attempt;
        break;
        
      case RetryStrategy.CUSTOM:
        if (config.customDelayFn) {
          delay = config.customDelayFn(attempt, config.baseDelayMs);
        } else {
          delay = config.baseDelayMs;
        }
        break;
        
      default:
        delay = config.baseDelayMs;
    }

    // Apply maximum delay limit
    delay = Math.min(delay, config.maxDelayMs);

    // Add jitter if enabled
    if (config.useJitter) {
      const jitter = delay * config.jitterFactor * (Math.random() * 2 - 1);
      delay += jitter;
    }

    return Math.max(0, Math.floor(delay));
  }

  /**
   * Determine if error should be retried
   */
  private shouldRetry(error: Error, attempt: number, config: RetryConfig): boolean {
    // Use custom retry function if provided
    if (config.shouldRetryFn) {
      return config.shouldRetryFn(error, attempt);
    }

    // Default retry logic
    if (isQRCodeError(error)) {
      // Don't retry validation errors, authorization errors, or not found errors
      const nonRetryableStatusCodes = [400, 401, 403, 404];
      if (nonRetryableStatusCodes.includes(error.statusCode) && error.statusCode !== 408) {
        return false;
      }
    }

    // Don't retry certain system errors
    const nonRetryableErrors = [
      'ValidationError',
      'AuthenticationError',
      'AuthorizationError',
      'DeviceNotFoundError',
      'SessionNotFoundError',
    ];

    return !nonRetryableErrors.includes(error.constructor.name);
  }

  /**
   * Sleep for specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Default retry strategy service instance
 */
export const retryStrategy = new RetryStrategyService();

/**
 * Create retry strategy service
 */
export function createRetryStrategy(): RetryStrategyService {
  return new RetryStrategyService();
}
