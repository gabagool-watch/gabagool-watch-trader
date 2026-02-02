/**
 * Test Relayer v2 Redemption Script
 *
 * Uses the CORRECT Polymarket Builder Relayer v2 API for gasless claims.
 * This is the official method for Magic/Email (proxy) wallets.
 *
 * Reference: https://docs.polymarket.com/developers/builders/relayer-client
 *
 * Usage:
 *   cd local-runner
 *   npx tsx scripts/test-relayer-v2.ts <conditionId>
 */

import '../src/config.js';
import { config } from '../src/config.js';
import pkg from 'ethers';
const { ethers } = pkg as any;
import crypto from 'node:crypto';

const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';

// Polymarket Relayer v2 endpoints (correct URLs)
const RELAYER_V2_BASE = 'https://relayer-v2.polymarket.com';
const RELAYER_CLOB_BASE = 'https://clob.polymarket.com';

const CTF_REDEEM_ABI = [
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] calldata indexSets) external',
];

function toUrlSafeBase64(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_');
}

function sanitizeBase64Secret(secret: string): string {
  let s = secret
    .trim()
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/[^A-Za-z0-9+/=]/g, '');

  const pad = s.length % 4;
  if (pad === 2) s += '==';
  if (pad === 3) s += '=';
  return s;
}

function buildHmacSignature(
  secretBytes: Buffer,
  timestampSeconds: string,
  method: string,
  requestPath: string,
  body: string = ''
): string {
  const message = `${timestampSeconds}${method.toUpperCase()}${requestPath}${body}`;
  const digest = crypto.createHmac('sha256', secretBytes).update(message).digest();
  return toUrlSafeBase64(Buffer.from(digest).toString('base64'));
}

function requireBuilderCreds(): void {
  if (!config.polymarket.builderApiKey || !config.polymarket.builderApiSecret || !config.polymarket.builderPassphrase) {
    console.error('\n❌ Missing Builder credentials!');
    console.error(`   POLY_BUILDER_API_KEY: ${config.polymarket.builderApiKey ? '✅' : '❌'}`);
    console.error(`   POLY_BUILDER_API_SECRET: ${config.polymarket.builderApiSecret ? '✅' : '❌'}`);
    console.error(`   POLY_BUILDER_PASSPHRASE: ${config.polymarket.builderPassphrase ? '✅' : '❌'}`);
    console.error('\n   Get these from: https://docs.polymarket.com/developers/builders');
    process.exit(1);
  }
}

// Test all known relayer endpoint variations
const ENDPOINTS_TO_TRY = [
  // Relayer v2 (new official)
  { label: 'Relayer v2 /execute', baseUrl: RELAYER_V2_BASE, path: '/execute' },
  { label: 'Relayer v2 /relay', baseUrl: RELAYER_V2_BASE, path: '/relay' },
  { label: 'Relayer v2 /relay/execute', baseUrl: RELAYER_V2_BASE, path: '/relay/execute' },
  { label: 'Relayer v2 /v1/execute', baseUrl: RELAYER_V2_BASE, path: '/v1/execute' },
  // CLOB-integrated relayer (fallback)
  { label: 'CLOB /relayer/execute', baseUrl: RELAYER_CLOB_BASE, path: '/relayer/execute' },
  { label: 'CLOB /relay/execute', baseUrl: RELAYER_CLOB_BASE, path: '/relay/execute' },
];

