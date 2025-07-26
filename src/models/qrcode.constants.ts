/**
 * QR Code System Constants
 * 
 * This file contains constants and configuration values used throughout
 * the QR code system.
 */

/**
 * Default timeout values in milliseconds
 */
export const DEFAULT_TIMEOUTS = {
  /** Default timeout for QR code generation */
  qrGeneration: 30000, // 30 seconds
  
  /** Default timeout for connection establishment */
  connection: 60000, // 60 seconds
  
  /** Default timeout for client initialization */
  initialization: 120000, // 2 minutes
} as const;

/**
 * Additional system timeouts
 */
export const SYSTEM_TIMEOUTS = {
  /** Default session expiration time */
  SESSION_EXPIRATION: 60000, // 60 seconds
  
  /** Default cleanup interval */
  CLEANUP_INTERVAL: 30000, // 30 seconds
} as const;

/**
 * Rate limiting configuration
 */
export const RATE_LIMITS = {
  /** Maximum QR code generation requests per minute per user */
  QR_GENERATION_PER_MINUTE: 5,
  
  /** Maximum status check requests per minute per user */
  STATUS_CHECK_PER_MINUTE: 60,
  
  /** Maximum concurrent sessions per user */
  MAX_CONCURRENT_SESSIONS: 3,
  
  /** Maximum concurrent sessions per device */
  MAX_DEVICE_SESSIONS: 1,
} as const;

/**
 * Session status transitions - defines valid status changes
 */
export const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ['generated', 'failed', 'expired'],
  generated: ['scanned', 'failed', 'expired'],
  scanned: ['connected', 'failed', 'expired'],
  connected: [], // Terminal state
  expired: [], // Terminal state
  failed: [], // Terminal state
} as const;

/**
 * HTTP status codes for different error types
 */
export const HTTP_STATUS_CODES = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  REQUEST_TIMEOUT: 408,
  CONFLICT: 409,
  GONE: 410,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

/**
 * Log levels for different operations
 */
export const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
} as const;

/**
 * Event names for internal system events
 */
export const EVENTS = {
  QR_GENERATED: 'qr:generated',
  QR_SCANNED: 'qr:scanned',
  CLIENT_READY: 'client:ready',
  CLIENT_DISCONNECTED: 'client:disconnected',
  CLIENT_ERROR: 'client:error',
  SESSION_EXPIRED: 'session:expired',
  SESSION_CLEANUP: 'session:cleanup',
} as const;

/**
 * Default client configuration
 */
export const DEFAULT_CLIENT_CONFIG = {
  clientType: 'puppeteer' as const,
  timeouts: DEFAULT_TIMEOUTS,
  seleniumConfig: {
    browserType: 'chrome' as const,
    headless: false,
  },
} as const;

/**
 * Validation constraints
 */
export const VALIDATION = {
  /** Minimum device ID length */
  MIN_DEVICE_ID_LENGTH: 1,
  
  /** Maximum device ID length */
  MAX_DEVICE_ID_LENGTH: 100,
  
  /** Minimum user ID length */
  MIN_USER_ID_LENGTH: 1,
  
  /** Maximum user ID length */
  MAX_USER_ID_LENGTH: 100,
  
  /** Session ID format (UUID v4) */
  SESSION_ID_PATTERN: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
} as const;

/**
 * Memory usage limits
 */
export const MEMORY_LIMITS = {
  /** Maximum number of sessions to keep in memory */
  MAX_SESSIONS: 1000,
  
  /** Maximum session store size in MB */
  MAX_STORE_SIZE_MB: 100,
} as const;