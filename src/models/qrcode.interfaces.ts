/**
 * QR Code System Service Interfaces
 * 
 * This file contains TypeScript interfaces for services that will be
 * implemented in the QR code system.
 */

import { QRCodeSession, SessionStatus, ClientConfig, WhatsAppClientWrapper } from './qrcode.types';

/**
 * QR Code Manager Service Interface
 * 
 * Central service for managing QR code generation sessions and WhatsApp client lifecycle.
 */
export interface IQRCodeManager {
  /**
   * Generate a QR code for device authentication
   * @param deviceId - The device identifier
   * @param userId - The user identifier who owns the device
   * @returns Promise resolving to QR code session
   */
  generateQRCode(deviceId: string, userId: string): Promise<QRCodeSession>;
  
  /**
   * Get the current status of a QR code session
   * @param sessionId - The session identifier
   * @returns Promise resolving to session status
   */
  getSessionStatus(sessionId: string): Promise<SessionStatus>;
  
  /**
   * Get full session details
   * @param sessionId - The session identifier
   * @returns Promise resolving to session or null if not found
   */
  getSession(sessionId: string): Promise<QRCodeSession | null>;
  
  /**
   * Cancel an active QR code session
   * @param sessionId - The session identifier
   * @returns Promise resolving when session is cancelled
   */
  cancelSession(sessionId: string): Promise<void>;
  
  /**
   * Clean up expired sessions
   * @returns Promise resolving when cleanup is complete
   */
  cleanupExpiredSessions(): Promise<void>;
  
  /**
   * Get all active sessions for a user
   * @param userId - The user identifier
   * @returns Promise resolving to array of active sessions
   */
  getUserSessions(userId: string): Promise<QRCodeSession[]>;
}

/**
 * Session Store Interface
 * 
 * In-memory store for active QR code sessions with automatic cleanup.
 */
export interface ISessionStore {
  /**
   * Create a new QR code session
   * @param deviceId - The device identifier
   * @param userId - The user identifier
   * @param clientType - The client type to use
   * @returns The created session
   */
  createSession(deviceId: string, userId: string, clientType: 'puppeteer' | 'selenium'): QRCodeSession;
  
  /**
   * Get a session by ID
   * @param sessionId - The session identifier
   * @returns The session or null if not found
   */
  getSession(sessionId: string): QRCodeSession | null;
  
  /**
   * Update a session with partial data
   * @param sessionId - The session identifier
   * @param updates - Partial session data to update
   * @returns True if session was updated, false if not found
   */
  updateSession(sessionId: string, updates: Partial<QRCodeSession>): boolean;
  
  /**
   * Delete a session
   * @param sessionId - The session identifier
   * @returns True if session was deleted, false if not found
   */
  deleteSession(sessionId: string): boolean;
  
  /**
   * Get all sessions for a user
   * @param userId - The user identifier
   * @returns Array of sessions for the user
   */
  getUserSessions(userId: string): QRCodeSession[];
  
  /**
   * Get all sessions for a device
   * @param deviceId - The device identifier
   * @returns Array of sessions for the device
   */
  getDeviceSessions(deviceId: string): QRCodeSession[];
  
  /**
   * Get all expired sessions
   * @returns Array of expired sessions
   */
  getExpiredSessions(): QRCodeSession[];
  
  /**
   * Clean up expired sessions
   * @returns Number of sessions cleaned up
   */
  cleanup(): number;
  
  /**
   * Get total number of active sessions
   * @returns Number of active sessions
   */
  getActiveSessionCount(): number;
  
  /**
   * Clear all sessions (for testing/cleanup)
   */
  clear(): void;
}

/**
 * WhatsApp Client Factory Interface
 * 
 * Factory for creating and managing WhatsApp client instances with proper event handling.
 */
export interface IWhatsAppClientFactory {
  /**
   * Create a new WhatsApp client wrapper
   * @param deviceId - The device identifier
   * @param config - Client configuration
   * @returns Promise resolving to client wrapper
   */
  createClient(deviceId: string, config: ClientConfig): Promise<WhatsAppClientWrapper>;
  
  /**
   * Destroy a WhatsApp client and clean up resources
   * @param deviceId - The device identifier
   * @returns Promise resolving when client is destroyed
   */
  destroyClient(deviceId: string): Promise<void>;
  
  /**
   * Get an existing client wrapper
   * @param deviceId - The device identifier
   * @returns The client wrapper or null if not found
   */
  getClient(deviceId: string): WhatsAppClientWrapper | null;
  
  /**
   * Check if a client exists for a device
   * @param deviceId - The device identifier
   * @returns True if client exists, false otherwise
   */
  hasClient(deviceId: string): boolean;
  
  /**
   * Get all active client device IDs
   * @returns Array of device IDs with active clients
   */
  getActiveDevices(): string[];
  
  /**
   * Destroy all clients and clean up resources
   * @returns Promise resolving when all clients are destroyed
   */
  destroyAllClients(): Promise<void>;
}

/**
 * QR Code Controller Interface
 * 
 * REST API controller interface for QR code operations.
 */
export interface IQRCodeController {
  /**
   * Generate QR code endpoint handler
   * @param req - Express request object
   * @param res - Express response object
   * @returns Promise resolving when response is sent
   */
  generateQRCode(req: any, res: any): Promise<void>;
  
  /**
   * Check QR code status endpoint handler
   * @param req - Express request object
   * @param res - Express response object
   * @returns Promise resolving when response is sent
   */
  checkQRCodeStatus(req: any, res: any): Promise<void>;
  
  /**
   * Cancel QR code session endpoint handler
   * @param req - Express request object
   * @param res - Express response object
   * @returns Promise resolving when response is sent
   */
  cancelQRCodeSession(req: any, res: any): Promise<void>;
}