async function tryEndpoint(
  endpoint: { label: string; baseUrl: string; path: string },
  payload: object,
  proxyWallet: string,
  secretBytes: Buffer
): Promise<{ success: boolean; status?: number; body?: string; error?: string }> {
  const bodyStr = JSON.stringify(payload);
  const timestampSeconds = String(Math.floor(Date.now() / 1000));
  
  // CORRECT headers: POLY_BUILDER_* prefix
  const signature = buildHmacSignature(secretBytes, timestampSeconds, 'POST', endpoint.path, bodyStr);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // Builder API headers (official)
    'POLY_BUILDER_API_KEY': config.polymarket.builderApiKey,
    'POLY_BUILDER_PASSPHRASE': config.polymarket.builderPassphrase,
    'POLY_BUILDER_SIGNATURE': signature,
    'POLY_BUILDER_TIMESTAMP': timestampSeconds,
    // Also include POLY_ADDRESS for wallet identification
    'POLY_ADDRESS': proxyWallet,
  };

  try {
    const res = await fetch(`${endpoint.baseUrl}${endpoint.path}`, {
      method: 'POST',
      headers,
      body: bodyStr,
    });

    const text = await res.text();
    return {
      success: res.ok,
      status: res.status,
      body: text.slice(0, 500),
    };
  } catch (e: any) {
    return {
      success: false,
      error: e?.message || String(e),
    };
  }
}

async function main() {
  const conditionId = process.argv[2];
  if (!conditionId) {
    console.error('Usage: npx tsx scripts/test-relayer-v2.ts <conditionId>');
    process.exit(1);
  }

  const collateralToken = config.polymarket.usdcAddress;
  const proxyWallet = config.polymarket.address;

  console.log(`\n🧪 TEST RELAYER V2 REDEMPTION (Builder API)`);
  console.log('='.repeat(60));
  console.log(`📍 Proxy wallet: ${proxyWallet}`);
  console.log(`📍 Condition ID: ${conditionId}`);
  console.log(`📍 Collateral: ${collateralToken}`);

  requireBuilderCreds();
  console.log(`\n✅ Builder credentials configured`);
  console.log(`   API Key: ${config.polymarket.builderApiKey.slice(0, 10)}...`);

  // Build redeemPositions calldata
  const indexSets = [1, 2]; // Binary market
  const parentCollectionId = ethers.utils.hexZeroPad('0x00', 32);
  const ctfInterface = new ethers.utils.Interface(CTF_REDEEM_ABI);
  const redeemCalldata = ctfInterface.encodeFunctionData('redeemPositions', [
    collateralToken,
    parentCollectionId,
    conditionId,
    indexSets,
  ]);

  // Payload format per docs
  const payload = {
    transactions: [
      {
        to: CTF_ADDRESS,
        data: redeemCalldata,
        value: '0',
      },
    ],
    description: `Auto-claim for ${conditionId.slice(0, 20)}...`,
  };

  const secretBytes = Buffer.from(sanitizeBase64Secret(config.polymarket.builderApiSecret), 'base64');

  console.log(`\n📡 Testing ${ENDPOINTS_TO_TRY.length} endpoint variations...\n`);

  for (const endpoint of ENDPOINTS_TO_TRY) {
    console.log(`🔗 ${endpoint.label}: ${endpoint.baseUrl}${endpoint.path}`);
    
    // Health check
    try {
      const hc = await fetch(`${endpoint.baseUrl}/`, { method: 'GET' });
      console.log(`   Health: ${hc.status} ${hc.statusText}`);
    } catch (e: any) {
      console.log(`   Health: ❌ ${e?.message}`);
    }

    // Try execute
    const result = await tryEndpoint(endpoint, payload, proxyWallet, secretBytes);
    
    if (result.success) {
      console.log(`   ✅ SUCCESS! Status: ${result.status}`);
      console.log(`   Response: ${result.body}`);
      console.log(`\n🎉 WORKING ENDPOINT FOUND: ${endpoint.baseUrl}${endpoint.path}`);
      return;
    } else if (result.error) {
      console.log(`   ❌ Network error: ${result.error}`);
    } else {
      console.log(`   ❌ HTTP ${result.status}: ${result.body}`);
    }
    console.log('');
  }

  console.log(`\n❌ No working relayer endpoint found.`);
  console.log(`\n💡 FALLBACK OPTIONS:`);
  console.log(`   1. Use on-chain proxy.execute() if you have the owner private key`);
  console.log(`   2. Claim manually via polymarket.com`);
  console.log(`   3. Contact Polymarket support for Builder API access`);
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
