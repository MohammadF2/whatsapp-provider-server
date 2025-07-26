/**
 * QR Code Client Integration Service
 * 
 * This service integrates the WhatsApp Client Factory with the QR Code Manager
 * to provide seamless QR code generation and event handling.
 */

import { getQRCodeManager } from './qrcode-manager.service';
import whatsAppClientFactory from './whatsapp-client-factory.service';
import { ClientConfig, WhatsAppClientWrapper } from '../models/qrcode.types';
import { 
  ClientInitializationError, 
  QRGenerationTimeoutError,
  ValidationError,
  SessionNotFoundError,
  BrowserLaunchError
} from '../models/qrcode.errors';
import { DEFAULT_CLIENT_CONFIG } from '../models/qrcode.constants';

/**
 * QR Code Client Integration Service
 * 
 * Handles the integration between QR Code Manager and WhatsApp Client Factory
 * to provide complete QR code generation functionality.
 */
export class QRCodeClientIntegrationService {
  private qrCodeManager: any;
  private readonly clientFactory = whatsAppClientFactory;
  private activeClients: Map<string, WhatsAppClientWrapper> = new Map();
  private qrGenerationTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private retryAttempts: Map<string, number> = new Map();
  private readonly maxRetries = 3;

  constructor(qrCodeManager?: any) {
    this.qrCodeManager = qrCodeManager || getQRCodeManager();
  }

  /**
   * Generate QR code for a device by creating and initializing a WhatsApp client
   */
  async generateQRCodeForDevice(
    deviceId: string, 
    userId: string, 
    config: Partial<ClientConfig> = {}
  ): Promise<string> {
    console.log(`[QRCodeClientIntegration] Starting QR generation for device ${deviceId}`);

    try {
      // Validate input
      if (!deviceId || !userId) {
        throw new ValidationError('Device ID and User ID are required');
      }

      // Create session in QR Code Manager
      const session = await this.qrCodeManager.generateQRCode(deviceId, userId);
      console.log(`[QRCodeClientIntegration] Session created: ${session.sessionId}`);

      // Merge configuration with defaults
      const clientConfig: ClientConfig = {
        ...DEFAULT_CLIENT_CONFIG,
        ...config,
        deviceId,
        timeouts: {
          ...DEFAULT_CLIENT_CONFIG.timeouts,
          ...config.timeouts,
        },
      };

      // Clean up any existing client for this device
      await this.cleanupExistingClient(deviceId);

      // Initialize retry counter
      this.retryAttempts.set(deviceId, 0);

      // Start QR generation with retry logic
      return await this.generateQRCodeWithRetry(deviceId, session.sessionId, clientConfig);

    } catch (error) {
      console.error(`[QRCodeClientIntegration] Error generating QR code for device ${deviceId}:`, error);
      
      // Clean up on error
      await this.cleanupExistingClient(deviceId);
      
      throw error;
    }
  }

  /**
   * Generate QR code with retry logic for browser initialization failures
   */
  private async generateQRCodeWithRetry(
    deviceId: string,
    sessionId: string,
    clientConfig: ClientConfig
  ): Promise<string> {
    const currentAttempt = this.retryAttempts.get(deviceId) || 0;
    
    try {
      console.log(`[QRCodeClientIntegration] QR generation attempt ${currentAttempt + 1}/${this.maxRetries + 1} for device ${deviceId}`);

      // Create WhatsApp client
      const clientWrapper = await this.clientFactory.createClient(deviceId, clientConfig);
      this.activeClients.set(deviceId, clientWrapper);

      // Set up event handlers for QR code generation
      await this.setupClientEventHandlers(clientWrapper, sessionId);

      // Set up QR generation timeout
      this.setupQRGenerationTimeout(deviceId, sessionId, clientConfig.timeouts.qrGeneration);

      // Initialize the client to start QR generation
      console.log(`[QRCodeClientIntegration] Initializing client for device ${deviceId}`);
      await clientWrapper.initialize();

      // Wait for QR code to be generated and return it
      const qrCode = await this.waitForQRCode(sessionId, clientConfig.timeouts.qrGeneration);
      
      // Clear timeout on success
      this.clearQRGenerationTimeout(deviceId);
      
      return qrCode;

    } catch (error) {
      console.error(`[QRCodeClientIntegration] QR generation attempt ${currentAttempt + 1} failed for device ${deviceId}:`, error);
      
      // Clear timeout
      this.clearQRGenerationTimeout(deviceId);
      
      // Clean up failed client
      await this.cleanupExistingClient(deviceId);
      
      // Check if we should retry
      if (this.shouldRetryQRGeneration(error, currentAttempt)) {
        console.log(`[QRCodeClientIntegration] Retrying QR generation for device ${deviceId} (attempt ${currentAttempt + 2}/${this.maxRetries + 1})`);
        
        // Increment retry counter
        this.retryAttempts.set(deviceId, currentAttempt + 1);
        
        // Wait before retrying (exponential backoff)
        const retryDelay = Math.min(1000 * Math.pow(2, currentAttempt), 10000);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        
        // Retry
        return await this.generateQRCodeWithRetry(deviceId, sessionId, clientConfig);
      }
      
      // No more retries, throw the error
      throw error;
    } finally {
      // Clean up retry counter
      this.retryAttempts.delete(deviceId);
    }
  }

