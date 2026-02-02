import * as dotenv from 'dotenv';
import fs from 'node:fs';

// ============================================
// ENV FILE VALIDATOR
// Detects duplicate keys and other config issues
// ============================================

interface EnvValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  duplicates: Map<string, number>;
}

function validateEnvFile(filePath: string): EnvValidationResult {
  const result: EnvValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    duplicates: new Map(),
  };

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const keyCount = new Map<string, number>();
    const keyLines = new Map<string, number[]>();

    lines.forEach((line, lineNum) => {
      const trimmed = line.trim();
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) return;
      
      // Parse KEY=value
      const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=/i);
      if (match) {
        const key = match[1];
        const count = (keyCount.get(key) || 0) + 1;
        keyCount.set(key, count);
        
        const existingLines = keyLines.get(key) || [];
        existingLines.push(lineNum + 1); // 1-indexed
        keyLines.set(key, existingLines);
      }
    });

    // Check for duplicates
    for (const [key, count] of keyCount) {
      if (count > 1) {
        result.duplicates.set(key, count);
        const lines = keyLines.get(key)!;
        result.errors.push(
          `❌ DUPLICATE KEY: "${key}" appears ${count} times (lines ${lines.join(', ')})`
        );
        result.valid = false;
      }
    }

    // Check for critical keys
    const criticalKeys = [
      'POLYMARKET_PRIVATE_KEY',
      'POLYMARKET_ADDRESS',
      'POLYMARKET_API_KEY',
      'POLYMARKET_API_SECRET',
      'POLYMARKET_PASSPHRASE',
      'BACKEND_URL',
      'RUNNER_SHARED_SECRET',
    ];

    for (const key of criticalKeys) {
      if (!keyCount.has(key)) {
        result.warnings.push(`⚠️  Missing key: ${key}`);
      }
    }

    // Check for Windows line endings (CRLF)
    if (content.includes('\r\n')) {
      result.warnings.push('⚠️  File contains Windows line endings (CRLF) - may cause parsing issues');
    }

  } catch (err) {
    result.errors.push(`❌ Failed to read env file: ${err}`);
    result.valid = false;
  }

  return result;
}

// Priority for env file loading in Docker: ENV_FILE > DOTENV_CONFIG_PATH > default server path.
// In Docker, env_file directive sets env vars BEFORE the process starts.
// To still catch duplicate keys, we optionally VALIDATE a mounted ENV_FILE (read-only) if provided.
//
// If running locally (npm start), we load from the first existing candidate.

const envFromDockerOrCli = Boolean(process.env.POLYMARKET_PRIVATE_KEY);

let loadedEnvPath: string | null = null;

const readTrimmedEnv = (key: string): string => String(process.env[key] ?? '').trim();
const hasEnv = (key: string): boolean => readTrimmedEnv(key).length > 0;

const hasDbEnv = Boolean(
  (hasEnv('SUPABASE_URL') || hasEnv('VITE_SUPABASE_URL')) &&
    (hasEnv('SUPABASE_ANON_KEY') ||
      hasEnv('VITE_SUPABASE_PUBLISHABLE_KEY') ||
      hasEnv('SUPABASE_SERVICE_ROLE_KEY'))
);

