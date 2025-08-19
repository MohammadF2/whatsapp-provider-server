/**
 * Rate Limiter Service
 * 
 * Provides configurable rate limiting for API endpoints with support for
 * different algorithms, user-based limits, and comprehensive monitoring.
 */

import { createLogger, Logger, generateCorrelationId } from './logger.service';
import { RateLimitError } from '../models/qrcode.errors';

/**
 * Rate limiting algorithms
 */
export enum RateLimitAlgorithm {
  /** Token bucket algorithm */
  TOKEN_BUCKET = 'token_bucket',
  
  /** Fixed window algorithm */
  FIXED_WINDOW = 'fixed_window',
  
  /** Sliding window algorithm */
  SLIDING_WINDOW = 'sliding_window',
  
  /** Sliding window log algorithm */
  SLIDING_WINDOW_LOG = 'sliding_window_log',
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Maximum number of requests */
  maxRequests: number;
  
  /** Time window in milliseconds */
  windowMs: number;
  
  /** Rate limiting algorithm to use */
  algorithm: RateLimitAlgorithm;
  
  /** Whether to skip successful requests in counting */
  skipSuccessfulRequests: boolean;
  
  /** Whether to skip failed requests in counting */
  skipFailedRequests: boolean;
  
  /** Custom key generator function */
  keyGenerator?: (identifier: string, context?: Record<string, any>) => string;
  
  /** Custom message for rate limit exceeded */
  message?: string;
  
  /** Headers to include in rate limit responses */
  headers: {
    /** Include total limit in headers */
    total: boolean;
    
    /** Include remaining requests in headers */
    remaining: boolean;
    
    /** Include reset time in headers */
    reset: boolean;
    
    /** Include retry after in headers */
    retryAfter: boolean;
  };
}

/**
 * Default rate limit configurations
 */
export const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  qrGeneration: {
    maxRequests: 5,
    windowMs: 60000, // 1 minute
    algorithm: RateLimitAlgorithm.SLIDING_WINDOW,
    skipSuccessfulRequests: false,
    skipFailedRequests: true,
    message: 'Too many QR code generation requests. Please try again later.',
    headers: {
      total: true,
      remaining: true,
      reset: true,
      retryAfter: true,
    },
  },
  
  statusCheck: {
    maxRequests: 30,
    windowMs: 60000, // 1 minute
    algorithm: RateLimitAlgorithm.TOKEN_BUCKET,
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
    message: 'Too many status check requests. Please try again later.',
    headers: {
      total: true,
      remaining: true,
      reset: false,
      retryAfter: true,
    },
  },
  
  sessionManagement: {
    maxRequests: 10,
    windowMs: 60000, // 1 minute
    algorithm: RateLimitAlgorithm.FIXED_WINDOW,
    skipSuccessfulRequests: false,
    skipFailedRequests: true,
    message: 'Too many session management requests. Please try again later.',
    headers: {
      total: true,
      remaining: true,
      reset: true,
      retryAfter: true,
    },
  },
  
  global: {
    maxRequests: 100,
    windowMs: 60000, // 1 minute
    algorithm: RateLimitAlgorithm.SLIDING_WINDOW,
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
    message: 'Too many requests. Please try again later.',
    headers: {
      total: true,
      remaining: true,
      reset: true,
      retryAfter: true,
    },
  },
};

/**
 * Rate limit entry
 */
interface RateLimitEntry {
  count: number;
  resetTime: number;
  requests: number[];
}

/**
 * Rate limit result
 */
export interface RateLimitResult {
  allowed: boolean;
  totalHits: number;
  totalRequests: number;
  remainingRequests: number;
  resetTime: number;
  retryAfter?: number;
}

/**
 * Rate Limiter Service
 */
export class RateLimiterService {
  private readonly logger: Logger;
  private readonly configs: Map<string, RateLimitConfig> = new Map();
  private readonly store: Map<string, RateLimitEntry> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.logger = createLogger('RateLimiter', {
      enablePerformanceLogs: true,
    });
    
    // Load default configurations
    for (const [name, config] of Object.entries(DEFAULT_RATE_LIMITS)) {
      this.configs.set(name, config);
    }
    
