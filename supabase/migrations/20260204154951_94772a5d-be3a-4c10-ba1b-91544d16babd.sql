-- Add merge tracking fields to v35_expiry_snapshots
ALTER TABLE public.v35_expiry_snapshots 
ADD COLUMN IF NOT EXISTS exit_type TEXT DEFAULT 'SETTLE',
ADD COLUMN IF NOT EXISTS merged_shares NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS merge_tx_hash TEXT,
ADD COLUMN IF NOT EXISTS merge_executed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS merge_gas_used NUMERIC,
ADD COLUMN IF NOT EXISTS merge_error TEXT;

-- Add index for querying by exit_type
CREATE INDEX IF NOT EXISTS idx_v35_expiry_snapshots_exit_type ON public.v35_expiry_snapshots(exit_type);

-- Comment on columns
COMMENT ON COLUMN public.v35_expiry_snapshots.exit_type IS 'How position was closed: SETTLE (wait for resolution), MERGE (merged before expiry), PARTIAL_MERGE (some shares merged)';
COMMENT ON COLUMN public.v35_expiry_snapshots.merged_shares IS 'Number of pairs merged before expiry';
COMMENT ON COLUMN public.v35_expiry_snapshots.merge_tx_hash IS 'Transaction hash of merge operation';
COMMENT ON COLUMN public.v35_expiry_snapshots.merge_executed_at IS 'When merge was executed';
COMMENT ON COLUMN public.v35_expiry_snapshots.merge_gas_used IS 'Gas used for merge transaction';