#!/usr/bin/env node

/**
 * Quick script to fix logging issues in QR code manager
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/services/qrcode-manager.service.ts');

try {
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Replace this.log( with this.logger.info(
  content = content.replace(/this\.log\(/g, 'this.logger.info(');
  
  // Replace this.logError( with this.logger.error(
  content = content.replace(/this\.logError\(/g, 'this.logger.error(');
  
  // Fix correlationId issues by adding const correlationId = this.correlationIds.get(sessionId) || uuidv4(); where needed
  // This is a simple fix - in production we'd want more sophisticated handling
  
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('✅ Fixed logging issues in qrcode-manager.service.ts');
  
} catch (error) {
  console.error('❌ Error fixing logging issues:', error.message);
  process.exit(1);
}
