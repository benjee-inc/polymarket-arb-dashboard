#!/usr/bin/env node
import { ethers } from 'ethers';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

console.log('🎯 Polymarket Wallet Creator\n');

// Generate new wallet
const wallet = ethers.Wallet.createRandom();
const address = wallet.address;
const privateKey = wallet.privateKey;
const mnemonic = wallet.mnemonic?.phrase;

console.log('✅ New Wallet Generated!');
console.log('=======================\n');
console.log('Address:', address);
console.log('Private Key:', privateKey);
console.log('Mnemonic:', mnemonic || 'N/A');
console.log('\n⚠️  IMPORTANT: Save these details securely!');
console.log('    If lost, your funds cannot be recovered.\n');

// Save to config file
const configDir = join(homedir(), '.config', 'polymarket');
if (!existsSync(configDir)) {
  mkdirSync(configDir, { recursive: true });
}

const configPath = join(configDir, 'config.json');
const config = {
  eoa: {
    address: address,
    privateKey: privateKey
  },
  proxy: {
    signatureType: 'eoa',
    address: address  // Will be updated when proxy is created
  },
  network: 'polygon',
  createdAt: new Date().toISOString()
};

writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('💾 Configuration saved to:', configPath);
console.log('\nNext steps:');
console.log('1. Fund this address with USDC.e on Polygon:', address);
console.log('2. Set environment variable: export POLYMARKET_PRIVATE_KEY="' + privateKey + '"');
console.log('3. Run: moon market positions (to verify)');
console.log('4. Set approvals before trading');
