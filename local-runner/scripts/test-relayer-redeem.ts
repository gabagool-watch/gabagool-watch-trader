/**
 * Test Relayer Redemption Script
 * 
 * Usage: npx tsx scripts/test-relayer-redeem.ts [conditionId]
 * 
 * Tests multiple Polymarket API endpoints for claiming positions.
 * If no conditionId is provided, it will fetch and display claimable positions.
 */

import '../src/config.js';
import { config } from '../src/config.js';
import pkg from 'ethers';
const { ethers } = pkg;
import crypto from 'node:crypto';

// Possible endpoints to try
const ENDPOINTS = [
  'https://clob.polymarket.com',      // Main CLOB API
  'https://gamma-api.polymarket.com', // Gamma API
];
const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const DATA_API_URL = 'https://data-api.polymarket.com';

const CTF_REDEEM_ABI = [
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] calldata indexSets) external',
];

function toUrlSafeBase64(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_');
}

function sanitizeBase64Secret(secret: string): string {
  let s = secret.trim()
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/[^A-Za-z0-9+/=]/g, '');

  const pad = s.length % 4;
  if (pad === 2) s += '==';
  if (pad === 3) s += '=';
  return s;
}

function buildRelayerSignature(
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

interface Position {
  conditionId: string;
  size: number;
  currentValue: number;
  redeemable: boolean;
  title: string;
  outcome: string;
}

async function fetchClaimablePositions(): Promise<Position[]> {
  const wallet = config.polymarket.address;
  console.log(`\n📋 Fetching positions for ${wallet}...\n`);

  const response = await fetch(`${DATA_API_URL}/positions?user=${wallet}&sizeThreshold=0&limit=100`);
  if (!response.ok) {
    console.error(`❌ Failed to fetch positions: HTTP ${response.status}`);
    return [];
  }

  const data = await response.json();
  const positions = Array.isArray(data) ? data : data.positions || [];
  
  return positions
    .filter((p: any) => p.redeemable)
    .map((p: any) => ({
      conditionId: p.conditionId,
      size: p.size || 0,
      currentValue: p.currentValue || 0,
      redeemable: p.redeemable,
      title: p.title || p.slug || '',
      outcome: p.outcome || '',
    }));
}

async function testRelayerRedeem(conditionId: string): Promise<void> {
  const collateralToken = config.polymarket.usdcAddress;
  const proxyWallet = config.polymarket.address;

  console.log(`\n🧪 TEST RELAYER REDEMPTION`);
  console.log('='.repeat(60));
  console.log(`📍 Proxy wallet: ${proxyWallet}`);
  console.log(`📍 Condition ID: ${conditionId}`);
  console.log(`📍 Collateral: ${collateralToken}`);

  // Check credentials
  if (!config.polymarket.builderApiKey || !config.polymarket.builderApiSecret || !config.polymarket.builderPassphrase) {
    console.error(`\n❌ Missing Builder credentials!`);
    console.error(`   POLY_BUILDER_API_KEY: ${config.polymarket.builderApiKey ? '✅' : '❌'}`);
    console.error(`   POLY_BUILDER_API_SECRET: ${config.polymarket.builderApiSecret ? '✅' : '❌'}`);
    console.error(`   POLY_BUILDER_PASSPHRASE: ${config.polymarket.builderPassphrase ? '✅' : '❌'}`);
    process.exit(1);
  }

  console.log(`\n✅ Builder credentials configured`);

  // Build the CTF redeemPositions calldata
  const indexSets = [1, 2];
  const parentCollectionId = ethers.utils.hexZeroPad('0x00', 32);

  const ctfInterface = new ethers.utils.Interface(CTF_REDEEM_ABI);
  const redeemCalldata = ctfInterface.encodeFunctionData('redeemPositions', [
    collateralToken,
    parentCollectionId,
    conditionId,
    indexSets,
  ]);

  console.log(`\n📦 Transaction:`);
  console.log(`   to: ${CTF_ADDRESS}`);
  console.log(`   data: ${redeemCalldata.slice(0, 66)}...`);
  console.log(`   value: 0`);

  // Try multiple endpoints and paths
  const pathsToTry = [
    '/execute',
    '/relay/execute', 
    '/v1/execute',
    '/order',  // Maybe orders endpoint accepts redeems?
  ];

  for (const baseUrl of ENDPOINTS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔗 Testing endpoint: ${baseUrl}`);
    
    // First, test if endpoint is reachable
    try {
      const healthCheck = await fetch(`${baseUrl}/`, { method: 'GET' });
      console.log(`   Health check: ${healthCheck.status} ${healthCheck.statusText}`);
    } catch (e: any) {
      console.log(`   ❌ Endpoint not reachable: ${e.message}`);
      continue;
    }

    for (const path of pathsToTry) {
      console.log(`\n   📡 Trying ${path}...`);

      const redeemTx = {
        to: CTF_ADDRESS,
        data: redeemCalldata,
        value: '0',
      };

      const payload = {
        transactions: [redeemTx],
        description: `Test claim: ${conditionId.slice(0, 20)}...`,
      };

      const bodyStr = JSON.stringify(payload);
      const timestampSeconds = String(Math.floor(Date.now() / 1000));

      const secretBytes = Buffer.from(
        sanitizeBase64Secret(config.polymarket.builderApiSecret),
        'base64'
      );
      const signature = buildRelayerSignature(
        secretBytes,
        timestampSeconds,
        'POST',
        path,
        bodyStr
      );

      try {
        const response = await fetch(`${baseUrl}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'POLY_ADDRESS': proxyWallet,
            'POLY_API_KEY': config.polymarket.builderApiKey,
            'POLY_PASSPHRASE': config.polymarket.builderPassphrase,
            'POLY_SIGNATURE': signature,
            'POLY_TIMESTAMP': timestampSeconds,
          },
          body: bodyStr,
        });

        const responseText = await response.text();
        
        console.log(`      Status: ${response.status} ${response.statusText}`);
        console.log(`      Body: ${responseText.slice(0, 300)}`);

        if (response.ok) {
          console.log(`\n   ✅ SUCCESS! Found working endpoint: ${baseUrl}${path}`);
          
          let result: any;
          try {
            result = JSON.parse(responseText);
          } catch {
            result = { raw: responseText };
          }
          
          const txHash = result?.transactionHash || result?.txHash || result?.hash || result?.id;
          if (txHash) {
            console.log(`   🔗 Transaction: ${txHash}`);
            console.log(`   📍 View on PolygonScan: https://polygonscan.com/tx/${txHash}`);
          }
          return;
        }

      } catch (e: any) {
        console.log(`      ❌ Error: ${e.message}`);
      }
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`❌ No working endpoint found for relayer redemptions.`);
  console.log(`\n💡 The Polymarket Relayer API might require:`);
  console.log(`   - Special access/whitelisting for builders`);
  console.log(`   - A different authentication method`);
  console.log(`   - Using the CLOB SDK directly instead of raw HTTP`);
  console.log(`\n📚 Check Polymarket Builder docs: https://docs.polymarket.com/`);
}

async function main() {
  const conditionIdArg = process.argv[2];

  if (conditionIdArg) {
    // Test with provided conditionId
    await testRelayerRedeem(conditionIdArg);
  } else {
    // Show claimable positions
    const positions = await fetchClaimablePositions();
    
    if (positions.length === 0) {
      console.log(`\n✅ No claimable positions found`);
      console.log(`\n💡 To test with a specific conditionId:`);
      console.log(`   npx tsx scripts/test-relayer-redeem.ts 0x1234...`);
      return;
    }

    console.log(`\n💰 Found ${positions.length} claimable position(s):\n`);
    
    for (const p of positions) {
      console.log(`   ${p.outcome} | $${p.currentValue.toFixed(2)} | ${p.title.slice(0, 40)}`);
      console.log(`   ConditionId: ${p.conditionId}`);
      console.log();
    }

    console.log(`\n💡 To claim a position, run:`);
    console.log(`   npx tsx scripts/test-relayer-redeem.ts ${positions[0].conditionId}`);
  }
}

main().catch(console.error);
