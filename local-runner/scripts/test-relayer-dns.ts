/**
 * Quick DNS/TLS diagnostic for Relayer URLs
 * Tests if the issue is DNS, TLS, or firewall
 *
 * Usage: npx tsx scripts/test-relayer-dns.ts
 */

import dns from 'node:dns/promises';
import https from 'node:https';

const URLS_TO_TEST = [
  'relayer-v2.polymarket.dev',
  'relayer-v2-staging.polymarket.dev',
  'relayer.polymarket.dev',
  'clob.polymarket.com',
  'gamma-api.polymarket.com',
];

async function testDns(hostname: string): Promise<{ ok: boolean; ips?: string[]; error?: string }> {
  try {
    const ips = await dns.resolve4(hostname);
    return { ok: true, ips };
  } catch (e: any) {
    return { ok: false, error: e.code || e.message };
  }
}

async function testHttps(hostname: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  return new Promise((resolve) => {
    const req = https.request(
      { hostname, port: 443, path: '/', method: 'GET', timeout: 5000 },
      (res) => {
        resolve({ ok: res.statusCode !== undefined, status: res.statusCode });
      }
    );
    req.on('error', (e: any) => {
      resolve({ ok: false, error: e.code || e.message });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'TIMEOUT' });
    });
    req.end();
  });
}

async function main() {
  console.log('🔍 DNS/TLS Diagnostic for Polymarket Relayer');
  console.log('='.repeat(60));
  console.log(`System resolver: ${dns.getServers().join(', ')}\n`);

  for (const host of URLS_TO_TEST) {
    console.log(`\n🌐 ${host}`);

    const dnsResult = await testDns(host);
    if (dnsResult.ok) {
      console.log(`   DNS ✅ → ${dnsResult.ips?.join(', ')}`);
    } else {
      console.log(`   DNS ❌ → ${dnsResult.error}`);
    }

    const tlsResult = await testHttps(host);
    if (tlsResult.ok) {
      console.log(`   TLS ✅ → HTTP ${tlsResult.status}`);
    } else {
      console.log(`   TLS ❌ → ${tlsResult.error}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('💡 If DNS fails for .dev domains but .com works:');
  console.log('   → The .dev TLD requires HTTPS (HSTS preloaded)');
  console.log('   → Some VPS/ISP DNS may not resolve private .dev domains');
  console.log('   → Try: Add 1.1.1.1 / 8.8.8.8 to /etc/resolv.conf');
  console.log('   → Or run inside Docker container which uses custom DNS');
}

main().catch(console.error);