  /**
   * Determine if QR generation should be retried based on error type and attempt count
   */
  private shouldRetryQRGeneration(error: any, currentAttempt: number): boolean {
    // Don't retry if we've exceeded max attempts
    if (currentAttempt >= this.maxRetries) {
      return false;
    }

    // Retry on browser launch failures
    if (error instanceof BrowserLaunchError) {
      return true;
    }

    // Retry on client initialization errors
    if (error instanceof ClientInitializationError) {
      return true;
    }

    // Don't retry on validation errors or QR generation timeouts
    if (error instanceof ValidationError || error instanceof QRGenerationTimeoutError) {
      return false;
    }

    // Retry on generic errors that might be transient
    return true;
  }

  /**
   * Set up QR generation timeout
   */
  private setupQRGenerationTimeout(deviceId: string, sessionId: string, timeoutMs: number): void {
    this.clearQRGenerationTimeout(deviceId);
    
    const timeout = setTimeout(async () => {
      console.warn(`[QRCodeClientIntegration] QR generation timeout for device ${deviceId} after ${timeoutMs}ms`);
      
      try {
        // Update session status to expired
        await this.qrCodeManager.updateSessionStatus(sessionId, 'expired', `QR generation timeout after ${timeoutMs}ms`);
      } catch (error) {
        console.error(`[QRCodeClientIntegration] Error updating session status on timeout for ${sessionId}:`, error);
      }
      
      // Clean up client
      await this.cleanupExistingClient(deviceId);
      
    }, timeoutMs);
    
    this.qrGenerationTimeouts.set(deviceId, timeout);
  }

  /**
   * Clear QR generation timeout
   */
  private clearQRGenerationTimeout(deviceId: string): void {
    const timeout = this.qrGenerationTimeouts.get(deviceId);
    if (timeout) {
      clearTimeout(timeout);
      this.qrGenerationTimeouts.delete(deviceId);
    }
  }

  /**
   * Set up event handlers for the WhatsApp client
   */
  private async setupClientEventHandlers(
    clientWrapper: WhatsAppClientWrapper, 
    sessionId: string
  ): Promise<void> {
    const deviceId = clientWrapper.deviceId;
    console.log(`[QRCodeClientIntegration] Setting up event handlers for device ${deviceId}, session ${sessionId}`);

    // QR code event - forward to QR Code Manager
    clientWrapper.onQR(async (qr: string) => {
      console.log(`[QRCodeClientIntegration] QR code received for device ${deviceId}`);
      
      // Clear QR generation timeout since we got a QR code
      this.clearQRGenerationTimeout(deviceId);
      
      try {
        await this.qrCodeManager.updateSessionWithQRCode(sessionId, qr);
        console.log(`[QRCodeClientIntegration] QR code updated in session ${sessionId}`);
      } catch (error) {
        console.error(`[QRCodeClientIntegration] Error updating QR code in session ${sessionId}:`, error);
        await this.qrCodeManager.updateSessionStatus(sessionId, 'failed', `Failed to update QR code: ${error.message}`);
      }
    });

    // Ready event - client is connected
    clientWrapper.onReady(async (info: any) => {
      console.log(`[QRCodeClientIntegration] Client ready for device ${deviceId}`);
      
      // Clear QR generation timeout since we're connected
      this.clearQRGenerationTimeout(deviceId);
      
      try {
        await this.qrCodeManager.updateSessionStatus(sessionId, 'connected');
        console.log(`[QRCodeClientIntegration] Session ${sessionId} marked as connected`);
        
        // Clean up the client after successful connection
        setTimeout(async () => {
          await this.cleanupExistingClient(deviceId);
        }, 5000); // Give some time for any final operations
        
      } catch (error) {
        console.error(`[QRCodeClientIntegration] Error updating session status to connected for ${sessionId}:`, error);
      }
    });

    // Disconnected event
    clientWrapper.onDisconnected(async (reason: string) => {
      console.log(`[QRCodeClientIntegration] Client disconnected for device ${deviceId}. Reason: ${reason}`);
      
      // Clear QR generation timeout
      this.clearQRGenerationTimeout(deviceId);
      
      try {
        // Only update to failed if the session is not already connected
        const currentSession = await this.qrCodeManager.getSession(sessionId);
        if (currentSession && currentSession.status !== 'connected') {
          await this.qrCodeManager.updateSessionStatus(sessionId, 'failed', `Client disconnected: ${reason}`);
        }
      } catch (error) {
        console.error(`[QRCodeClientIntegration] Error handling disconnection for session ${sessionId}:`, error);
      }
      
      // Clean up the client
      await this.cleanupExistingClient(deviceId);
    });

    // Error event
    clientWrapper.onError(async (error: Error) => {
      console.error(`[QRCodeClientIntegration] Client error for device ${deviceId}:`, error);
      
      // Clear QR generation timeout
      this.clearQRGenerationTimeout(deviceId);
      
      try {
        let errorMessage = error.message;
        let sessionStatus: 'failed' | 'expired' = 'failed';
        
        // Handle specific error types
        if (error instanceof QRGenerationTimeoutError) {
          errorMessage = `QR generation timeout after ${error.details?.timeout || 'unknown'}ms`;
          sessionStatus = 'expired';
        } else if (error instanceof ClientInitializationError) {
          errorMessage = `Client initialization failed: ${error.message}`;
        } else if (error instanceof BrowserLaunchError) {
          errorMessage = `Browser launch failed: ${error.message}`;
        }
        
        await this.qrCodeManager.updateSessionStatus(sessionId, sessionStatus, errorMessage);
        console.log(`[QRCodeClientIntegration] Session ${sessionId} marked as ${sessionStatus} due to error`);
        
      } catch (updateError) {
        console.error(`[QRCodeClientIntegration] Error updating session status for error in ${sessionId}:`, updateError);
      }
      
      // Clean up the client
      await this.cleanupExistingClient(deviceId);
    });
  }