    this.startCleanup();
    this.logger.info('Rate limiter service initialized', {
      defaultConfigs: Object.keys(DEFAULT_RATE_LIMITS),
    });
  }

  /**
   * Check if request is allowed under rate limit
   */
  checkLimit(
    limitName: string,
    identifier: string,
    context?: Record<string, any>
  ): RateLimitResult {
    const config = this.configs.get(limitName);
    if (!config) {
      throw new Error(`Rate limit configuration '${limitName}' not found`);
    }

    const key = this.generateKey(limitName, identifier, config, context);
    const now = Date.now();
    
    let entry = this.store.get(key);
    if (!entry) {
      entry = {
        count: 0,
        resetTime: now + config.windowMs,
        requests: [],
      };
      this.store.set(key, entry);
    }

    // Apply rate limiting algorithm
    const result = this.applyAlgorithm(config, entry, now);
    
    this.logger.debug('Rate limit check', {
      limitName,
      identifier,
      key,
      allowed: result.allowed,
      remaining: result.remainingRequests,
      algorithm: config.algorithm,
    });

    if (!result.allowed) {
      this.logger.warn('Rate limit exceeded', {
        limitName,
        identifier,
        totalHits: result.totalHits,
        maxRequests: config.maxRequests,
        windowMs: config.windowMs,
      });
    }

    return result;
  }

  /**
   * Consume a request (increment counter)
   */
  consume(
    limitName: string,
    identifier: string,
    success: boolean = true,
    context?: Record<string, any>
  ): RateLimitResult {
    const config = this.configs.get(limitName);
    if (!config) {
      throw new Error(`Rate limit configuration '${limitName}' not found`);
    }

    // Check if we should skip this request
    if ((success && config.skipSuccessfulRequests) || 
        (!success && config.skipFailedRequests)) {
      return this.checkLimit(limitName, identifier, context);
    }

    const result = this.checkLimit(limitName, identifier, context);
    
    if (result.allowed) {
      const key = this.generateKey(limitName, identifier, config, context);
      const entry = this.store.get(key)!;
      entry.count++;
      entry.requests.push(Date.now());
    }

    return result;
  }

  /**
   * Reset rate limit for identifier
   */
  reset(limitName: string, identifier: string, context?: Record<string, any>): void {
    const config = this.configs.get(limitName);
    if (!config) {
      throw new Error(`Rate limit configuration '${limitName}' not found`);
    }

    const key = this.generateKey(limitName, identifier, config, context);
    this.store.delete(key);
    
    this.logger.info('Rate limit reset', { limitName, identifier, key });
  }

  /**
   * Get rate limit status without consuming
   */
  getStatus(
    limitName: string,
    identifier: string,
    context?: Record<string, any>
  ): RateLimitResult {
    return this.checkLimit(limitName, identifier, context);
  }

  /**
   * Set rate limit configuration
   */
  setConfig(name: string, config: RateLimitConfig): void {
    this.configs.set(name, config);
    this.logger.info('Rate limit configuration updated', { name, config });
  }

  /**
   * Get rate limit configuration
   */
  getConfig(name: string): RateLimitConfig | undefined {
    return this.configs.get(name);
  }

  /**
   * Get all rate limit configurations
   */
  getAllConfigs(): Record<string, RateLimitConfig> {
    const configs: Record<string, RateLimitConfig> = {};
    for (const [name, config] of this.configs) {
      configs[name] = config;
    }
    return configs;
  }

  /**
   * Get rate limit statistics
   */
  getStatistics(): {
    totalKeys: number;
    configCount: number;
    memoryUsage: number;
    oldestEntry: number | null;
  } {
    let oldestEntry: number | null = null;
    let memoryUsage = 0;

    for (const entry of this.store.values()) {
      memoryUsage += JSON.stringify(entry).length;
      if (!oldestEntry || entry.resetTime < oldestEntry) {
        oldestEntry = entry.resetTime;
      }
    }

    return {
      totalKeys: this.store.size,
      configCount: this.configs.size,
      memoryUsage,
      oldestEntry,
    };
  }

  /**
   * Clear all rate limit data
   */
  clear(): void {
    this.store.clear();
    this.logger.info('Rate limit store cleared');
  }

  /**
   * Destroy the rate limiter and clean up resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    this.clear();
    this.logger.info('Rate limiter destroyed');
  }

  /**
   * Apply rate limiting algorithm
   */
  private applyAlgorithm(
    config: RateLimitConfig,
    entry: RateLimitEntry,
    now: number
  ): RateLimitResult {
    switch (config.algorithm) {
      case RateLimitAlgorithm.TOKEN_BUCKET:
        return this.applyTokenBucket(config, entry, now);
        
      case RateLimitAlgorithm.FIXED_WINDOW:
        return this.applyFixedWindow(config, entry, now);
        
      case RateLimitAlgorithm.SLIDING_WINDOW:
        return this.applySlidingWindow(config, entry, now);
        
      case RateLimitAlgorithm.SLIDING_WINDOW_LOG:
        return this.applySlidingWindowLog(config, entry, now);
        
      default:
        return this.applyFixedWindow(config, entry, now);
    }
  }

  /**
   * Apply token bucket algorithm
   */
  private applyTokenBucket(
    config: RateLimitConfig,
    entry: RateLimitEntry,
    now: number
  ): RateLimitResult {
    // Reset if window has passed
    if (now >= entry.resetTime) {
      entry.count = 0;
      entry.resetTime = now + config.windowMs;
    }

    const allowed = entry.count < config.maxRequests;
    const remaining = Math.max(0, config.maxRequests - entry.count);

    return {
      allowed,
      totalHits: entry.count,
      totalRequests: config.maxRequests,
      remainingRequests: remaining,
      resetTime: entry.resetTime,
      retryAfter: allowed ? undefined : Math.ceil((entry.resetTime - now) / 1000),
    };
  }

  /**
   * Apply fixed window algorithm
   */
  private applyFixedWindow(
    config: RateLimitConfig,
    entry: RateLimitEntry,
    now: number
  ): RateLimitResult {
    return this.applyTokenBucket(config, entry, now);
  }

  /**
   * Apply sliding window algorithm
   */
  private applySlidingWindow(
    config: RateLimitConfig,
    entry: RateLimitEntry,
    now: number
  ): RateLimitResult {
    // Remove old requests outside the window
    const windowStart = now - config.windowMs;
    entry.requests = entry.requests.filter(time => time > windowStart);
    entry.count = entry.requests.length;

    const allowed = entry.count < config.maxRequests;
    const remaining = Math.max(0, config.maxRequests - entry.count);

    return {
      allowed,
      totalHits: entry.count,
      totalRequests: config.maxRequests,
      remainingRequests: remaining,
      resetTime: now + config.windowMs,
      retryAfter: allowed ? undefined : Math.ceil(config.windowMs / 1000),
    };
  }

  /**
   * Apply sliding window log algorithm
   */
  private applySlidingWindowLog(
    config: RateLimitConfig,
    entry: RateLimitEntry,
    now: number
  ): RateLimitResult {
    return this.applySlidingWindow(config, entry, now);
  }

  /**
   * Generate cache key for rate limit entry
   */
  private generateKey(
    limitName: string,
    identifier: string,
    config: RateLimitConfig,
    context?: Record<string, any>
  ): string {
    if (config.keyGenerator) {
      return config.keyGenerator(identifier, context);
    }
    
    return `${limitName}:${identifier}`;
  }

  /**
   * Start cleanup process for expired entries
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000); // Clean up every minute

    // Ensure the timer doesn't keep the process alive
    this.cleanupInterval.unref();
  }

  /**
   * Clean up expired rate limit entries
   */
  private cleanup(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, entry] of this.store) {
      // Remove entries that are well past their reset time
      if (now > entry.resetTime + 60000) { // 1 minute grace period
        this.store.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug('Cleaned up expired rate limit entries', { 
        cleanedCount,
        remainingEntries: this.store.size,
      });
    }
  }
}

/**
 * Default rate limiter instance
 */
export const rateLimiter = new RateLimiterService();

/**
 * Create rate limiter service
 */
export function createRateLimiter(): RateLimiterService {
  return new RateLimiterService();
}
