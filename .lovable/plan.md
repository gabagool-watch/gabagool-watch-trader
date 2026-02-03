
# Plan: Volatility-Based Dynamic Margin (ATR-Schaling)

## Kernidee

Bij **hoge volatiliteit** neem je een **kleinere marge**, omdat de markt sneller naar je prijs toebeweegt. Bij **lage volatiliteit** is een grotere marge nodig om te wachten op beweging.

```text
┌─────────────────────────────────────────────────────────────┐
│  VOLATILITEIT → MARGE RELATIE                              │
├─────────────────────────────────────────────────────────────┤
│  LOW  volatility (ATR < 0.10%)  → BASE margin (5-10¢)      │
│  MED  volatility (ATR 0.10-0.25%) → REDUCED margin (3-5¢)  │
│  HIGH volatility (ATR > 0.25%) → MINIMAL margin (2-3¢)     │
└─────────────────────────────────────────────────────────────┘
```

## Wat is ATR?

**Average True Range (ATR)** meet de gemiddelde prijsbeweging per tijdsperiode:

```text
1-minuut ATR = gemiddelde van |high - low| over laatste N kaarsen
            = gemiddelde beweging in % per minuut
```

Dit vereist **geen orderbook data, geen volume data** - alleen de prijshistorie die de `BinancePriceFeed` al verzamelt.

---

## Implementatie Stappen

### Stap 1: ATR Berekening Toevoegen aan BinancePriceFeed

**Bestand:** `local-runner/src/v35/binance-feed.ts`

Voeg toe:
- 1-minuut "candles" berekening uit bestaande prijs ticks
- ATR berekening over laatste 5 candles
- Volatility regime classificatie (LOW/MEDIUM/HIGH)

```text
Nieuwe methodes:
├── getATR(asset): number          → ATR in % (bijv. 0.15 = 0.15%)
├── getVolatilityRegime(asset): 'LOW' | 'MEDIUM' | 'HIGH'
└── getVolatilityMultiplier(asset): number → 0.5 - 1.0
```

### Stap 2: Volatility-Based Margin Config

**Bestand:** `local-runner/src/v35/config.ts`

Nieuwe configuratie parameters:

```typescript
// Volatility-based margin adjustment
volatilityMargin: {
  enabled: true,
  
  // ATR thresholds (in percentage)
  lowVolATR: 0.10,      // < 0.10% = low volatility
  highVolATR: 0.25,     // > 0.25% = high volatility
  
  // Base margins per delta bucket (bestaande Dynamic Delta Margin)
  deltaMargins: {
    high: 0.10,    // Delta > 500: 10¢
    medium: 0.07,  // Delta > 200: 7¢
    low: 0.05,     // Delta > 50: 5¢
    veryLow: 0.03, // Delta ≤ 50: 3¢
  },
  
  // Volatility multipliers (smaller = tighter margin)
  volatilityMultipliers: {
    low: 1.0,      // Low vol: use full margin
    medium: 0.7,   // Med vol: 70% of base margin
    high: 0.5,     // High vol: 50% of base margin
  },
  
  // Minimum margin floor (never go below this)
  minMargin: 0.02,  // 2¢ absolute minimum
}
```

### Stap 3: Quoting Engine Aanpassing

**Bestand:** `local-runner/src/v35/quoting-engine.ts`

Bij het genereren van quotes:

```text
1. Haal huidige volatiliteit regime op van BinancePriceFeed
2. Bepaal base margin op basis van delta (bestaande logica)
3. Pas volatilityMultiplier toe: finalMargin = baseMargin * multiplier
4. Gebruik finalMargin voor quote prijs berekening
```

### Stap 4: Logging & Telemetrie

Voeg logging toe zodat je kunt zien:
- Huidige ATR per asset
- Volatiliteit regime (LOW/MEDIUM/HIGH)
- Toegepaste margin multiplier
- Resulterende margin

---

## Technische Details

### ATR Berekening (1-minuut candles)

```typescript
interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  timestamp: number;
}

// Build 1-minute candles from price ticks
// ATR = average(high - low) over last 5 candles
// Return as percentage: (ATR / currentPrice) * 100
```

### Volatility Regime Bepaling

```typescript
function getVolatilityRegime(atrPercent: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (atrPercent < 0.10) return 'LOW';
  if (atrPercent > 0.25) return 'HIGH';
  return 'MEDIUM';
}

function getMarginMultiplier(regime: 'LOW' | 'MEDIUM' | 'HIGH'): number {
  switch (regime) {
    case 'LOW': return 1.0;    // Volledige marge
    case 'MEDIUM': return 0.7;  // 70% van base
    case 'HIGH': return 0.5;    // 50% van base
  }
}
```

### Voorbeeld Scenario

```text
BTC prijs: $100,000
ATR (5 candles): $200 = 0.20%
Volatility regime: MEDIUM

Delta: 300 → base margin: 7¢
Volatility multiplier: 0.7

Final margin: 7¢ × 0.7 = 4.9¢ → afgerond 5¢

Bij HIGH volatility (ATR > 0.25%):
Final margin: 7¢ × 0.5 = 3.5¢ → afgerond 4¢
```

---

## Verwachte Impact

| Scenario | Oude Marge | Nieuwe Marge | Effect |
|----------|-----------|--------------|--------|
| Lage vol, delta 300 | 7¢ | 7¢ | Geen verandering |
| Medium vol, delta 300 | 7¢ | 5¢ | Snellere fills |
| Hoge vol, delta 300 | 7¢ | 4¢ | Veel snellere fills |
| Hoge vol, delta 50 | 3¢ | 2¢ | Agressiever in volatiele markt |

---

## Bestanden die Aangepast Worden

1. **`local-runner/src/v35/binance-feed.ts`**
   - ATR berekening
   - Candle aggregatie
   - Volatility regime API

2. **`local-runner/src/v35/config.ts`**
   - Nieuwe volatility margin config
   - Thresholds en multipliers

3. **`local-runner/src/v35/quoting-engine.ts`**
   - Integratie van volatility-adjusted margin
   - Logging van toegepaste multiplier

4. **`local-runner/src/v35/runner.ts`** (indien nodig)
   - Doorgeven van volatility info aan quoting engine

---

## Risico's & Mitigatie

| Risico | Mitigatie |
|--------|-----------|
| Te agressief bij hoge vol → reversals | Minimum margin floor van 2¢ |
| ATR berekening onnauwkeurig bij weinig data | Fallback naar MEDIUM regime bij < 3 candles |
| Inconsistente margin tussen ticks | Smooth ATR met EWMA in plaats van simple average |

