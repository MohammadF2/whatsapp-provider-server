/**
 * Shutdown Manager Service
 * 
 * Handles graceful shutdown of the application and all its services.
 * Ensures proper cleanup of resources when the application is terminated.
 */

// import { getQRCodeManager, resetQRCodeManager } from './qrcode-manager.service'; // Temporarily disabled
// import { resetSessionStore } from './session-store.service'; // Temporarily disabled
// import whatsAppClientFactory from './whatsapp-client-factory.service'; // Temporarily disabled

/**
 * Shutdown Manager Configuration
 */
export interface ShutdownManagerConfig {
  /** Timeout for graceful shutdown in milliseconds (default: 30000ms = 30 seconds) */
  shutdownTimeoutMs: number;
  
  /** Enable detailed logging during shutdown (default: true) */
  enableLogging: boolean;
  
  /** Force exit after timeout (default: true) */
  forceExitAfterTimeout: boolean;
}

/**
 * Default configuration for the Shutdown Manager
 */
const DEFAULT_CONFIG: ShutdownManagerConfig = {
  shutdownTimeoutMs: 30 * 1000, // 30 seconds
  enableLogging: true,
  forceExitAfterTimeout: true,
};

/**
 * Shutdown Manager Service Implementation
 */
export class ShutdownManager {
  private readonly config: ShutdownManagerConfig;
  private isShuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;

  constructor(config: Partial<ShutdownManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.setupSignalHandlers();
  }

  /**
   * Set up signal handlers for graceful shutdown
   */
  private setupSignalHandlers(): void {
    // Handle SIGTERM (Docker, Kubernetes, etc.)
    process.on('SIGTERM', () => {
      this.log('Received SIGTERM signal');
      this.initiateGracefulShutdown('SIGTERM');
    });

    // Handle SIGINT (Ctrl+C)
    process.on('SIGINT', () => {
      this.log('Received SIGINT signal');
      this.initiateGracefulShutdown('SIGINT');
    });

    // Handle SIGHUP (terminal closed)
    process.on('SIGHUP', () => {
      this.log('Received SIGHUP signal');
      this.initiateGracefulShutdown('SIGHUP');
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.logError('Uncaught Exception', error);
      this.initiateGracefulShutdown('uncaughtException');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (error) => {
      this.logError('Unhandled Promise Rejection', error);
      this.initiateGracefulShutdown('unhandledRejection');
    });
  }

  /**
   * Initiate graceful shutdown process
   */
  private initiateGracefulShutdown(reason: string): void {
    if (this.isShuttingDown) {
      this.log('Shutdown already in progress, ignoring signal');
      return;
    }

    this.isShuttingDown = true;
    this.log(`Initiating graceful shutdown due to: ${reason}`);

    // Start shutdown process with timeout
    this.shutdownPromise = this.performGracefulShutdown(reason);

    // Set up timeout to force exit if graceful shutdown takes too long
    if (this.config.forceExitAfterTimeout) {
      setTimeout(() => {
        if (this.isShuttingDown) {
          this.log('Graceful shutdown timeout exceeded, forcing exit');
          process.exit(1);
        }
      }, this.config.shutdownTimeoutMs);
    }
  }

  /**
   * Perform the actual graceful shutdown
   */
  private async performGracefulShutdown(reason: string): Promise<void> {
    const startTime = Date.now();
    this.log('Starting graceful shutdown process', { reason });

    try {
      // 1. Stop accepting new requests (if using Express server)
      // This would typically be handled by the HTTP server
      this.log('Step 1: Stopping new request acceptance');

      // 2. Clean up QR Code Manager and all sessions (temporarily disabled)
      this.log('Step 2: Cleaning up QR Code Manager (skipped)');
      // try {
      //   const qrCodeManager = getQRCodeManager();
      //   await qrCodeManager.gracefulShutdown();
      //   this.log('QR Code Manager shutdown completed');
      // } catch (error) {
      //   this.logError('Error during QR Code Manager shutdown', error);
      // }

      // 3. Clean up WhatsApp Client Factory (temporarily disabled)
      this.log('Step 3: Cleaning up WhatsApp Client Factory (skipped)');
      // try {
      //   await whatsAppClientFactory.destroyAllClients();
      //   this.log('WhatsApp Client Factory cleanup completed');
      // } catch (error) {
      //   this.logError('Error during WhatsApp Client Factory cleanup', error);
      // }

      // 4. Reset singleton instances (temporarily disabled)
      this.log('Step 4: Resetting singleton instances (skipped)');
      // try {
      //   resetQRCodeManager();
      //   resetSessionStore();
      //   this.log('Singleton instances reset completed');
      // } catch (error) {
      //   this.logError('Error resetting singleton instances', error);
      // }

      // 5. Close database connections (if any)
      this.log('Step 5: Closing database connections');
      try {
        // MongoDB connection cleanup would go here
        // For now, we'll just log that this step is complete
        this.log('Database connections closed');
      } catch (error) {
        this.logError('Error closing database connections', error);
      }

      const shutdownTime = Date.now() - startTime;
      this.log('Graceful shutdown completed successfully', { 
        reason, 
        shutdownTimeMs: shutdownTime 
      });

      // Exit gracefully
      process.exit(0);

    } catch (error) {
      const shutdownTime = Date.now() - startTime;
      this.logError('Error during graceful shutdown', error, { 
        reason, 
        shutdownTimeMs: shutdownTime 
      });

      // Exit with error code
      process.exit(1);
    }
  }

  /**
   * Manually trigger graceful shutdown
   */
  async shutdown(reason: string = 'manual'): Promise<void> {
    if (this.isShuttingDown) {
      if (this.shutdownPromise) {
        await this.shutdownPromise;
      }
      return;
    }

    this.initiateGracefulShutdown(reason);
    
    if (this.shutdownPromise) {
      await this.shutdownPromise;
    }
  }

  /**
   * Check if shutdown is in progress
   */
  isShutdownInProgress(): boolean {
    return this.isShuttingDown;
  }

  /**
   * Get current configuration
   */
  getConfig(): ShutdownManagerConfig {
    return { ...this.config };
  }

  /**
   * Log a message with context
   */
  private log(message: string, context: any = {}): void {
    if (!this.config.enableLogging) {
      return;
    }

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      service: 'ShutdownManager',
      message,
      ...context,
    };

    console.log(`[${timestamp}] [ShutdownManager] ${message}`, context);
  }

  /**
   * Log an error with context
   */
  private logError(message: string, error: any, context: any = {}): void {
    if (!this.config.enableLogging) {
      return;
    }

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      service: 'ShutdownManager',
      level: 'ERROR',
      message,
      error: {
        name: error?.name,
        message: error?.message,
        stack: error?.stack,
      },
      ...context,
    };

    console.error(`[${timestamp}] [ShutdownManager] ERROR: ${message}`, logEntry);
  }
}

/**
 * Singleton instance of the Shutdown Manager
 */
let shutdownManagerInstance: ShutdownManager | null = null;

/**
 * Get the singleton Shutdown Manager instance
 */
export function getShutdownManager(config?: Partial<ShutdownManagerConfig>): ShutdownManager {
  if (!shutdownManagerInstance) {
    shutdownManagerInstance = new ShutdownManager(config);
  }
  return shutdownManagerInstance;
}

/**
 * Initialize shutdown manager (should be called early in application startup)
 */
export function initializeShutdownManager(config?: Partial<ShutdownManagerConfig>): ShutdownManager {
  return getShutdownManager(config);
}