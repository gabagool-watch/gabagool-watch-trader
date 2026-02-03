# Plan: Volatility-Based Dynamic Margin (ATR-Schaling)

## ✅ STATUS: GEÏMPLEMENTEERD (V36.8.0)

---

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

---

## ✅ Geïmplementeerde Bestanden

### 1. `local-runner/src/v35/binance-feed.ts` ✅
- 1-minuut candle aggregatie uit prijs ticks
- ATR berekening over laatste 5 candles  
- Volatility regime classificatie (LOW/MEDIUM/HIGH)
- Nieuwe methodes:
  - `getATR(asset)` → ATR in % 
  - `getVolatilityRegime(asset)` → 'LOW' | 'MEDIUM' | 'HIGH'
  - `getVolatilityMultiplier(asset)` → 0.5 - 1.0
  - `getVolatilityState(asset)` → full state for logging

### 2. `local-runner/src/v35/config.ts` ✅
- `VolatilityMarginConfig` interface toegevoegd
- Configuratie in TEST_CONFIG, MODERATE_CONFIG, PRODUCTION_CONFIG
- Updated `printV35Config()` met volatility info
- Versie: V36.8.0 "Volatility-Scaled Margin"

### 3. `local-runner/src/v35/dynamic-margin.ts` ✅ (NIEUW)
- Centrale margin berekening engine
- Combineert Delta Margin + Volatility Scaling
- Exports:
  - `calculateDynamicMargin(asset, strikePrice)` → DynamicMarginResult
  - `isVolatilityMarginEnabled()` → boolean
  - `getMarginSummary(result)` → string voor logging

### 4. `local-runner/src/v35/quoting-engine.ts` ✅
- Import van `dynamic-margin.ts`
- Logging van volatility margin bij quote generatie
- Versie header updated naar V36.8.0

### 5. `local-runner/src/v35/types.ts` ✅
- `strikePrice?: number` toegevoegd aan V35Market interface

---

## Configuratie (in alle modes)

```typescript
volatilityMargin: {
  enabled: true,
  lowVolATR: 0.10,      // < 0.10% = LOW volatility
  highVolATR: 0.25,     // > 0.25% = HIGH volatility
  deltaMargins: {
    high: 0.10,         // Delta > 500: 10¢
    medium: 0.07,       // Delta > 200: 7¢
    low: 0.05,          // Delta > 50: 5¢
    veryLow: 0.03,      // Delta ≤ 50: 3¢
  },
  volatilityMultipliers: {
    low: 1.0,           // Low vol: full margin
    medium: 0.7,        // Med vol: 70% of base
    high: 0.5,          // High vol: 50% of base
  },
  minMargin: 0.02,      // 2¢ absolute minimum
}
```

---

## Voorbeeld Scenario

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

## Volgende Stappen (optioneel)

1. **Integratie in order placement**: De `calculateDynamicMargin` functie kan nu gebruikt worden in de runner of hedge-manager om daadwerkelijk de quote prijzen aan te passen
2. **Telemetrie naar database**: Log de volatility regime en toegepaste multiplier naar de database voor analyse
3. **Dashboard**: Toon ATR en volatility regime in de UI