if (envFromDockerOrCli) {
  // Docker/CLI may already have injected env vars. However, on some setups only
  // the Polymarket keys are exported, and DB vars are missing; in that case,
  // we *supplement* from an env file on disk.
  loadedEnvPath = '(docker env_file / CLI)';

  // Optional: validate a mounted env file (so we can detect duplicates even in Docker)
  const mountedEnvPath = process.env.ENV_FILE;
  if (mountedEnvPath) {
    if (fs.existsSync(mountedEnvPath)) {
      console.log(`\n🔍 Validating env file: ${mountedEnvPath}`);
      const validation = validateEnvFile(mountedEnvPath);

      for (const err of validation.errors) console.error(err);
      for (const warn of validation.warnings) console.warn(warn);

      if (!validation.valid) {
        console.error('\n' + '='.repeat(60));
        console.error('❌ ENV FILE VALIDATION FAILED');
        console.error('='.repeat(60));
        console.error('\nFix the duplicate keys in your env file before continuing.');
        console.error('Each key should appear exactly ONCE.\n');
        process.exit(1);
      }
    } else {
      console.warn(`⚠️ ENV_FILE is set to "${mountedEnvPath}" but is not readable on disk.`);
    }
  }

  if (!hasDbEnv) {
    const envCandidates = [
      process.env.ENV_FILE,
      process.env.DOTENV_CONFIG_PATH,
      '/home/deploy/secrets/local-runner.env',
    ].filter(Boolean) as string[];

    for (const p of envCandidates) {
      try {
        if (fs.existsSync(p)) {
          console.log(`\n🔍 Validating env file: ${p}`);
          const validation = validateEnvFile(p);

          for (const err of validation.errors) console.error(err);
          for (const warn of validation.warnings) console.warn(warn);

          if (!validation.valid) {
            console.error('\n' + '='.repeat(60));
            console.error('❌ ENV FILE VALIDATION FAILED');
            console.error('='.repeat(60));
            console.error('\nFix the duplicate keys in your env file before continuing.');
            console.error('Each key should appear exactly ONCE.\n');
            process.exit(1);
          }

          // In Docker, variables may exist-but-empty (or be partially provided).
          // We only fill missing/blank keys from disk to avoid surprising overrides.
          const parsed = dotenv.parse(fs.readFileSync(p, 'utf-8')) as Record<string, string>;
          let filled = 0;
          for (const [k, v] of Object.entries(parsed)) {
            if (!hasEnv(k)) {
              process.env[k] = v;
              filled++;
            }
          }

          console.log(`✅ Supplemented env from: ${p} (filled ${filled} keys)`);
          loadedEnvPath = `${p} (supplement)`;
          break;
        }
      } catch {
        // ignore
      }
    }

    if (!process.env.SUPABASE_URL && !process.env.VITE_SUPABASE_URL) {
      console.warn('⚠️  Database env vars still missing (SUPABASE_URL / SUPABASE_ANON_KEY).');
      console.warn('   Add them to your env_file or /home/deploy/secrets/local-runner.env.');
    }
  }
} else {
  const envCandidates = [
    process.env.ENV_FILE,
    process.env.DOTENV_CONFIG_PATH,
    '/home/deploy/secrets/local-runner.env',
  ].filter(Boolean) as string[];

  for (const p of envCandidates) {
    try {
      if (fs.existsSync(p)) {
        // VALIDATE before loading
        console.log(`\n🔍 Validating env file: ${p}`);
        const validation = validateEnvFile(p);
        
        // Print all errors and warnings
        for (const err of validation.errors) {
          console.error(err);
        }
        for (const warn of validation.warnings) {
          console.warn(warn);
        }
        
        // FAIL HARD on duplicates
        if (!validation.valid) {
          console.error('\n' + '='.repeat(60));
          console.error('❌ ENV FILE VALIDATION FAILED');
          console.error('='.repeat(60));
          console.error('\nFix the duplicate keys in your env file before continuing.');
          console.error('Each key should appear exactly ONCE.\n');
          process.exit(1);
        }
        
        dotenv.config({ path: p });
        loadedEnvPath = p;
        break;
      }
    } catch {
      // ignore
    }
  }

  if (!loadedEnvPath) {
    console.error('❌ No env file found and no Docker env vars. Checked:');
    console.error('   - ENV_FILE / DOTENV_CONFIG_PATH');
    console.error('   - /home/deploy/secrets/local-runner.env');
    console.error('   Set ENV_FILE or run from Docker with env_file directive.');
    process.exit(1);
  }
}

console.log(`✅ Loaded env from: ${loadedEnvPath}`);

