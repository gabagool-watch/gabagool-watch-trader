-- Price ticks per market (spot + share prices) for V35 price chart
CREATE TABLE public.v35_price_ticks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  market_slug text NOT NULL,
  asset text NOT NULL,
  ts bigint NOT NULL,              -- milliseconds since epoch
  spot_price numeric NOT NULL,     -- Polymarket RTDS or fallback
  up_best_bid numeric,
  up_best_ask numeric,
  down_best_bid numeric,
  down_best_ask numeric,
  strike_price numeric,            -- strike for this market
  run_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Fast lookups by market and time
CREATE INDEX idx_v35_price_ticks_market_ts ON public.v35_price_ticks (market_slug, ts);

-- Cleanup old ticks (keep 7 days) via pg_cron or manual
CREATE INDEX idx_v35_price_ticks_created_at ON public.v35_price_ticks (created_at);

-- Enable RLS with open read, service-role write
ALTER TABLE public.v35_price_ticks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on v35_price_ticks"
  ON public.v35_price_ticks
  FOR SELECT
  USING (true);

CREATE POLICY "Allow service role insert on v35_price_ticks"
  ON public.v35_price_ticks
  FOR INSERT
  WITH CHECK (true);

-- Enable realtime for live chart updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.v35_price_ticks;