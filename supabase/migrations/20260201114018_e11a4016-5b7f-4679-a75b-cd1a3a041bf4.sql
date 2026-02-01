-- Add crossing_count column to expiry snapshots
ALTER TABLE public.v35_expiry_snapshots 
ADD COLUMN IF NOT EXISTS crossing_count integer DEFAULT NULL;

-- Add spot price at snapshot time
ALTER TABLE public.v35_expiry_snapshots 
ADD COLUMN IF NOT EXISTS spot_price numeric DEFAULT NULL;

-- Add strike price for reference
ALTER TABLE public.v35_expiry_snapshots 
ADD COLUMN IF NOT EXISTS strike_price numeric DEFAULT NULL;

-- Add comment explaining what crossing means
COMMENT ON COLUMN public.v35_expiry_snapshots.crossing_count IS 'Number of times spot price crossed strike price during the 15-minute window. More crossings = higher reversal risk.';
COMMENT ON COLUMN public.v35_expiry_snapshots.spot_price IS 'Spot price at snapshot time (1 second before expiry)';
COMMENT ON COLUMN public.v35_expiry_snapshots.strike_price IS 'Strike price for this market';

-- Create index for analyzing high-crossing markets
CREATE INDEX IF NOT EXISTS idx_v35_expiry_snapshots_crossing_count ON public.v35_expiry_snapshots (crossing_count DESC NULLS LAST);