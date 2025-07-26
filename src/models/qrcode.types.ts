/**
 * QR Code System Type Definitions
 * 
 * This file contains all TypeScript interfaces and types for the QR code
 * generation and session management system.
 */

/**
 * Session status enumeration for QR code authentication flow
 */
export type SessionStatus = 
  | 'pending'      // Session created, waiting for QR
  | 'generated'    // QR code generated and ready
  | 'scanned'      // QR code scanned by user
  | 'connected'    // Successfully connected
  | 'expired'      // Session expired
  | 'failed';      // Session failed with error

/**
 * QR Code Session interface representing an active QR authentication session
 */
export interface QRCodeSession {
  /** Unique session identifier */
  sessionId: string;
  
  /** Associated device ID */
  deviceId: string;
  
  /** User who owns the device */
  userId: string;
  
  /** Base64 QR code data URL (optional until generated) */
  qrCode?: string;
  
  /** Current session status */
  status: SessionStatus;
  
  /** Session creation time */
  createdAt: Date;
  
  /** Session expiration time */
  expiresAt: Date;
  
  /** Last status update time */
  lastUpdated: Date;
  
  /** Error message if session failed */
  error?: string;
  
  /** Client implementation type used for this session */
  clientType: 'puppeteer' | 'selenium';
}

/**
 * Client configuration for WhatsApp client initialization
 */
export interface ClientConfig {
  /** Device identifier */
  deviceId: string;
  
  /** Type of client implementation to use */
  clientType: 'puppeteer' | 'selenium';
  
  /** Selenium-specific configuration (optional) */
  seleniumConfig?: {
    /** Browser type for Selenium */
    browserType: 'chrome' | 'firefox';
    
    /** Whether to run browser in headless mode */
    headless: boolean;
    
    /** Custom user agent string */
    userAgent?: string;
  };
  
  /** Timeout configurations in milliseconds */
  timeouts: {
    /** Timeout for QR code generation (default: 30000ms) */
    qrGeneration: number;
    
    /** Timeout for connection establishment (default: 60000ms) */
    connection: number;
    
    /** Timeout for client initialization (default: 120000ms) */
    initialization: number;
  };
}

/**
 * WhatsApp Client Wrapper interface for abstracting different client implementations
 */
export interface WhatsAppClientWrapper {
  /** The underlying WhatsApp client instance */
  client: any; // Using any to support both whatsapp-web.js and custom implementations
  
  /** Device ID associated with this client */
  deviceId: string;
  
  /** Register callback for QR code events */
  onQR(callback: (qr: string) => void): void;
  
  /** Register callback for ready events */
  onReady(callback: (info: any) => void): void;
  
  /** Register callback for disconnection events */
  onDisconnected(callback: (reason: string) => void): void;
  
  /** Register callback for error events */
  onError(callback: (error: Error) => void): void;
  
  /** Initialize the WhatsApp client */
  initialize(): Promise<void>;
  
  /** Destroy the client and clean up resources */
  destroy(): Promise<void>;
}