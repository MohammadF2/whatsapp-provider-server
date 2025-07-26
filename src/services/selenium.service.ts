import { Builder, WebDriver, Capabilities } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome';
import firefox from 'selenium-webdriver/firefox';
import path from 'path';

/**
 * SeleniumDriverManager - A class to manage Selenium WebDriver instances
 * 
 * This class provides methods to:
 * - Create and store driver instances for each device
 * - Configure browser options (Chrome or Firefox)
 * - Manage driver lifecycle (create, get, close)
 */
class SeleniumDriverManager {
  // Private storage for active driver instances (in-memory cache)
  private drivers: { [deviceId: string]: WebDriver } = {};
  
  // Default session path for storing browser profiles
  private readonly sessionBasePath = path.join(process.cwd(), 'sessions');

  /**
   * Creates a new Selenium WebDriver instance for a device
   * @param deviceId The device ID to associate with the driver
   * @param browserType The browser type ('chrome' or 'firefox')
   * @param options Additional browser-specific options
   * @returns The created WebDriver instance
   */
  async createDriver(
    deviceId: string, 
    browserType: 'chrome' | 'firefox' = 'chrome',
    options: {
      headless?: boolean;
      userDataDir?: string;
      userAgent?: string;
      extraArgs?: string[];
    } = {}
  ): Promise<WebDriver> {
    console.log(`[SeleniumDriverManager] Creating ${browserType} driver for device ${deviceId}`);

    // Close existing driver if it exists
    await this.closeDriver(deviceId);
    
    const sessionPath = options.userDataDir || path.join(this.sessionBasePath, `session-${deviceId}`);
    
    let driver: WebDriver;
    
    try {
      if (browserType === 'chrome') {
        const chromeOptions = new chrome.Options();
        
        // Set user data directory for session persistence
        chromeOptions.addArguments(`user-data-dir=${sessionPath}`);
        
        // Apply headless mode if requested
        if (options.headless) {
          chromeOptions.addArguments('--headless=new');
        }
        
        // Set custom user agent if provided
        if (options.userAgent) {
          chromeOptions.addArguments(`user-agent=${options.userAgent}`);
        }
        
        // Add any additional arguments
        if (options.extraArgs && options.extraArgs.length > 0) {
          options.extraArgs.forEach(arg => chromeOptions.addArguments(arg));
        }
        
        // Add default arguments for WhatsApp Web
        chromeOptions.addArguments(
          '--disable-notifications',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--window-size=1280,800'
        );
        
        // Create Chrome driver
        driver = await new Builder()
          .forBrowser('chrome')
          .setChromeOptions(chromeOptions)
          .build();
            } else if (browserType === 'firefox') {
        console.log(`[SeleniumDriverManager] Configuring Firefox driver for device ${deviceId}`);
        
        // Create new Firefox options
        const firefoxOptions = new firefox.Options();
        const firefoxCapabilities = Capabilities.firefox();
        
        // Set Firefox profile path
        console.log(`[SeleniumDriverManager] Using Firefox profile at: ${sessionPath}`);
        firefoxOptions.setProfile(sessionPath);
        
        // Apply headless mode if requested
        if (options.headless) {
          console.log(`[SeleniumDriverManager] Enabling Firefox headless mode`);
          // Use addArguments instead of headless() method which isn't recognized by TypeScript
          firefoxOptions.addArguments('--headless');
          // Also set the MOZ_HEADLESS environment variable which is an alternative way
          process.env.MOZ_HEADLESS = '1';
        }
        
        // Add standard arguments for better stability
        const standardArgs = [
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-sandbox',
          '--window-size=1280,800',
          '--disable-notifications'
        ];
        
        standardArgs.forEach(arg => firefoxOptions.addArguments(arg));
        
        // Add custom user agent if provided
        if (options.userAgent) {
          console.log(`[SeleniumDriverManager] Setting Firefox user agent: ${options.userAgent}`);
          firefoxOptions.addArguments(`-user-agent=${options.userAgent}`);
          // Also set a preference as alternative method
          firefoxOptions.setPreference('general.useragent.override', options.userAgent);
        }
        
        // Add any additional arguments
        if (options.extraArgs && options.extraArgs.length > 0) {
          console.log(`[SeleniumDriverManager] Adding extra Firefox arguments: ${options.extraArgs.join(', ')}`);
          options.extraArgs.forEach(arg => firefoxOptions.addArguments(arg));
        }
        
        // Set additional preferences for better compatibility with WhatsApp
        firefoxOptions.setPreference('dom.webnotifications.enabled', false);
        firefoxOptions.setPreference('media.navigator.permission.disabled', true);
        firefoxOptions.setPreference('media.autoplay.default', 0);
        
        // Create Firefox driver with enhanced logging
        console.log(`[SeleniumDriverManager] Building Firefox driver...`);
        driver = await new Builder()
          .forBrowser('firefox')
          .withCapabilities(firefoxCapabilities)
          .setFirefoxOptions(firefoxOptions)
          .build();
        
        console.log(`[SeleniumDriverManager] Firefox driver successfully built for device ${deviceId}`);
          
      } else {
        throw new Error(`Unsupported browser type: ${browserType}`);
      }
      
      // Store the driver instance
      this.drivers[deviceId] = driver;
      
      console.log(`[SeleniumDriverManager] Successfully created ${browserType} driver for device ${deviceId}`);
      return driver;
      
    } catch (error) {
      console.error(`[SeleniumDriverManager] Error creating driver for device ${deviceId}:`, error);
      throw error;
    }
  }