  /**
   * Wait for QR code to be generated in the session
   */
  private async waitForQRCode(sessionId: string, timeoutMs: number): Promise<string> {
    console.log(`[QRCodeClientIntegration] Waiting for QR code for session ${sessionId}`);
    
    const startTime = Date.now();
    const pollInterval = 500; // Poll every 500ms
    
    return new Promise((resolve, reject) => {
      const checkQRCode = async () => {
        try {
          const session = await this.qrCodeManager.getSession(sessionId);
          
          if (!session) {
            reject(new SessionNotFoundError(sessionId));
            return;
          }
          
          // Check if QR code is available
          if (session.qrCode && session.status === 'generated') {
            console.log(`[QRCodeClientIntegration] QR code ready for session ${sessionId}`);
            resolve(session.qrCode);
            return;
          }
          
          // Check if session failed or expired
          if (session.status === 'failed' || session.status === 'expired') {
            const errorMessage = session.error || `Session ${session.status}`;
            reject(new Error(errorMessage));
            return;
          }
          
          // Check timeout
          if (Date.now() - startTime >= timeoutMs) {
            reject(new QRGenerationTimeoutError(session.deviceId, timeoutMs));
            return;
          }
          
          // Continue polling
          setTimeout(checkQRCode, pollInterval);
          
        } catch (error) {
          reject(error);
        }
      };
      
      // Start checking
      checkQRCode();
    });
  }

  /**
   * Clean up existing client for a device
   */
  private async cleanupExistingClient(deviceId: string): Promise<void> {
    try {
      // Clear QR generation timeout
      this.clearQRGenerationTimeout(deviceId);
      
      // Clear retry attempts
      this.retryAttempts.delete(deviceId);
      
      // Remove from active clients map
      this.activeClients.delete(deviceId);
      
      // Destroy client in factory
      if (this.clientFactory.hasClient(deviceId)) {
        console.log(`[QRCodeClientIntegration] Cleaning up existing client for device ${deviceId}`);
        await this.clientFactory.destroyClient(deviceId);
      }
    } catch (error) {
      console.warn(`[QRCodeClientIntegration] Error cleaning up client for device ${deviceId}:`, error);
    }
  }

  /**
   * Cancel QR code generation for a device
   */
  async cancelQRCodeGeneration(deviceId: string): Promise<void> {
    console.log(`[QRCodeClientIntegration] Cancelling QR generation for device ${deviceId}`);
    
    try {
      // Clean up the client
      await this.cleanupExistingClient(deviceId);
      
      console.log(`[QRCodeClientIntegration] QR generation cancelled for device ${deviceId}`);
    } catch (error) {
      console.error(`[QRCodeClientIntegration] Error cancelling QR generation for device ${deviceId}:`, error);
      throw error;
    }
  }

  /**
   * Get active client for a device
   */
  getActiveClient(deviceId: string): WhatsAppClientWrapper | null {
    return this.activeClients.get(deviceId) || null;
  }

  /**
   * Get all active device IDs
   */
  getActiveDevices(): string[] {
    return Array.from(this.activeClients.keys());
  }

  /**
   * Clean up all active clients
   */
  async cleanupAllClients(): Promise<void> {
    console.log(`[QRCodeClientIntegration] Cleaning up all active clients (${this.activeClients.size} clients)`);
    
    // Clear all timeouts
    for (const timeout of this.qrGenerationTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.qrGenerationTimeouts.clear();
    
    // Clear retry attempts
    this.retryAttempts.clear();
    
    const deviceIds = Array.from(this.activeClients.keys());
    const cleanupPromises = deviceIds.map(deviceId => 
      this.cleanupExistingClient(deviceId).catch(error => {
        console.error(`[QRCodeClientIntegration] Error cleaning up client ${deviceId}:`, error);
        return error;
      })
    );

    await Promise.all(cleanupPromises);
    
    console.log(`[QRCodeClientIntegration] All clients cleaned up`);
  }
}

// Create singleton instance
const qrCodeClientIntegrationService = new QRCodeClientIntegrationService();

export default qrCodeClientIntegrationService;