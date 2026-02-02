/**
 * Test Relayer Redemption Script (v2)
 *
 * Usage:
 *   cd local-runner
 *   npx tsx scripts/test-relayer-redeem-v2.ts <conditionId>
 *
 * Purpose:
 * - Tries known relayer host/path combinations (notably /relayer/execute on clob.polymarket.com)
 * - Prints detailed network error causes for "fetch failed" (DNS/TLS/timeout)
 */

import '../src/config.js';
import { config } from '../src/config.js';
import pkg from 'ethers';
const { ethers } = pkg as any;
import crypto from 'node:crypto';

const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';

const CTF_REDEEM_ABI = [
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] calldata indexSets) external',
];

const RELAYER_ENDPOINTS: Array<{ label: string; baseUrl: string; executePath: string }> = [
  { label: 'CLOB relayer', baseUrl: 'https://clob.polymarket.com', executePath: '/relayer/execute' },
  { label: 'Relayer host', baseUrl: 'https://relayer.polymarket.com', executePath: '/execute' },
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

function requireBuilderCreds(): void {
  if (!config.polymarket.builderApiKey || !config.polymarket.builderApiSecret || !config.polymarket.builderPassphrase) {
    console.error('\n❌ Missing Builder credentials!');
    console.error(`   POLY_BUILDER_API_KEY: ${config.polymarket.builderApiKey ? '✅' : '❌'}`);
    console.error(`   POLY_BUILDER_API_SECRET: ${config.polymarket.builderApiSecret ? '✅' : '❌'}`);
    console.error(`   POLY_BUILDER_PASSPHRASE: ${config.polymarket.builderPassphrase ? '✅' : '❌'}`);
    process.exit(1);
  }
}

async function main() {
  const conditionId = process.argv[2];
  if (!conditionId) {
    console.error('Usage: npx tsx scripts/test-relayer-redeem-v2.ts <conditionId>');
    process.exit(1);
  }

  const collateralToken = config.polymarket.usdcAddress;
  const proxyWallet = config.polymarket.address;

  console.log(`\n🧪 TEST RELAYER REDEMPTION (v2)`);
  console.log('='.repeat(60));
  console.log(`📍 Proxy wallet: ${proxyWallet}`);
  console.log(`📍 Condition ID: ${conditionId}`);
  console.log(`📍 Collateral: ${collateralToken}`);

  requireBuilderCreds();
  console.log(`\n✅ Builder credentials configured`);

  const indexSets = [1, 2];
  const parentCollectionId = ethers.utils.hexZeroPad('0x00', 32);
  const ctfInterface = new ethers.utils.Interface(CTF_REDEEM_ABI);
  const redeemCalldata = ctfInterface.encodeFunctionData('redeemPositions', [
    collateralToken,
    parentCollectionId,
    conditionId,
    indexSets,
  ]);

  const redeemTx = { to: CTF_ADDRESS, data: redeemCalldata, value: '0' };
  const payload = { transactions: [redeemTx], description: `Test claim: ${conditionId.slice(0, 20)}...` };
  const bodyStr = JSON.stringify(payload);
  const timestampSeconds = String(Math.floor(Date.now() / 1000));

  const secretBytes = Buffer.from(sanitizeBase64Secret(config.polymarket.builderApiSecret), 'base64');

  for (const ep of RELAYER_ENDPOINTS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔗 Testing: ${ep.label} → ${ep.baseUrl}${ep.executePath}`);

    // Health check (best-effort)
    try {
      const hc = await fetch(`${ep.baseUrl}/`, { method: 'GET' });
      console.log(`   Health check: ${hc.status} ${hc.statusText}`);
    } catch (e: any) {
      const cause = e?.cause ? ` | cause=${String(e.cause)}` : '';
      console.log(`   ❌ Health check failed: ${e?.message || e}${cause}`);
    }

    const signature = buildRelayerSignature(secretBytes, timestampSeconds, 'POST', ep.executePath, bodyStr);

    try {
      const res = await fetch(`${ep.baseUrl}${ep.executePath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          POLY_ADDRESS: proxyWallet,
          POLY_API_KEY: config.polymarket.builderApiKey,
          POLY_PASSPHRASE: config.polymarket.builderPassphrase,
          POLY_SIGNATURE: signature,
          POLY_TIMESTAMP: timestampSeconds,
        } as any,
        body: bodyStr,
      });

      const text = await res.text();
      console.log(`   Status: ${res.status} ${res.statusText}`);
      if (text) console.log(`   Body: ${text.slice(0, 400)}`);

      if (res.ok) {
        console.log(`\n✅ SUCCESS via ${ep.label}`);
        return;
      }
    } catch (e: any) {
      const cause = e?.cause ? ` | cause=${String(e.cause)}` : '';
      console.log(`   ❌ Request failed: ${e?.message || e}${cause}`);
    }
  }

  console.log(`\n❌ No working relayer endpoint found.`);
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
