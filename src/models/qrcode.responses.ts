/**
 * QR Code API Response Schemas
 * 
 * This file contains TypeScript interfaces for all API responses
 * related to QR code operations.
 */

import { SessionStatus } from './qrcode.types';

/**
 * Base API response interface
 */
export interface BaseResponse {
  /** Indicates if the operation was successful */
  success: boolean;
  
  /** Human-readable message */
  message?: string;
}

/**
 * QR Code generation response
 */
export interface QRCodeResponse extends BaseResponse {
  /** Base64 encoded QR code data URL */
  qrCode?: string;
  
  /** Unique session identifier */
  sessionId?: string;
  
  /** Device ID for which QR code was generated */
  deviceId?: string;
  
  /** Time in seconds until QR code expires */
  expiresIn?: number;
  
  /** Error message if generation failed */
  error?: string;
}

/**
 * QR Code status check response
 */
export interface StatusResponse extends BaseResponse {
  /** Current session status */
  status?: SessionStatus;
  
  /** Error message if status check failed */
  error?: string;
  
  /** Additional status details */
  details?: {
    /** Session ID being checked */
    sessionId?: string;
    
    /** Device ID being checked */
    deviceId?: string;
    
    /** Time remaining until expiration (in seconds) */
    timeRemaining?: number;
    
    /** Last update timestamp */
    lastUpdated?: string;
  };
}

/**
 * Error response for failed operations
 */
export interface ErrorResponse extends BaseResponse {
  success: false;
  
  /** Error message */
  message: string;
  
  /** Detailed error information */
  error?: string;
  
  /** Error code for programmatic handling */
  code?: string;
  
  /** Additional error details */
  details?: any;
}

/**
 * Validation error response
 */
export interface ValidationErrorResponse extends ErrorResponse {
  /** Field-specific validation errors */
  validationErrors?: {
    field: string;
    message: string;
    value?: any;
  }[];
}