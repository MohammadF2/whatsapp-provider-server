/**
 * Shutdown Manager Tests
 * 
 * Test suite for the shutdown manager service including:
 * - Signal handling
 * - Graceful shutdown process
 * - Timeout handling
 * - Resource cleanup
 */

import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { ShutdownManager, getShutdownManager } from '../shutdown-manager.service';

// Mock the QR Code Manager
vi.mock('../qrcode-manager.service', () => ({
  getQRCodeManager: vi.fn(() => ({
    gracefulShutdown: vi.fn().mockResolvedValue(undefined),
  })),
  resetQRCodeManager: vi.fn(),
}));

// Mock the Session Store
vi.mock('../session-store.service', () => ({
  resetSessionStore: vi.fn(),
}));

// Mock the WhatsApp Client Factory
vi.mock('../whatsapp-client-factory.service', () => ({
  default: {
    destroyAllClients: vi.fn().mockResolvedValue(undefined),
  }
}));

describe('Shutdown Manager', () => {
  let shutdownManager: ShutdownManager;
  let mockQRCodeManager: any;
  let mockClientFactory: any;
  let mockResetQRCodeManager: Mock;
  let mockResetSessionStore: Mock;
  let originalProcessExit: typeof process.exit;
  let mockProcessExit: Mock;

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock process.exit
    originalProcessExit = process.exit;
    mockProcessExit = vi.fn();
    process.exit = mockProcessExit as any;

    // Get mocked modules
    const qrCodeManagerModule = await import('../qrcode-manager.service');
    const sessionStoreModule = await import('../session-store.service');
    const clientFactoryModule = await import('../whatsapp-client-factory.service');

    mockQRCodeManager = (qrCodeManagerModule.getQRCodeManager as Mock)();
    mockClientFactory = clientFactoryModule.default;
    mockResetQRCodeManager = qrCodeManagerModule.resetQRCodeManager as Mock;
    mockResetSessionStore = sessionStoreModule.resetSessionStore as Mock;

    // Create shutdown manager with test configuration
    shutdownManager = new ShutdownManager({
      shutdownTimeoutMs: 5000, // Short timeout for tests
      enableLogging: false, // Disable logging in tests
      forceExitAfterTimeout: false, // Don't force exit in tests
    });
  });

  afterEach(() => {
    // Restore original process.exit
    process.exit = originalProcessExit;
    
    // Remove all listeners to prevent interference between tests
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGHUP');
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
  });

  describe('Signal Handling', () => {
    it('should handle SIGTERM signal', async () => {
      // Arrange
      const shutdownSpy = vi.spyOn(shutdownManager as any, 'initiateGracefulShutdown');

      // Act
      process.emit('SIGTERM');

      // Wait a bit for async operations
      await new Promise(resolve => setTimeout(resolve, 100));

      // Assert
      expect(shutdownSpy).toHaveBeenCalledWith('SIGTERM');
    });

    it('should handle SIGINT signal', async () => {
      // Arrange
      const shutdownSpy = vi.spyOn(shutdownManager as any, 'initiateGracefulShutdown');

      // Act
      process.emit('SIGINT');

      // Wait a bit for async operations
      await new Promise(resolve => setTimeout(resolve, 100));

      // Assert
      expect(shutdownSpy).toHaveBeenCalledWith('SIGINT');
    });

    it('should handle SIGHUP signal', async () => {
      // Arrange
      const shutdownSpy = vi.spyOn(shutdownManager as any, 'initiateGracefulShutdown');

      // Act
      process.emit('SIGHUP');

      // Wait a bit for async operations
      await new Promise(resolve => setTimeout(resolve, 100));

      // Assert
      expect(shutdownSpy).toHaveBeenCalledWith('SIGHUP');
    });

    it('should handle uncaught exceptions', async () => {
      // Arrange
      const shutdownSpy = vi.spyOn(shutdownManager as any, 'initiateGracefulShutdown');
      const testError = new Error('Test uncaught exception');

      // Act
      process.emit('uncaughtException', testError);

      // Wait a bit for async operations
      await new Promise(resolve => setTimeout(resolve, 100));

      // Assert
      expect(shutdownSpy).toHaveBeenCalledWith('uncaughtException');
    });

    it('should handle unhandled promise rejections', async () => {
      // Arrange
      const shutdownSpy = vi.spyOn(shutdownManager as any, 'initiateGracefulShutdown');
      const testError = new Error('Test unhandled rejection');

      // Act
      process.emit('unhandledRejection', testError);

      // Wait a bit for async operations
      await new Promise(resolve => setTimeout(resolve, 100));

      // Assert
      expect(shutdownSpy).toHaveBeenCalledWith('unhandledRejection');
    });

    it('should ignore duplicate signals during shutdown', async () => {
      // Arrange
      const shutdownSpy = vi.spyOn(shutdownManager as any, 'initiateGracefulShutdown');

      // Act
      process.emit('SIGTERM');
      process.emit('SIGTERM'); // Second signal should be ignored

      // Wait a bit for async operations
      await new Promise(resolve => setTimeout(resolve, 100));

      // Assert
      expect(shutdownSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Graceful Shutdown Process', () => {
    it('should perform complete graceful shutdown', async () => {
      // Act
      await shutdownManager.shutdown('test');

      // Assert
      expect(mockQRCodeManager.gracefulShutdown).toHaveBeenCalled();
      expect(mockClientFactory.destroyAllClients).toHaveBeenCalled();
      expect(mockResetQRCodeManager).toHaveBeenCalled();
      expect(mockResetSessionStore).toHaveBeenCalled();
      expect(mockProcessExit).toHaveBeenCalledWith(0);
    });

    it('should handle QR Code Manager shutdown failure', async () => {
      // Arrange
      mockQRCodeManager.gracefulShutdown.mockRejectedValue(new Error('QR Manager shutdown failed'));

      // Act
      await shutdownManager.shutdown('test');

      // Assert - should continue with other cleanup steps
      expect(mockClientFactory.destroyAllClients).toHaveBeenCalled();
      expect(mockResetQRCodeManager).toHaveBeenCalled();
      expect(mockResetSessionStore).toHaveBeenCalled();
      expect(mockProcessExit).toHaveBeenCalledWith(0); // Should still exit successfully
    });

    it('should handle WhatsApp Client Factory cleanup failure', async () => {
      // Arrange
      mockClientFactory.destroyAllClients.mockRejectedValue(new Error('Client factory cleanup failed'));

      // Act
      await shutdownManager.shutdown('test');

      // Assert - should continue with other cleanup steps
      expect(mockQRCodeManager.gracefulShutdown).toHaveBeenCalled();
      expect(mockResetQRCodeManager).toHaveBeenCalled();
      expect(mockResetSessionStore).toHaveBeenCalled();
      expect(mockProcessExit).toHaveBeenCalledWith(0); // Should still exit successfully
    });

    it('should handle singleton reset failures', async () => {
      // Arrange
      mockResetQRCodeManager.mockImplementation(() => {
        throw new Error('Reset failed');
      });

      // Act
      await shutdownManager.shutdown('test');

      // Assert - should continue and complete shutdown
      expect(mockQRCodeManager.gracefulShutdown).toHaveBeenCalled();
      expect(mockClientFactory.destroyAllClients).toHaveBeenCalled();
      expect(mockResetSessionStore).toHaveBeenCalled();
      expect(mockProcessExit).toHaveBeenCalledWith(0); // Should still exit successfully
    });

    it('should exit with error code on critical failure', async () => {
      // Arrange - make all operations fail
      mockQRCodeManager.gracefulShutdown.mockRejectedValue(new Error('Critical failure'));
      mockClientFactory.destroyAllClients.mockRejectedValue(new Error('Critical failure'));
      mockResetQRCodeManager.mockImplementation(() => {
        throw new Error('Critical failure');
      });

      // Mock the performGracefulShutdown to throw
      const originalPerformGracefulShutdown = (shutdownManager as any).performGracefulShutdown;
      (shutdownManager as any).performGracefulShutdown = vi.fn().mockRejectedValue(new Error('Critical failure'));

      // Act
      await shutdownManager.shutdown('test');

      // Assert
      expect(mockProcessExit).toHaveBeenCalledWith(1);

      // Restore original method
      (shutdownManager as any).performGracefulShutdown = originalPerformGracefulShutdown;
    });
  });

  describe('Timeout Handling', () => {
    it('should force exit after timeout when configured', (done) => {
      // Arrange
      const timeoutShutdownManager = new ShutdownManager({
        shutdownTimeoutMs: 100, // Very short timeout
        enableLogging: false,
        forceExitAfterTimeout: true,
      });

      // Mock graceful shutdown to hang
      mockQRCodeManager.gracefulShutdown.mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 1000)) // Longer than timeout
      );

      // Set up timeout to check if process.exit was called
      setTimeout(() => {
        expect(mockProcessExit).toHaveBeenCalledWith(1);
        done();
      }, 200);

      // Act
      timeoutShutdownManager.shutdown('test');
    });

    it('should not force exit when forceExitAfterTimeout is false', async () => {
      // Arrange
      const timeoutShutdownManager = new ShutdownManager({
        shutdownTimeoutMs: 100, // Very short timeout
        enableLogging: false,
        forceExitAfterTimeout: false,
      });

      // Mock graceful shutdown to complete quickly
      mockQRCodeManager.gracefulShutdown.mockResolvedValue(undefined);

      // Act
      await timeoutShutdownManager.shutdown('test');

      // Wait a bit more than the timeout
      await new Promise(resolve => setTimeout(resolve, 200));

      // Assert - should have exited normally, not due to timeout
      expect(mockProcessExit).toHaveBeenCalledWith(0);
    });
  });

  describe('State Management', () => {
    it('should track shutdown state correctly', () => {
      // Arrange
      expect(shutdownManager.isShutdownInProgress()).toBe(false);

      // Act
      shutdownManager.shutdown('test');

      // Assert
      expect(shutdownManager.isShutdownInProgress()).toBe(true);
    });

    it('should return current configuration', () => {
      // Act
      const config = shutdownManager.getConfig();

      // Assert
      expect(config).toEqual({
        shutdownTimeoutMs: 5000,
        enableLogging: false,
        forceExitAfterTimeout: false,
      });
    });

    it('should handle multiple shutdown calls gracefully', async () => {
      // Act
      const shutdown1 = shutdownManager.shutdown('test1');
      const shutdown2 = shutdownManager.shutdown('test2');

      await Promise.all([shutdown1, shutdown2]);

      // Assert - QR Code Manager should only be shut down once
      expect(mockQRCodeManager.gracefulShutdown).toHaveBeenCalledTimes(1);
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance when called multiple times', () => {
      // Act
      const instance1 = getShutdownManager();
      const instance2 = getShutdownManager();

      // Assert
      expect(instance1).toBe(instance2);
    });

    it('should use provided configuration on first call', () => {
      // Act
      const instance = getShutdownManager({
        shutdownTimeoutMs: 10000,
        enableLogging: true,
      });

      // Assert
      const config = instance.getConfig();
      expect(config.shutdownTimeoutMs).toBe(10000);
      expect(config.enableLogging).toBe(true);
    });
  });
});