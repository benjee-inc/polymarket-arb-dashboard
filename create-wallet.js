#!/usr/bin/env node
import { ethers } from 'ethers';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const args = new Set(process.argv.slice(2));
const showSecretOnce = args.has('--show-secret-once');
const writePlaintextConfig = args.has('--write-plaintext-config');

console.log('🎯 Polymarket Wallet Creator\n');

// Generate new wallet
const wallet = ethers.Wallet.createRandom();
const address = wallet.address;
const privateKey = wallet.privateKey;
const mnemonic = wallet.mnemonic?.phrase;

console.log('✅ New Wallet Generated!');
console.log('=======================\n');
console.log('Address:', address);

if (showSecretOnce) {
  console.log('\n⚠️  SECRET MATERIAL — DISPLAY ONCE ONLY');
  console.log('Private Key:', privateKey);
  console.log('Mnemonic:', mnemonic || 'N/A');
  console.log('\n⚠️  Store these details in a password manager or secret manager.');
  console.log('    Anyone with this material can control the wallet.');
} else {
  console.log('\n🔒 Private key and mnemonic were generated but not printed.');
  console.log('   Re-run with --show-secret-once only in a private terminal if you need to capture them.');
}

const configDir = join(homedir(), '.config', 'polymarket');
if (!existsSync(configDir)) {
  mkdirSync(configDir, { recursive: true });
}

const configPath = join(configDir, 'config.json');
const config = {
  eoa: {
    address,
    privateKey: writePlaintextConfig ? privateKey : '<set POLYMARKET_PRIVATE_KEY in your secret manager>'
  },
  proxy: {
    signatureType: 'eoa',
    address // Will be updated when proxy is created
  },
  network: 'polygon',
  createdAt: new Date().toISOString()
};

writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
console.log('\n💾 Configuration template saved to:', configPath);

if (writePlaintextConfig) {
  console.log('⚠️  Plaintext private key was written because --write-plaintext-config was passed.');
  console.log('    Treat this file as a secret and do not sync or commit it.');
} else {
  console.log('🔒 Private key was NOT written to config by default.');
}

console.log('\nNext steps:');
console.log('1. Securely store the private key/mnemonic before funding the wallet.');
console.log('2. Fund this address with USDC.e on Polygon only when ready:', address);
console.log('3. Export POLYMARKET_PRIVATE_KEY from a secret manager for local sessions.');
console.log('4. Run: moon market positions (to verify)');
console.log('5. Set approvals before trading');