// ERC20 address regex for validation (lowercase hex only for Polymarket compatibility)
const ERC20_ADDRESS_RE = /^0x[0-9a-f]{40}$/;

// Polygon USDC (PoS) default address
const DEFAULT_USDC_ADDRESS = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174';

const parseUsdcAddress = (): string => {
  const raw = process.env.POLYMARKET_USDC_ADDRESS ?? DEFAULT_USDC_ADDRESS;
  const normalized = raw.toLowerCase();
  if (!ERC20_ADDRESS_RE.test(normalized)) {
    console.error(`❌ Invalid POLYMARKET_USDC_ADDRESS: "${raw}" (expected 0x + 40 hex chars)`);
    process.exit(1);
  }
  return normalized;
};

export const config = {
  backend: {
    url: process.env.BACKEND_URL!,
    secret: process.env.RUNNER_SHARED_SECRET!,
  },
  polymarket: {
    apiKey: process.env.POLYMARKET_API_KEY!,
    apiSecret: process.env.POLYMARKET_API_SECRET!,
    passphrase: process.env.POLYMARKET_PASSPHRASE!,
    privateKey: process.env.POLYMARKET_PRIVATE_KEY!,
    address: process.env.POLYMARKET_ADDRESS!,
    // Collateral token address (Polygon USDC PoS by default, lowercase)
    usdcAddress: parseUsdcAddress(),
    // Optional override (recommended for Magic/Google accounts):
    // 0 = EOA, 1 = POLY_PROXY (Magic), 2 = GNOSIS_SAFE
    signatureType: (() => {
      const raw = process.env.POLYMARKET_SIGNATURE_TYPE;
      if (!raw) return undefined;
      const n = Number(raw);
      return n === 0 || n === 1 || n === 2 ? (n as 0 | 1 | 2) : undefined;
    })(),
    // Builder API credentials for Relayer (gasless redemptions)
    builderApiKey: process.env.POLY_BUILDER_API_KEY || '',
    builderApiSecret: process.env.POLY_BUILDER_API_SECRET || '',
    builderPassphrase: process.env.POLY_BUILDER_PASSPHRASE || '',
  },
  vpn: {
    // Default ON: only disable explicitly with VPN_REQUIRED=false
    required: (process.env.VPN_REQUIRED ?? 'true') !== 'false',
    // Optional: hard-pin expected egress IP (e.g. Mullvad exit IP)
    expectedEgressIp: process.env.EXPECTED_EGRESS_IP || null,
  },
  trading: {
    assets: (process.env.TRADE_ASSETS || 'BTC,ETH,SOL,XRP').split(','),
    // v7.1.0: Updated default to match test mode settings
    maxNotionalPerTrade: parseFloat(process.env.MAX_NOTIONAL_PER_TRADE || '20'),
    openingMaxPrice: parseFloat(process.env.OPENING_MAX_PRICE || '0.52'),
    // Rate limiting / backoff
    minOrderIntervalMs: parseInt(process.env.MIN_ORDER_INTERVAL_MS || '1500', 10),
    cloudflareBackoffMs: parseInt(process.env.CLOUDFLARE_BACKOFF_MS || '60000', 10),
  },
};

// Validate required config
const required = [
  ['BACKEND_URL', config.backend.url],
  ['RUNNER_SHARED_SECRET', config.backend.secret],
  ['POLYMARKET_API_KEY', config.polymarket.apiKey],
  ['POLYMARKET_API_SECRET', config.polymarket.apiSecret],
  ['POLYMARKET_PASSPHRASE', config.polymarket.passphrase],
  ['POLYMARKET_PRIVATE_KEY', config.polymarket.privateKey],
  ['POLYMARKET_ADDRESS', config.polymarket.address],
];

for (const [name, value] of required) {
  if (!value || value.includes('your_')) {
    console.error(`❌ Missing or invalid config: ${name}`);
    process.exit(1);
  }
}

console.log('✅ Config loaded successfully');