  /**
   * Get an existing WebDriver instance for a device
   * @param deviceId The device ID
   * @returns The WebDriver instance or undefined if not found
   */
  async getDriver(deviceId: string): Promise<WebDriver | undefined> {
    const driver = this.drivers[deviceId];
    
    if (!driver) {
      console.log(`[SeleniumDriverManager] No driver found for device ${deviceId}`);
      return undefined;
    }
    
    try {
      // Verify the driver session is still valid
      await driver.getTitle();
      return driver;
    } catch (error) {
      console.log(`[SeleniumDriverManager] Driver for device ${deviceId} is no longer valid, removing from cache`);
      delete this.drivers[deviceId];
      return undefined;
    }
  }

  /**
   * Close and remove a WebDriver instance for a device
   * @param deviceId The device ID
   * @returns true if driver was closed successfully, false if no driver was found
   */
  async closeDriver(deviceId: string): Promise<boolean> {
    const driver = this.drivers[deviceId];
    
    if (!driver) {
      return false;
    }
    
    try {
      console.log(`[SeleniumDriverManager] Closing driver for device ${deviceId}`);
      await driver.quit();
      delete this.drivers[deviceId];
      return true;
    } catch (error) {
      console.error(`[SeleniumDriverManager] Error closing driver for device ${deviceId}:`, error);
      // Still remove from cache
      delete this.drivers[deviceId];
      return false;
    }
  }
  
  /**
   * Navigate the browser to a URL
   * @param deviceId The device ID
   * @param url The URL to navigate to
   * @returns true if navigation was successful, false otherwise
   */
  async navigateTo(deviceId: string, url: string): Promise<boolean> {
    const driver = await this.getDriver(deviceId);
    
    if (!driver) {
      console.error(`[SeleniumDriverManager] No driver found for device ${deviceId}`);
      return false;
    }
    
    try {
      await driver.get(url);
      return true;
    } catch (error) {
      console.error(`[SeleniumDriverManager] Error navigating to ${url} for device ${deviceId}:`, error);
      return false;
    }
  }
  
  /**
   * Check if a driver exists and is active for a device
   * @param deviceId The device ID
   * @returns true if driver exists and is active, false otherwise
   */
  async hasActiveDriver(deviceId: string): Promise<boolean> {
    try {
      const driver = await this.getDriver(deviceId);
      return !!driver;
    } catch {
      return false;
    }
  }
}

// Create a singleton instance
const seleniumDriverManager = new SeleniumDriverManager();

export default seleniumDriverManager;
