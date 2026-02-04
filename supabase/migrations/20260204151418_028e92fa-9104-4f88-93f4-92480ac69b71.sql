-- Extend bot_config with V37 settings for hot-reload configuration
ALTER TABLE public.bot_config
  -- V37 Trading Parameters
  ADD COLUMN IF NOT EXISTS cpp_target DECIMAL(4,2) DEFAULT 0.95,
  ADD COLUMN IF NOT EXISTS price_guard_min DECIMAL(4,2) DEFAULT 0.03,
  ADD COLUMN IF NOT EXISTS price_guard_max DECIMAL(4,2) DEFAULT 0.97,
  ADD COLUMN IF NOT EXISTS pair_limit INTEGER DEFAULT 10,
  ADD COLUMN IF NOT EXISTS base_lot_shares INTEGER DEFAULT 25,
  ADD COLUMN IF NOT EXISTS min_lot_shares INTEGER DEFAULT 5,
  
  -- V37 Feature Toggles
  ADD COLUMN IF NOT EXISTS enable_escalation_hedge BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS enable_volatility_margin BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS enable_fill_audit BOOLEAN DEFAULT true,
  
  -- Risk Limits
  ADD COLUMN IF NOT EXISTS max_shares_per_side INTEGER DEFAULT 100,
  ADD COLUMN IF NOT EXISTS max_total_shares_per_market INTEGER DEFAULT 200,
  ADD COLUMN IF NOT EXISTS max_notional_per_market DECIMAL(10,2) DEFAULT 150.00,
  ADD COLUMN IF NOT EXISTS global_max_notional DECIMAL(10,2) DEFAULT 500.00,
  
  -- Timing Parameters
  ADD COLUMN IF NOT EXISTS stop_new_trades_sec INTEGER DEFAULT 30,
  ADD COLUMN IF NOT EXISTS hedge_timeout_sec INTEGER DEFAULT 12,
  ADD COLUMN IF NOT EXISTS hedge_must_by_sec INTEGER DEFAULT 60,
  
  -- Escalation Settings (for future use)
  ADD COLUMN IF NOT EXISTS escalation_timeout_ms INTEGER DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS escalation_reprice_ticks INTEGER DEFAULT 2,
  
  -- Volatility Settings (for future use)
  ADD COLUMN IF NOT EXISTS volatility_atr_period INTEGER DEFAULT 14,
  ADD COLUMN IF NOT EXISTS volatility_margin_multiplier DECIMAL(4,2) DEFAULT 1.50,
  
  -- Rate Limiting
  ADD COLUMN IF NOT EXISTS fill_audit_interval_ms INTEGER DEFAULT 30000,
  ADD COLUMN IF NOT EXISTS config_reload_interval_ms INTEGER DEFAULT 30000,
  
  -- Hot-reload tracking
  ADD COLUMN IF NOT EXISTS config_version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_reload_requested_at TIMESTAMPTZ DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.bot_config.cpp_target IS 'Target cost per pair (0.95 = 5c profit margin)';
COMMENT ON COLUMN public.bot_config.price_guard_min IS 'Minimum acceptable price for entry (0.03 = 3c)';
COMMENT ON COLUMN public.bot_config.price_guard_max IS 'Maximum acceptable price for entry (0.97 = 97c)';
COMMENT ON COLUMN public.bot_config.config_version IS 'Incremented on each save to trigger hot-reload';
COMMENT ON COLUMN public.bot_config.config_reload_interval_ms IS 'How often runner checks for config updates';