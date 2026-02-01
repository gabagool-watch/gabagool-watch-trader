export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      account_cashflow_timeseries: {
        Row: {
          amount_usd: number
          category: string
          created_at: string | null
          date: string
          id: string
          market_id: string
          outcome: string | null
          shares_delta: number
          source_event_id: string | null
          ts: string
          wallet: string
        }
        Insert: {
          amount_usd?: number
          category: string
          created_at?: string | null
          date: string
          id?: string
          market_id: string
          outcome?: string | null
          shares_delta?: number
          source_event_id?: string | null
          ts: string
          wallet: string
        }
        Update: {
          amount_usd?: number
          category?: string
          created_at?: string | null
          date?: string
          id?: string
          market_id?: string
          outcome?: string | null
          shares_delta?: number
          source_event_id?: string | null
          ts?: string
          wallet?: string
        }
        Relationships: []
      }
      account_pnl_summary: {
        Row: {
          claimed_markets: number
          created_at: string | null
          first_trade_ts: string | null
          id: string
          last_trade_ts: string | null
          lost_markets: number
          open_markets: number
          total_markets: number
          total_pnl: number
          total_realized_pnl: number
          total_trades: number
          total_unrealized_pnl: number
          total_volume: number
          updated_at: string | null
          wallet: string
        }
        Insert: {
          claimed_markets?: number
          created_at?: string | null
          first_trade_ts?: string | null
          id?: string
          last_trade_ts?: string | null
          lost_markets?: number
          open_markets?: number
          total_markets?: number
          total_pnl?: number
          total_realized_pnl?: number
          total_trades?: number
          total_unrealized_pnl?: number
          total_volume?: number
          updated_at?: string | null
          wallet: string
        }
        Update: {
          claimed_markets?: number
          created_at?: string | null
          first_trade_ts?: string | null
          id?: string
          last_trade_ts?: string | null
          lost_markets?: number
          open_markets?: number
          total_markets?: number
          total_pnl?: number
          total_realized_pnl?: number
          total_trades?: number
          total_unrealized_pnl?: number
          total_volume?: number
          updated_at?: string | null
          wallet?: string
        }
        Relationships: []
      }
      account_position_snapshots: {
        Row: {
          account_avg_down: number | null
          account_avg_up: number | null
          account_down_shares: number
          account_up_shares: number
          created_at: string
          id: string
          market_id: string
          run_id: string | null
          source_endpoint: string | null
          source_version: string | null
          ts: number
          wallet_address: string | null
        }
        Insert: {
          account_avg_down?: number | null
          account_avg_up?: number | null
          account_down_shares?: number
          account_up_shares?: number
          created_at?: string
          id?: string
          market_id: string
          run_id?: string | null
          source_endpoint?: string | null
          source_version?: string | null
          ts: number
          wallet_address?: string | null
        }
        Update: {
          account_avg_down?: number | null
          account_avg_up?: number | null
          account_down_shares?: number
          account_up_shares?: number
          created_at?: string
          id?: string
          market_id?: string
          run_id?: string | null
          source_endpoint?: string | null
          source_version?: string | null
          ts?: number
          wallet_address?: string | null
        }
        Relationships: []
      }
      arbitrage_paper_trades: {
        Row: {
          asset: string
          binance_price: number | null
          chainlink_price: number | null
          config_snapshot: Json | null
          created_at: string
          delta_usd: number | null
          direction: string
          entry_fee: number | null
          entry_price: number | null
          exit_fee: number | null
          exit_price: number | null
          fill_time_ms: number | null
          fill_ts: number | null
          gross_pnl: number | null
          hold_time_ms: number | null
          id: string
          market_slug: string | null
          net_pnl: number | null
          order_type: string | null
          reason: string | null
          sell_ts: number | null
          session_id: string | null
          share_price: number | null
          signal_id: string
          signal_ts: number
          status: string
          strike_price: number | null
          total_fees: number | null
        }
        Insert: {
          asset: string
          binance_price?: number | null
          chainlink_price?: number | null
          config_snapshot?: Json | null
          created_at?: string
          delta_usd?: number | null
          direction: string
          entry_fee?: number | null
          entry_price?: number | null
          exit_fee?: number | null
          exit_price?: number | null
          fill_time_ms?: number | null
          fill_ts?: number | null
          gross_pnl?: number | null
          hold_time_ms?: number | null
          id?: string
          market_slug?: string | null
          net_pnl?: number | null
          order_type?: string | null
          reason?: string | null
          sell_ts?: number | null
          session_id?: string | null
          share_price?: number | null
          signal_id: string
          signal_ts: number
          status?: string
          strike_price?: number | null
          total_fees?: number | null
        }
        Update: {
          asset?: string
          binance_price?: number | null
          chainlink_price?: number | null
          config_snapshot?: Json | null
          created_at?: string
          delta_usd?: number | null
          direction?: string
          entry_fee?: number | null
          entry_price?: number | null
          exit_fee?: number | null
          exit_price?: number | null
          fill_time_ms?: number | null
          fill_ts?: number | null
          gross_pnl?: number | null
          hold_time_ms?: number | null
          id?: string
          market_slug?: string | null
          net_pnl?: number | null
          order_type?: string | null
          reason?: string | null
          sell_ts?: number | null
          session_id?: string | null
          share_price?: number | null
          signal_id?: string
          signal_ts?: number
          status?: string
          strike_price?: number | null
          total_fees?: number | null
        }
        Relationships: []
      }
      bot_config: {
        Row: {
          backend_url: string | null
          cloudflare_backoff_ms: number | null
          created_at: string | null
          id: string
          max_notional_per_trade: number | null
          max_position_size: number | null
          min_edge_threshold: number | null
          min_order_interval_ms: number | null
          opening_max_price: number | null
          polymarket_address: string | null
          strategy_enabled: boolean | null
          trade_assets: string[] | null
          updated_at: string | null
          vpn_endpoint: string | null
          vpn_required: boolean | null
        }
        Insert: {
          backend_url?: string | null
          cloudflare_backoff_ms?: number | null
          created_at?: string | null
          id?: string
          max_notional_per_trade?: number | null
          max_position_size?: number | null
          min_edge_threshold?: number | null
          min_order_interval_ms?: number | null
          opening_max_price?: number | null
          polymarket_address?: string | null
          strategy_enabled?: boolean | null
          trade_assets?: string[] | null
          updated_at?: string | null
          vpn_endpoint?: string | null
          vpn_required?: boolean | null
        }
        Update: {
          backend_url?: string | null
          cloudflare_backoff_ms?: number | null
          created_at?: string | null
          id?: string
          max_notional_per_trade?: number | null
          max_position_size?: number | null
          min_edge_threshold?: number | null
          min_order_interval_ms?: number | null
          opening_max_price?: number | null
          polymarket_address?: string | null
          strategy_enabled?: boolean | null
          trade_assets?: string[] | null
          updated_at?: string | null
          vpn_endpoint?: string | null
          vpn_required?: boolean | null
        }
        Relationships: []
      }
      bot_events: {
        Row: {
          asset: string
          correlation_id: string | null
          created_at: string
          data: Json | null
          event_type: string
          id: string
          market_id: string | null
          reason_code: string | null
          run_id: string | null
          ts: number
        }
        Insert: {
          asset: string
          correlation_id?: string | null
          created_at?: string
          data?: Json | null
          event_type: string
          id?: string
          market_id?: string | null
          reason_code?: string | null
          run_id?: string | null
          ts: number
        }
        Update: {
          asset?: string
          correlation_id?: string | null
          created_at?: string
          data?: Json | null
          event_type?: string
          id?: string
          market_id?: string | null
          reason_code?: string | null
          run_id?: string | null
          ts?: number
        }
        Relationships: []
      }
      bot_positions: {
        Row: {
          avg_price: number
          cost: number | null
          created_at: string
          current_price: number | null
          id: string
          market_slug: string
          outcome: string
          pnl: number | null
          pnl_percent: number | null
          shares: number
          synced_at: string
          token_id: string | null
          value: number | null
          wallet_address: string
        }
        Insert: {
          avg_price?: number
          cost?: number | null
          created_at?: string
          current_price?: number | null
          id?: string
          market_slug: string
          outcome: string
          pnl?: number | null
          pnl_percent?: number | null
          shares?: number
          synced_at?: string
          token_id?: string | null
          value?: number | null
          wallet_address: string
        }
        Update: {
          avg_price?: number
          cost?: number | null
          created_at?: string
          current_price?: number | null
          id?: string
          market_slug?: string
          outcome?: string
          pnl?: number | null
          pnl_percent?: number | null
          shares?: number
          synced_at?: string
          token_id?: string | null
          value?: number | null
          wallet_address?: string
        }
        Relationships: []
      }
      bucket_statistics: {
        Row: {
          asset: string
          avg_edge_after_spread: number | null
          avg_move_10s: number | null
          avg_move_15s: number | null
          avg_move_5s: number | null
          avg_move_7s: number | null
          avg_spot_lead_ms: number | null
          avg_taker_zscore: number | null
          created_at: string | null
          delta_bucket: string
          id: string
          last_updated_at: string | null
          sample_count: number | null
          std_move_7s: number | null
          time_bucket: string | null
          win_rate: number | null
        }
        Insert: {
          asset: string
          avg_edge_after_spread?: number | null
          avg_move_10s?: number | null
          avg_move_15s?: number | null
          avg_move_5s?: number | null
          avg_move_7s?: number | null
          avg_spot_lead_ms?: number | null
          avg_taker_zscore?: number | null
          created_at?: string | null
          delta_bucket: string
          id?: string
          last_updated_at?: string | null
          sample_count?: number | null
          std_move_7s?: number | null
          time_bucket?: string | null
          win_rate?: number | null
        }
        Update: {
          asset?: string
          avg_edge_after_spread?: number | null
          avg_move_10s?: number | null
          avg_move_15s?: number | null
          avg_move_5s?: number | null
          avg_move_7s?: number | null
          avg_spot_lead_ms?: number | null
          avg_taker_zscore?: number | null
          created_at?: string | null
          delta_bucket?: string
          id?: string
          last_updated_at?: string | null
          sample_count?: number | null
          std_move_7s?: number | null
          time_bucket?: string | null
          win_rate?: number | null
        }
        Relationships: []
      }
      canonical_positions: {
        Row: {
          avg_cost: number | null
          created_at: string | null
          id: string
          last_fill_at: string | null
          market_id: string
          outcome: string
          realized_pnl: number
          shares_held: number
          state: string
          total_cost_usd: number
          unrealized_pnl: number | null
          updated_at: string | null
          wallet: string
        }
        Insert: {
          avg_cost?: number | null
          created_at?: string | null
          id: string
          last_fill_at?: string | null
          market_id: string
          outcome: string
          realized_pnl?: number
          shares_held?: number
          state?: string
          total_cost_usd?: number
          unrealized_pnl?: number | null
          updated_at?: string | null
          wallet: string
        }
        Update: {
          avg_cost?: number | null
          created_at?: string | null
          id?: string
          last_fill_at?: string | null
          market_id?: string
          outcome?: string
          realized_pnl?: number
          shares_held?: number
          state?: string
          total_cost_usd?: number
          unrealized_pnl?: number | null
          updated_at?: string | null
          wallet?: string
        }
        Relationships: []
      }
      cashflow_ledger: {
        Row: {
          amount_usd: number
          category: string
          created_at: string | null
          direction: string
          id: string
          market_id: string
          outcome: string | null
          shares_delta: number
          source_event_id: string | null
          timestamp: string
          wallet: string
        }
        Insert: {
          amount_usd?: number
          category: string
          created_at?: string | null
          direction: string
          id: string
          market_id: string
          outcome?: string | null
          shares_delta?: number
          source_event_id?: string | null
          timestamp: string
          wallet: string
        }
        Update: {
          amount_usd?: number
          category?: string
          created_at?: string | null
          direction?: string
          id?: string
          market_id?: string
          outcome?: string | null
          shares_delta?: number
          source_event_id?: string | null
          timestamp?: string
          wallet?: string
        }
        Relationships: [
          {
            foreignKeyName: "cashflow_ledger_source_event_id_fkey"
            columns: ["source_event_id"]
            isOneToOne: false
            referencedRelation: "raw_subgraph_events"
            referencedColumns: ["id"]
          },
        ]
      }
      chainlink_prices: {
        Row: {
          asset: string
          chainlink_timestamp: number
          created_at: string
          id: string
          price: number
          source: string | null
        }
        Insert: {
          asset: string
          chainlink_timestamp: number
          created_at?: string
          id?: string
          price: number
          source?: string | null
        }
        Update: {
          asset?: string
          chainlink_timestamp?: number
          created_at?: string
          id?: string
          price?: number
          source?: string | null
        }
        Relationships: []
      }
      claim_logs: {
        Row: {
          block_number: number | null
          condition_id: string
          confirmed_at: string | null
          created_at: string
          error_message: string | null
          gas_price_gwei: number | null
          gas_used: number | null
          id: string
          market_id: string | null
          market_title: string | null
          outcome: string | null
          retry_count: number | null
          shares_redeemed: number
          status: string
          tx_hash: string | null
          usdc_received: number
          wallet_address: string
          wallet_type: string | null
        }
        Insert: {
          block_number?: number | null
          condition_id: string
          confirmed_at?: string | null
          created_at?: string
          error_message?: string | null
          gas_price_gwei?: number | null
          gas_used?: number | null
          id?: string
          market_id?: string | null
          market_title?: string | null
          outcome?: string | null
          retry_count?: number | null
          shares_redeemed?: number
          status?: string
          tx_hash?: string | null
          usdc_received?: number
          wallet_address: string
          wallet_type?: string | null
        }
        Update: {
          block_number?: number | null
          condition_id?: string
          confirmed_at?: string | null
          created_at?: string
          error_message?: string | null
          gas_price_gwei?: number | null
          gas_used?: number | null
          id?: string
          market_id?: string | null
          market_title?: string | null
          outcome?: string | null
          retry_count?: number | null
          shares_redeemed?: number
          status?: string
          tx_hash?: string | null
          usdc_received?: number
          wallet_address?: string
          wallet_type?: string | null
        }
        Relationships: []
      }
      daily_pnl: {
        Row: {
          buy_count: number
          created_at: string | null
          date: string
          id: string
          markets_active: number
          realized_pnl: number
          redeem_count: number
          sell_count: number
          total_pnl: number
          unrealized_pnl: number
          updated_at: string | null
          volume_traded: number
          wallet: string
        }
        Insert: {
          buy_count?: number
          created_at?: string | null
          date: string
          id?: string
          markets_active?: number
          realized_pnl?: number
          redeem_count?: number
          sell_count?: number
          total_pnl?: number
          unrealized_pnl?: number
          updated_at?: string | null
          volume_traded?: number
          wallet: string
        }
        Update: {
          buy_count?: number
          created_at?: string | null
          date?: string
          id?: string
          markets_active?: number
          realized_pnl?: number
          redeem_count?: number
          sell_count?: number
          total_pnl?: number
          unrealized_pnl?: number
          updated_at?: string | null
          volume_traded?: number
          wallet?: string
        }
        Relationships: []
      }
      decision_snapshots: {
        Row: {
          asset: string
          avg_down: number | null
          avg_up: number | null
          best_ask_down: number | null
          best_ask_up: number | null
          best_bid_down: number | null
          best_bid_up: number | null
          book_ready_down: boolean
          book_ready_up: boolean
          chosen_side: string | null
          correlation_id: string | null
          cpp_paired_only: number | null
          created_at: string
          depth_summary_down: Json | null
          depth_summary_up: Json | null
          down_shares: number
          guards_evaluated: Json
          id: string
          intent: string
          market_id: string
          paired_shares: number
          projected_cpp_maker: number | null
          projected_cpp_taker: number | null
          reason_code: string
          run_id: string | null
          seconds_remaining: number
          state: string
          ts: number
          unpaired_shares: number
          up_shares: number
          window_start: string | null
        }
        Insert: {
          asset: string
          avg_down?: number | null
          avg_up?: number | null
          best_ask_down?: number | null
          best_ask_up?: number | null
          best_bid_down?: number | null
          best_bid_up?: number | null
          book_ready_down?: boolean
          book_ready_up?: boolean
          chosen_side?: string | null
          correlation_id?: string | null
          cpp_paired_only?: number | null
          created_at?: string
          depth_summary_down?: Json | null
          depth_summary_up?: Json | null
          down_shares?: number
          guards_evaluated?: Json
          id?: string
          intent: string
          market_id: string
          paired_shares?: number
          projected_cpp_maker?: number | null
          projected_cpp_taker?: number | null
          reason_code: string
          run_id?: string | null
          seconds_remaining: number
          state: string
          ts: number
          unpaired_shares?: number
          up_shares?: number
          window_start?: string | null
        }
        Update: {
          asset?: string
          avg_down?: number | null
          avg_up?: number | null
          best_ask_down?: number | null
          best_ask_up?: number | null
          best_bid_down?: number | null
          best_bid_up?: number | null
          book_ready_down?: boolean
          book_ready_up?: boolean
          chosen_side?: string | null
          correlation_id?: string | null
          cpp_paired_only?: number | null
          created_at?: string
          depth_summary_down?: Json | null
          depth_summary_up?: Json | null
          down_shares?: number
          guards_evaluated?: Json
          id?: string
          intent?: string
          market_id?: string
          paired_shares?: number
          projected_cpp_maker?: number | null
          projected_cpp_taker?: number | null
          reason_code?: string
          run_id?: string | null
          seconds_remaining?: number
          state?: string
          ts?: number
          unpaired_shares?: number
          up_shares?: number
          window_start?: string | null
        }
        Relationships: []
      }
      delta_bucket_config: {
        Row: {
          asset: string
          bucket_index: number
          bucket_label: string
          created_at: string | null
          id: string
          last_calibrated_at: string | null
          max_delta: number
          min_delta: number
          sample_count: number | null
        }
        Insert: {
          asset: string
          bucket_index: number
          bucket_label: string
          created_at?: string | null
          id?: string
          last_calibrated_at?: string | null
          max_delta: number
          min_delta: number
          sample_count?: number | null
        }
        Update: {
          asset?: string
          bucket_index?: number
          bucket_label?: string
          created_at?: string | null
          id?: string
          last_calibrated_at?: string | null
          max_delta?: number
          min_delta?: number
          sample_count?: number | null
        }
        Relationships: []
      }
      deposits: {
        Row: {
          amount_usd: number
          created_at: string
          deposited_at: string
          id: string
          notes: string | null
          source: string | null
          wallet: string
        }
        Insert: {
          amount_usd: number
          created_at?: string
          deposited_at: string
          id?: string
          notes?: string | null
          source?: string | null
          wallet?: string
        }
        Update: {
          amount_usd?: number
          created_at?: string
          deposited_at?: string
          id?: string
          notes?: string | null
          source?: string | null
          wallet?: string
        }
        Relationships: []
      }
      fill_attributions: {
        Row: {
          asset: string
          correlation_id: string | null
          created_at: string
          fee_paid: number
          fill_cost_gross: number
          fill_cost_net: number
          id: string
          liquidity: string
          market_id: string
          order_id: string
          price: number
          rebate_expected: number
          run_id: string | null
          side: string
          size: number
          ts: number
          updated_avg_down: number | null
          updated_avg_up: number | null
          updated_cpp_gross: number | null
          updated_cpp_net_expected: number | null
        }
        Insert: {
          asset: string
          correlation_id?: string | null
          created_at?: string
          fee_paid?: number
          fill_cost_gross: number
          fill_cost_net: number
          id?: string
          liquidity: string
          market_id: string
          order_id: string
          price: number
          rebate_expected?: number
          run_id?: string | null
          side: string
          size: number
          ts: number
          updated_avg_down?: number | null
          updated_avg_up?: number | null
          updated_cpp_gross?: number | null
          updated_cpp_net_expected?: number | null
        }
        Update: {
          asset?: string
          correlation_id?: string | null
          created_at?: string
          fee_paid?: number
          fill_cost_gross?: number
          fill_cost_net?: number
          id?: string
          liquidity?: string
          market_id?: string
          order_id?: string
          price?: number
          rebate_expected?: number
          run_id?: string | null
          side?: string
          size?: number
          ts?: number
          updated_avg_down?: number | null
          updated_avg_up?: number | null
          updated_cpp_gross?: number | null
          updated_cpp_net_expected?: number | null
        }
        Relationships: []
      }
      fill_logs: {
        Row: {
          asset: string
          client_order_id: string | null
          correlation_id: string | null
          created_at: string
          delta: number | null
          fill_notional: number
          fill_price: number
          fill_qty: number
          hedge_lag_ms: number | null
          id: string
          intent: string
          iso: string
          market_id: string
          order_id: string | null
          run_id: string | null
          seconds_remaining: number
          side: string
          spot_price: number | null
          strike_price: number | null
          ts: number
        }
        Insert: {
          asset: string
          client_order_id?: string | null
          correlation_id?: string | null
          created_at?: string
          delta?: number | null
          fill_notional: number
          fill_price: number
          fill_qty: number
          hedge_lag_ms?: number | null
          id?: string
          intent: string
          iso: string
          market_id: string
          order_id?: string | null
          run_id?: string | null
          seconds_remaining: number
          side: string
          spot_price?: number | null
          strike_price?: number | null
          ts: number
        }
        Update: {
          asset?: string
          client_order_id?: string | null
          correlation_id?: string | null
          created_at?: string
          delta?: number | null
          fill_notional?: number
          fill_price?: number
          fill_qty?: number
          hedge_lag_ms?: number | null
          id?: string
          intent?: string
          iso?: string
          market_id?: string
          order_id?: string | null
          run_id?: string | null
          seconds_remaining?: number
          side?: string
          spot_price?: number | null
          strike_price?: number | null
          ts?: number
        }
        Relationships: []
      }
      funding_snapshots: {
        Row: {
          allowance_remaining: number | null
          balance_available: number
          balance_total: number
          blocked_reason: string | null
          created_at: string
          id: string
          reserved_by_market: Json | null
          reserved_total: number
          spendable: number | null
          trigger_type: string | null
          ts: number
        }
        Insert: {
          allowance_remaining?: number | null
          balance_available: number
          balance_total: number
          blocked_reason?: string | null
          created_at?: string
          id?: string
          reserved_by_market?: Json | null
          reserved_total?: number
          spendable?: number | null
          trigger_type?: string | null
          ts: number
        }
        Update: {
          allowance_remaining?: number | null
          balance_available?: number
          balance_total?: number
          blocked_reason?: string | null
          created_at?: string
          id?: string
          reserved_by_market?: Json | null
          reserved_total?: number
          spendable?: number | null
          trigger_type?: string | null
          ts?: number
        }
        Relationships: []
      }
      gabagool_metrics: {
        Row: {
          cpp_distribution: Json | null
          created_at: string
          high_cpp_trade_count: number
          id: string
          invariant_status: Json | null
          maker_fill_ratio: number | null
          maker_fills: number
          paired_cpp_under_100_pct: number | null
          paired_cpp_under_100_shares: number
          run_id: string | null
          taker_fills: number
          total_paired_shares: number
          ts: number
        }
        Insert: {
          cpp_distribution?: Json | null
          created_at?: string
          high_cpp_trade_count?: number
          id?: string
          invariant_status?: Json | null
          maker_fill_ratio?: number | null
          maker_fills?: number
          paired_cpp_under_100_pct?: number | null
          paired_cpp_under_100_shares?: number
          run_id?: string | null
          taker_fills?: number
          total_paired_shares?: number
          ts: number
        }
        Update: {
          cpp_distribution?: Json | null
          created_at?: string
          high_cpp_trade_count?: number
          id?: string
          invariant_status?: Json | null
          maker_fill_ratio?: number | null
          maker_fills?: number
          paired_cpp_under_100_pct?: number | null
          paired_cpp_under_100_shares?: number
          run_id?: string | null
          taker_fills?: number
          total_paired_shares?: number
          ts?: number
        }
        Relationships: []
      }
      hedge_feasibility: {
        Row: {
          actual_hedge_at: string | null
          actual_hedge_price: number | null
          asset: string
          created_at: string
          event_end_time: string | null
          hedge_side: string
          hedge_was_possible: boolean
          hedge_was_profitable: boolean
          hedge_window_seconds: number | null
          id: string
          market_id: string
          max_hedge_price: number
          min_hedge_ask_at: string | null
          min_hedge_ask_seen: number | null
          opening_at: string
          opening_price: number
          opening_shares: number
          opening_side: string
          was_hedged: boolean
        }
        Insert: {
          actual_hedge_at?: string | null
          actual_hedge_price?: number | null
          asset: string
          created_at?: string
          event_end_time?: string | null
          hedge_side: string
          hedge_was_possible?: boolean
          hedge_was_profitable?: boolean
          hedge_window_seconds?: number | null
          id?: string
          market_id: string
          max_hedge_price: number
          min_hedge_ask_at?: string | null
          min_hedge_ask_seen?: number | null
          opening_at: string
          opening_price: number
          opening_shares: number
          opening_side: string
          was_hedged?: boolean
        }
        Update: {
          actual_hedge_at?: string | null
          actual_hedge_price?: number | null
          asset?: string
          created_at?: string
          event_end_time?: string | null
          hedge_side?: string
          hedge_was_possible?: boolean
          hedge_was_profitable?: boolean
          hedge_window_seconds?: number | null
          id?: string
          market_id?: string
          max_hedge_price?: number
          min_hedge_ask_at?: string | null
          min_hedge_ask_seen?: number | null
          opening_at?: string
          opening_price?: number
          opening_shares?: number
          opening_side?: string
          was_hedged?: boolean
        }
        Relationships: []
      }
      hedge_intents: {
        Row: {
          abort_reason: string | null
          asset: string
          correlation_id: string | null
          created_at: string
          filled_qty: number | null
          id: string
          intended_qty: number
          intent_type: string
          market_id: string
          price_at_intent: number | null
          price_at_resolution: number | null
          resolution_ts: number | null
          run_id: string | null
          side: string
          status: string
          ts: number
        }
        Insert: {
          abort_reason?: string | null
          asset: string
          correlation_id?: string | null
          created_at?: string
          filled_qty?: number | null
          id?: string
          intended_qty: number
          intent_type: string
          market_id: string
          price_at_intent?: number | null
          price_at_resolution?: number | null
          resolution_ts?: number | null
          run_id?: string | null
          side: string
          status?: string
          ts: number
        }
        Update: {
          abort_reason?: string | null
          asset?: string
          correlation_id?: string | null
          created_at?: string
          filled_qty?: number | null
          id?: string
          intended_qty?: number
          intent_type?: string
          market_id?: string
          price_at_intent?: number | null
          price_at_resolution?: number | null
          resolution_ts?: number | null
          run_id?: string | null
          side?: string
          status?: string
          ts?: number
        }
        Relationships: []
      }
      hedge_skip_logs: {
        Row: {
          asset: string
          best_ask: number | null
          best_bid: number | null
          correlation_id: string | null
          created_at: string
          id: string
          market_id: string
          projected_cpp: number | null
          reason_code: string
          run_id: string | null
          seconds_remaining: number | null
          side_not_hedged: string
          ts: number
          unpaired_shares: number | null
        }
        Insert: {
          asset: string
          best_ask?: number | null
          best_bid?: number | null
          correlation_id?: string | null
          created_at?: string
          id?: string
          market_id: string
          projected_cpp?: number | null
          reason_code: string
          run_id?: string | null
          seconds_remaining?: number | null
          side_not_hedged: string
          ts: number
          unpaired_shares?: number | null
        }
        Update: {
          asset?: string
          best_ask?: number | null
          best_bid?: number | null
          correlation_id?: string | null
          created_at?: string
          id?: string
          market_id?: string
          projected_cpp?: number | null
          reason_code?: string
          run_id?: string | null
          seconds_remaining?: number | null
          side_not_hedged?: string
          ts?: number
          unpaired_shares?: number | null
        }
        Relationships: []
      }
      hourly_pnl_snapshots: {
        Row: {
          avg_pnl_per_hour: number
          created_at: string
          down_outcome_pct: number
          down_outcomes: number
          id: string
          losing_hours: number
          notes: string | null
          period_end: string
          period_start: string
          profitable_hours: number
          total_invested: number
          total_losses: number
          total_pnl: number
          total_trades: number
          total_wins: number
          up_outcome_pct: number
          up_outcomes: number
          win_rate: number
        }
        Insert: {
          avg_pnl_per_hour?: number
          created_at?: string
          down_outcome_pct?: number
          down_outcomes?: number
          id?: string
          losing_hours?: number
          notes?: string | null
          period_end: string
          period_start: string
          profitable_hours?: number
          total_invested?: number
          total_losses?: number
          total_pnl?: number
          total_trades?: number
          total_wins?: number
          up_outcome_pct?: number
          up_outcomes?: number
          win_rate?: number
        }
        Update: {
          avg_pnl_per_hour?: number
          created_at?: string
          down_outcome_pct?: number
          down_outcomes?: number
          id?: string
          losing_hours?: number
          notes?: string | null
          period_end?: string
          period_start?: string
          profitable_hours?: number
          total_invested?: number
          total_losses?: number
          total_pnl?: number
          total_trades?: number
          total_wins?: number
          up_outcome_pct?: number
          up_outcomes?: number
          win_rate?: number
        }
        Relationships: []
      }
      inventory_snapshots: {
        Row: {
          asset: string
          avg_down_cost: number | null
          avg_up_cost: number | null
          created_at: string
          down_shares: number
          hedge_lag_ms: number | null
          id: string
          market_id: string
          pair_cost: number | null
          paired_delay_sec: number | null
          paired_shares: number | null
          skew_allowed_reason: string | null
          state: string
          state_age_ms: number | null
          trigger_type: string | null
          ts: number
          unpaired_notional_usd: number | null
          unpaired_shares: number | null
          up_shares: number
        }
        Insert: {
          asset: string
          avg_down_cost?: number | null
          avg_up_cost?: number | null
          created_at?: string
          down_shares?: number
          hedge_lag_ms?: number | null
          id?: string
          market_id: string
          pair_cost?: number | null
          paired_delay_sec?: number | null
          paired_shares?: number | null
          skew_allowed_reason?: string | null
          state: string
          state_age_ms?: number | null
          trigger_type?: string | null
          ts: number
          unpaired_notional_usd?: number | null
          unpaired_shares?: number | null
          up_shares?: number
        }
        Update: {
          asset?: string
          avg_down_cost?: number | null
          avg_up_cost?: number | null
          created_at?: string
          down_shares?: number
          hedge_lag_ms?: number | null
          id?: string
          market_id?: string
          pair_cost?: number | null
          paired_delay_sec?: number | null
          paired_shares?: number | null
          skew_allowed_reason?: string | null
          state?: string
          state_age_ms?: number | null
          trigger_type?: string | null
          ts?: number
          unpaired_notional_usd?: number | null
          unpaired_shares?: number | null
          up_shares?: number
        }
        Relationships: []
      }
      live_bot_settings: {
        Row: {
          id: string
          is_enabled: boolean | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          is_enabled?: boolean | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          is_enabled?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      live_trade_results: {
        Row: {
          asset: string
          claim_status: string | null
          claim_tx_hash: string | null
          claim_usdc: number | null
          claimed_at: string | null
          created_at: string | null
          down_avg_price: number | null
          down_cost: number | null
          down_shares: number | null
          event_end_time: string | null
          id: string
          market_slug: string
          payout: number | null
          profit_loss: number | null
          profit_loss_percent: number | null
          result: string | null
          settled_at: string | null
          total_invested: number | null
          up_avg_price: number | null
          up_cost: number | null
          up_shares: number | null
          wallet_address: string | null
        }
        Insert: {
          asset: string
          claim_status?: string | null
          claim_tx_hash?: string | null
          claim_usdc?: number | null
          claimed_at?: string | null
          created_at?: string | null
          down_avg_price?: number | null
          down_cost?: number | null
          down_shares?: number | null
          event_end_time?: string | null
          id?: string
          market_slug: string
          payout?: number | null
          profit_loss?: number | null
          profit_loss_percent?: number | null
          result?: string | null
          settled_at?: string | null
          total_invested?: number | null
          up_avg_price?: number | null
          up_cost?: number | null
          up_shares?: number | null
          wallet_address?: string | null
        }
        Update: {
          asset?: string
          claim_status?: string | null
          claim_tx_hash?: string | null
          claim_usdc?: number | null
          claimed_at?: string | null
          created_at?: string | null
          down_avg_price?: number | null
          down_cost?: number | null
          down_shares?: number | null
          event_end_time?: string | null
          id?: string
          market_slug?: string
          payout?: number | null
          profit_loss?: number | null
          profit_loss_percent?: number | null
          result?: string | null
          settled_at?: string | null
          total_invested?: number | null
          up_avg_price?: number | null
          up_cost?: number | null
          up_shares?: number | null
          wallet_address?: string | null
        }
        Relationships: []
      }
      live_trade_results_archive: {
        Row: {
          archived_at: string | null
          asset: string
          claim_status: string | null
          claim_tx_hash: string | null
          claim_usdc: number | null
          claimed_at: string | null
          created_at: string | null
          down_avg_price: number | null
          down_cost: number | null
          down_shares: number | null
          event_end_time: string | null
          id: string
          market_slug: string
          payout: number | null
          profit_loss: number | null
          profit_loss_percent: number | null
          result: string | null
          settled_at: string | null
          total_invested: number | null
          up_avg_price: number | null
          up_cost: number | null
          up_shares: number | null
          wallet_address: string | null
        }
        Insert: {
          archived_at?: string | null
          asset: string
          claim_status?: string | null
          claim_tx_hash?: string | null
          claim_usdc?: number | null
          claimed_at?: string | null
          created_at?: string | null
          down_avg_price?: number | null
          down_cost?: number | null
          down_shares?: number | null
          event_end_time?: string | null
          id: string
          market_slug: string
          payout?: number | null
          profit_loss?: number | null
          profit_loss_percent?: number | null
          result?: string | null
          settled_at?: string | null
          total_invested?: number | null
          up_avg_price?: number | null
          up_cost?: number | null
          up_shares?: number | null
          wallet_address?: string | null
        }
        Update: {
          archived_at?: string | null
          asset?: string
          claim_status?: string | null
          claim_tx_hash?: string | null
          claim_usdc?: number | null
          claimed_at?: string | null
          created_at?: string | null
          down_avg_price?: number | null
          down_cost?: number | null
          down_shares?: number | null
          event_end_time?: string | null
          id?: string
          market_slug?: string
          payout?: number | null
          profit_loss?: number | null
          profit_loss_percent?: number | null
          result?: string | null
          settled_at?: string | null
          total_invested?: number | null
          up_avg_price?: number | null
          up_cost?: number | null
          up_shares?: number | null
          wallet_address?: string | null
        }
        Relationships: []
      }
      live_trades: {
        Row: {
          arbitrage_edge: number | null
          asset: string
          avg_fill_price: number | null
          created_at: string | null
          estimated_slippage: number | null
          event_end_time: string | null
          event_start_time: string | null
          id: string
          market_slug: string
          order_id: string | null
          outcome: string
          price: number
          reasoning: string | null
          shares: number
          status: string | null
          total: number
          wallet_address: string | null
        }
        Insert: {
          arbitrage_edge?: number | null
          asset: string
          avg_fill_price?: number | null
          created_at?: string | null
          estimated_slippage?: number | null
          event_end_time?: string | null
          event_start_time?: string | null
          id?: string
          market_slug: string
          order_id?: string | null
          outcome: string
          price: number
          reasoning?: string | null
          shares: number
          status?: string | null
          total: number
          wallet_address?: string | null
        }
        Update: {
          arbitrage_edge?: number | null
          asset?: string
          avg_fill_price?: number | null
          created_at?: string | null
          estimated_slippage?: number | null
          event_end_time?: string | null
          event_start_time?: string | null
          id?: string
          market_slug?: string
          order_id?: string | null
          outcome?: string
          price?: number
          reasoning?: string | null
          shares?: number
          status?: string | null
          total?: number
          wallet_address?: string | null
        }
        Relationships: []
      }
      live_trades_archive: {
        Row: {
          arbitrage_edge: number | null
          archived_at: string | null
          asset: string
          avg_fill_price: number | null
          created_at: string | null
          estimated_slippage: number | null
          event_end_time: string | null
          event_start_time: string | null
          id: string
          market_slug: string
          order_id: string | null
          outcome: string
          price: number
          reasoning: string | null
          shares: number
          status: string | null
          total: number
          wallet_address: string | null
        }
        Insert: {
          arbitrage_edge?: number | null
          archived_at?: string | null
          asset: string
          avg_fill_price?: number | null
          created_at?: string | null
          estimated_slippage?: number | null
          event_end_time?: string | null
          event_start_time?: string | null
          id: string
          market_slug: string
          order_id?: string | null
          outcome: string
          price: number
          reasoning?: string | null
          shares: number
          status?: string | null
          total: number
          wallet_address?: string | null
        }
        Update: {
          arbitrage_edge?: number | null
          archived_at?: string | null
          asset?: string
          avg_fill_price?: number | null
          created_at?: string | null
          estimated_slippage?: number | null
          event_end_time?: string | null
          event_start_time?: string | null
          id?: string
          market_slug?: string
          order_id?: string | null
          outcome?: string
          price?: number
          reasoning?: string | null
          shares?: number
          status?: string | null
          total?: number
          wallet_address?: string | null
        }
        Relationships: []
      }
      market_config: {
        Row: {
          asset: string
          created_at: string
          enabled: boolean
          id: string
          max_ask_price: number
          max_combined_price: number
          max_exposure_usd: number
          max_notional_usd: number
          max_seconds_remaining: number
          max_shares: number
          min_ask_price: number
          min_delta_usd: number
          min_edge_pct: number
          min_seconds_remaining: number
          shadow_only: boolean
          stop_loss_pct: number
          take_profit_pct: number
          trailing_stop_enabled: boolean
          trailing_stop_pct: number | null
          updated_at: string
        }
        Insert: {
          asset: string
          created_at?: string
          enabled?: boolean
          id?: string
          max_ask_price?: number
          max_combined_price?: number
          max_exposure_usd?: number
          max_notional_usd?: number
          max_seconds_remaining?: number
          max_shares?: number
          min_ask_price?: number
          min_delta_usd?: number
          min_edge_pct?: number
          min_seconds_remaining?: number
          shadow_only?: boolean
          stop_loss_pct?: number
          take_profit_pct?: number
          trailing_stop_enabled?: boolean
          trailing_stop_pct?: number | null
          updated_at?: string
        }
        Update: {
          asset?: string
          created_at?: string
          enabled?: boolean
          id?: string
          max_ask_price?: number
          max_combined_price?: number
          max_exposure_usd?: number
          max_notional_usd?: number
          max_seconds_remaining?: number
          max_shares?: number
          min_ask_price?: number
          min_delta_usd?: number
          min_edge_pct?: number
          min_seconds_remaining?: number
          shadow_only?: boolean
          stop_loss_pct?: number
          take_profit_pct?: number
          trailing_stop_enabled?: boolean
          trailing_stop_pct?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      market_history: {
        Row: {
          asset: string
          close_price: number | null
          close_timestamp: number | null
          created_at: string
          down_price_at_close: number | null
          down_token_id: string | null
          event_end_time: string
          event_start_time: string
          id: string
          open_price: number | null
          open_timestamp: number | null
          question: string | null
          result: string | null
          slug: string
          strike_price: number | null
          up_price_at_close: number | null
          up_token_id: string | null
          updated_at: string
        }
        Insert: {
          asset: string
          close_price?: number | null
          close_timestamp?: number | null
          created_at?: string
          down_price_at_close?: number | null
          down_token_id?: string | null
          event_end_time: string
          event_start_time: string
          id?: string
          open_price?: number | null
          open_timestamp?: number | null
          question?: string | null
          result?: string | null
          slug: string
          strike_price?: number | null
          up_price_at_close?: number | null
          up_token_id?: string | null
          updated_at?: string
        }
        Update: {
          asset?: string
          close_price?: number | null
          close_timestamp?: number | null
          created_at?: string
          down_price_at_close?: number | null
          down_token_id?: string | null
          event_end_time?: string
          event_start_time?: string
          id?: string
          open_price?: number | null
          open_timestamp?: number | null
          question?: string | null
          result?: string | null
          slug?: string
          strike_price?: number | null
          up_price_at_close?: number | null
          up_token_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      market_lifecycle: {
        Row: {
          created_at: string | null
          has_buy: boolean | null
          has_redeem: boolean | null
          has_sell: boolean | null
          id: string
          is_claimed: boolean | null
          is_lost: boolean | null
          market_id: string
          market_slug: string | null
          realized_pnl: number
          resolved_outcome: string | null
          settlement_ts: string | null
          state: string
          total_cost: number
          total_payout: number
          updated_at: string | null
          wallet: string
        }
        Insert: {
          created_at?: string | null
          has_buy?: boolean | null
          has_redeem?: boolean | null
          has_sell?: boolean | null
          id: string
          is_claimed?: boolean | null
          is_lost?: boolean | null
          market_id: string
          market_slug?: string | null
          realized_pnl?: number
          resolved_outcome?: string | null
          settlement_ts?: string | null
          state?: string
          total_cost?: number
          total_payout?: number
          updated_at?: string | null
          wallet: string
        }
        Update: {
          created_at?: string | null
          has_buy?: boolean | null
          has_redeem?: boolean | null
          has_sell?: boolean | null
          id?: string
          is_claimed?: boolean | null
          is_lost?: boolean | null
          market_id?: string
          market_slug?: string | null
          realized_pnl?: number
          resolved_outcome?: string | null
          settlement_ts?: string | null
          state?: string
          total_cost?: number
          total_payout?: number
          updated_at?: string | null
          wallet?: string
        }
        Relationships: []
      }
      mtm_snapshots: {
        Row: {
          asset: string
          book_ready_down: boolean
          book_ready_up: boolean
          combined_mid: number | null
          confidence: string
          created_at: string
          down_mid: number | null
          fallback_used: string | null
          id: string
          market_id: string
          run_id: string | null
          ts: number
          unrealized_pnl: number | null
          up_mid: number | null
        }
        Insert: {
          asset: string
          book_ready_down?: boolean
          book_ready_up?: boolean
          combined_mid?: number | null
          confidence?: string
          created_at?: string
          down_mid?: number | null
          fallback_used?: string | null
          id?: string
          market_id: string
          run_id?: string | null
          ts: number
          unrealized_pnl?: number | null
          up_mid?: number | null
        }
        Update: {
          asset?: string
          book_ready_down?: boolean
          book_ready_up?: boolean
          combined_mid?: number | null
          confidence?: string
          created_at?: string
          down_mid?: number | null
          fallback_used?: string | null
          id?: string
          market_id?: string
          run_id?: string | null
          ts?: number
          unrealized_pnl?: number | null
          up_mid?: number | null
        }
        Relationships: []
      }
      order_queue: {
        Row: {
          asset: string
          avg_fill_price: number | null
          correlation_id: string | null
          created_at: string
          error_message: string | null
          event_end_time: string | null
          event_start_time: string | null
          executed_at: string | null
          id: string
          intent_type: string | null
          market_slug: string
          order_id: string | null
          order_type: string
          outcome: string
          price: number
          reasoning: string | null
          run_id: string | null
          shares: number
          status: string
          token_id: string
        }
        Insert: {
          asset: string
          avg_fill_price?: number | null
          correlation_id?: string | null
          created_at?: string
          error_message?: string | null
          event_end_time?: string | null
          event_start_time?: string | null
          executed_at?: string | null
          id?: string
          intent_type?: string | null
          market_slug: string
          order_id?: string | null
          order_type?: string
          outcome: string
          price: number
          reasoning?: string | null
          run_id?: string | null
          shares: number
          status?: string
          token_id: string
        }
        Update: {
          asset?: string
          avg_fill_price?: number | null
          correlation_id?: string | null
          created_at?: string
          error_message?: string | null
          event_end_time?: string | null
          event_start_time?: string | null
          executed_at?: string | null
          id?: string
          intent_type?: string | null
          market_slug?: string
          order_id?: string | null
          order_type?: string
          outcome?: string
          price?: number
          reasoning?: string | null
          run_id?: string | null
          shares?: number
          status?: string
          token_id?: string
        }
        Relationships: []
      }
      order_queue_archive: {
        Row: {
          archived_at: string | null
          asset: string
          avg_fill_price: number | null
          correlation_id: string | null
          created_at: string | null
          error_message: string | null
          event_end_time: string | null
          event_start_time: string | null
          executed_at: string | null
          id: string
          intent_type: string | null
          market_slug: string
          order_id: string | null
          order_type: string | null
          outcome: string
          price: number
          reasoning: string | null
          run_id: string | null
          shares: number
          status: string | null
          token_id: string
        }
        Insert: {
          archived_at?: string | null
          asset: string
          avg_fill_price?: number | null
          correlation_id?: string | null
          created_at?: string | null
          error_message?: string | null
          event_end_time?: string | null
          event_start_time?: string | null
          executed_at?: string | null
          id: string
          intent_type?: string | null
          market_slug: string
          order_id?: string | null
          order_type?: string | null
          outcome: string
          price: number
          reasoning?: string | null
          run_id?: string | null
          shares: number
          status?: string | null
          token_id: string
        }
        Update: {
          archived_at?: string | null
          asset?: string
          avg_fill_price?: number | null
          correlation_id?: string | null
          created_at?: string | null
          error_message?: string | null
          event_end_time?: string | null
          event_start_time?: string | null
          executed_at?: string | null
          id?: string
          intent_type?: string | null
          market_slug?: string
          order_id?: string | null
          order_type?: string | null
          outcome?: string
          price?: number
          reasoning?: string | null
          run_id?: string | null
          shares?: number
          status?: string | null
          token_id?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          asset: string
          avg_fill_price: number | null
          client_order_id: string
          correlation_id: string | null
          created_at: string
          created_ts: number
          exchange_order_id: string | null
          filled_qty: number | null
          id: string
          intent_type: string
          last_update_ts: number
          market_id: string
          price: number
          qty: number
          released_notional: number | null
          reserved_notional: number | null
          side: string
          status: string
        }
        Insert: {
          asset: string
          avg_fill_price?: number | null
          client_order_id: string
          correlation_id?: string | null
          created_at?: string
          created_ts: number
          exchange_order_id?: string | null
          filled_qty?: number | null
          id?: string
          intent_type: string
          last_update_ts: number
          market_id: string
          price: number
          qty: number
          released_notional?: number | null
          reserved_notional?: number | null
          side: string
          status?: string
        }
        Update: {
          asset?: string
          avg_fill_price?: number | null
          client_order_id?: string
          correlation_id?: string | null
          created_at?: string
          created_ts?: number
          exchange_order_id?: string | null
          filled_qty?: number | null
          id?: string
          intent_type?: string
          last_update_ts?: number
          market_id?: string
          price?: number
          qty?: number
          released_notional?: number | null
          reserved_notional?: number | null
          side?: string
          status?: string
        }
        Relationships: []
      }
      paper_bot_settings: {
        Row: {
          id: string
          is_enabled: boolean | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          is_enabled?: boolean | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          is_enabled?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      paper_price_snapshots: {
        Row: {
          asset: string
          binance_price: number | null
          chainlink_price: number | null
          created_at: string
          down_best_ask: number | null
          down_best_bid: number | null
          id: string
          market_slug: string | null
          strike_price: number | null
          ts: number
          up_best_ask: number | null
          up_best_bid: number | null
        }
        Insert: {
          asset: string
          binance_price?: number | null
          chainlink_price?: number | null
          created_at?: string
          down_best_ask?: number | null
          down_best_bid?: number | null
          id?: string
          market_slug?: string | null
          strike_price?: number | null
          ts: number
          up_best_ask?: number | null
          up_best_bid?: number | null
        }
        Update: {
          asset?: string
          binance_price?: number | null
          chainlink_price?: number | null
          created_at?: string
          down_best_ask?: number | null
          down_best_bid?: number | null
          id?: string
          market_slug?: string | null
          strike_price?: number | null
          ts?: number
          up_best_ask?: number | null
          up_best_bid?: number | null
        }
        Relationships: []
      }
      paper_signals: {
        Row: {
          asset: string
          binance_chainlink_delta: number | null
          binance_chainlink_latency_ms: number | null
          binance_delta: number
          binance_price: number
          chainlink_price: number | null
          config_snapshot: Json | null
          created_at: string
          direction: string
          entry_fee: number | null
          entry_price: number | null
          exit_fee: number | null
          exit_price: number | null
          exit_type: string | null
          fill_ts: number | null
          gross_pnl: number | null
          id: string
          is_live: boolean | null
          market_slug: string | null
          net_pnl: number | null
          notes: string | null
          order_type: string | null
          run_id: string | null
          sell_ts: number | null
          share_price: number
          shares: number | null
          signal_ts: number
          sl_price: number | null
          sl_status: string | null
          status: string
          strike_price: number | null
          total_fees: number | null
          tp_price: number | null
          tp_status: string | null
          trade_size_usd: number | null
        }
        Insert: {
          asset: string
          binance_chainlink_delta?: number | null
          binance_chainlink_latency_ms?: number | null
          binance_delta: number
          binance_price: number
          chainlink_price?: number | null
          config_snapshot?: Json | null
          created_at?: string
          direction: string
          entry_fee?: number | null
          entry_price?: number | null
          exit_fee?: number | null
          exit_price?: number | null
          exit_type?: string | null
          fill_ts?: number | null
          gross_pnl?: number | null
          id?: string
          is_live?: boolean | null
          market_slug?: string | null
          net_pnl?: number | null
          notes?: string | null
          order_type?: string | null
          run_id?: string | null
          sell_ts?: number | null
          share_price: number
          shares?: number | null
          signal_ts: number
          sl_price?: number | null
          sl_status?: string | null
          status?: string
          strike_price?: number | null
          total_fees?: number | null
          tp_price?: number | null
          tp_status?: string | null
          trade_size_usd?: number | null
        }
        Update: {
          asset?: string
          binance_chainlink_delta?: number | null
          binance_chainlink_latency_ms?: number | null
          binance_delta?: number
          binance_price?: number
          chainlink_price?: number | null
          config_snapshot?: Json | null
          created_at?: string
          direction?: string
          entry_fee?: number | null
          entry_price?: number | null
          exit_fee?: number | null
          exit_price?: number | null
          exit_type?: string | null
          fill_ts?: number | null
          gross_pnl?: number | null
          id?: string
          is_live?: boolean | null
          market_slug?: string | null
          net_pnl?: number | null
          notes?: string | null
          order_type?: string | null
          run_id?: string | null
          sell_ts?: number | null
          share_price?: number
          shares?: number | null
          signal_ts?: number
          sl_price?: number | null
          sl_status?: string | null
          status?: string
          strike_price?: number | null
          total_fees?: number | null
          tp_price?: number | null
          tp_status?: string | null
          trade_size_usd?: number | null
        }
        Relationships: []
      }
      paper_tp_sl_events: {
        Row: {
          created_at: string
          current_bid: number
          id: string
          signal_id: string | null
          sl_distance_cents: number | null
          sl_price: number | null
          tp_distance_cents: number | null
          tp_price: number | null
          triggered: string | null
          ts: number
        }
        Insert: {
          created_at?: string
          current_bid: number
          id?: string
          signal_id?: string | null
          sl_distance_cents?: number | null
          sl_price?: number | null
          tp_distance_cents?: number | null
          tp_price?: number | null
          triggered?: string | null
          ts: number
        }
        Update: {
          created_at?: string
          current_bid?: number
          id?: string
          signal_id?: string | null
          sl_distance_cents?: number | null
          sl_price?: number | null
          tp_distance_cents?: number | null
          tp_price?: number | null
          triggered?: string | null
          ts?: number
        }
        Relationships: [
          {
            foreignKeyName: "paper_tp_sl_events_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "paper_signals"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_trade_results: {
        Row: {
          asset: string
          created_at: string | null
          down_avg_price: number | null
          down_cost: number | null
          down_shares: number | null
          event_end_time: string | null
          id: string
          market_slug: string
          payout: number | null
          profit_loss: number | null
          profit_loss_percent: number | null
          result: string | null
          settled_at: string | null
          total_invested: number | null
          up_avg_price: number | null
          up_cost: number | null
          up_shares: number | null
        }
        Insert: {
          asset: string
          created_at?: string | null
          down_avg_price?: number | null
          down_cost?: number | null
          down_shares?: number | null
          event_end_time?: string | null
          id?: string
          market_slug: string
          payout?: number | null
          profit_loss?: number | null
          profit_loss_percent?: number | null
          result?: string | null
          settled_at?: string | null
          total_invested?: number | null
          up_avg_price?: number | null
          up_cost?: number | null
          up_shares?: number | null
        }
        Update: {
          asset?: string
          created_at?: string | null
          down_avg_price?: number | null
          down_cost?: number | null
          down_shares?: number | null
          event_end_time?: string | null
          id?: string
          market_slug?: string
          payout?: number | null
          profit_loss?: number | null
          profit_loss_percent?: number | null
          result?: string | null
          settled_at?: string | null
          total_invested?: number | null
          up_avg_price?: number | null
          up_cost?: number | null
          up_shares?: number | null
        }
        Relationships: []
      }
      paper_trader_logs: {
        Row: {
          asset: string
          binance_price: number | null
          config_snapshot: Json | null
          created_at: string
          delta_usd: number | null
          event_type: string
          id: string
          reason: string | null
          run_id: string | null
          share_price: number | null
          ts: number
        }
        Insert: {
          asset: string
          binance_price?: number | null
          config_snapshot?: Json | null
          created_at?: string
          delta_usd?: number | null
          event_type: string
          id?: string
          reason?: string | null
          run_id?: string | null
          share_price?: number | null
          ts: number
        }
        Update: {
          asset?: string
          binance_price?: number | null
          config_snapshot?: Json | null
          created_at?: string
          delta_usd?: number | null
          event_type?: string
          id?: string
          reason?: string | null
          run_id?: string | null
          share_price?: number | null
          ts?: number
        }
        Relationships: []
      }
      paper_trades: {
        Row: {
          arbitrage_edge: number | null
          asset: string
          available_liquidity: number | null
          avg_fill_price: number | null
          best_ask: number | null
          best_bid: number | null
          combined_price: number | null
          created_at: string | null
          crypto_price: number | null
          estimated_slippage: number | null
          event_end_time: string | null
          event_start_time: string | null
          id: string
          market_slug: string
          open_price: number | null
          outcome: string
          price: number
          price_delta: number | null
          price_delta_percent: number | null
          reasoning: string | null
          remaining_seconds: number | null
          shares: number
          total: number
          trade_type: string | null
        }
        Insert: {
          arbitrage_edge?: number | null
          asset: string
          available_liquidity?: number | null
          avg_fill_price?: number | null
          best_ask?: number | null
          best_bid?: number | null
          combined_price?: number | null
          created_at?: string | null
          crypto_price?: number | null
          estimated_slippage?: number | null
          event_end_time?: string | null
          event_start_time?: string | null
          id?: string
          market_slug: string
          open_price?: number | null
          outcome: string
          price: number
          price_delta?: number | null
          price_delta_percent?: number | null
          reasoning?: string | null
          remaining_seconds?: number | null
          shares: number
          total: number
          trade_type?: string | null
        }
        Update: {
          arbitrage_edge?: number | null
          asset?: string
          available_liquidity?: number | null
          avg_fill_price?: number | null
          best_ask?: number | null
          best_bid?: number | null
          combined_price?: number | null
          created_at?: string | null
          crypto_price?: number | null
          estimated_slippage?: number | null
          event_end_time?: string | null
          event_start_time?: string | null
          id?: string
          market_slug?: string
          open_price?: number | null
          outcome?: string
          price?: number
          price_delta?: number | null
          price_delta_percent?: number | null
          reasoning?: string | null
          remaining_seconds?: number | null
          shares?: number
          total?: number
          trade_type?: string | null
        }
        Relationships: []
      }
      paper_trading_config: {
        Row: {
          assets: string[] | null
          created_at: string
          enabled: boolean | null
          id: string
          is_live: boolean | null
          max_share_price: number | null
          min_delta_usd: number | null
          min_share_price: number | null
          sl_cents: number | null
          sl_enabled: boolean | null
          timeout_ms: number | null
          tp_cents: number | null
          tp_enabled: boolean | null
          tp_pct: number | null
          trade_size_usd: number | null
          updated_at: string
        }
        Insert: {
          assets?: string[] | null
          created_at?: string
          enabled?: boolean | null
          id?: string
          is_live?: boolean | null
          max_share_price?: number | null
          min_delta_usd?: number | null
          min_share_price?: number | null
          sl_cents?: number | null
          sl_enabled?: boolean | null
          timeout_ms?: number | null
          tp_cents?: number | null
          tp_enabled?: boolean | null
          tp_pct?: number | null
          trade_size_usd?: number | null
          updated_at?: string
        }
        Update: {
          assets?: string[] | null
          created_at?: string
          enabled?: boolean | null
          id?: string
          is_live?: boolean | null
          max_share_price?: number | null
          min_delta_usd?: number | null
          min_share_price?: number | null
          sl_cents?: number | null
          sl_enabled?: boolean | null
          timeout_ms?: number | null
          tp_cents?: number | null
          tp_enabled?: boolean | null
          tp_pct?: number | null
          trade_size_usd?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      pnl_snapshots: {
        Row: {
          claimed_markets: number
          created_at: string | null
          id: string
          lost_markets: number
          open_markets: number
          realized_pnl: number
          settled_markets: number
          total_cost: number
          total_fees: number
          total_markets: number
          total_pnl: number
          ts: string
          unrealized_pnl: number
          wallet: string
        }
        Insert: {
          claimed_markets?: number
          created_at?: string | null
          id: string
          lost_markets?: number
          open_markets?: number
          realized_pnl?: number
          settled_markets?: number
          total_cost?: number
          total_fees?: number
          total_markets?: number
          total_pnl?: number
          ts?: string
          unrealized_pnl?: number
          wallet: string
        }
        Update: {
          claimed_markets?: number
          created_at?: string | null
          id?: string
          lost_markets?: number
          open_markets?: number
          realized_pnl?: number
          settled_markets?: number
          total_cost?: number
          total_fees?: number
          total_markets?: number
          total_pnl?: number
          ts?: string
          unrealized_pnl?: number
          wallet?: string
        }
        Relationships: []
      }
      polymarket_cashflows: {
        Row: {
          amount_usd: number
          condition_id: string | null
          created_at: string | null
          fee_known: boolean | null
          fee_usd: number | null
          id: string
          ingested_at: string | null
          market_id: string | null
          outcome_side: string | null
          price: number | null
          raw_json: Json | null
          shares: number | null
          source: string
          token_id: string | null
          ts: string
          type: string
          wallet: string
        }
        Insert: {
          amount_usd?: number
          condition_id?: string | null
          created_at?: string | null
          fee_known?: boolean | null
          fee_usd?: number | null
          id: string
          ingested_at?: string | null
          market_id?: string | null
          outcome_side?: string | null
          price?: number | null
          raw_json?: Json | null
          shares?: number | null
          source: string
          token_id?: string | null
          ts: string
          type: string
          wallet: string
        }
        Update: {
          amount_usd?: number
          condition_id?: string | null
          created_at?: string | null
          fee_known?: boolean | null
          fee_usd?: number | null
          id?: string
          ingested_at?: string | null
          market_id?: string | null
          outcome_side?: string | null
          price?: number | null
          raw_json?: Json | null
          shares?: number | null
          source?: string
          token_id?: string | null
          ts?: string
          type?: string
          wallet?: string
        }
        Relationships: []
      }
      polymarket_market_resolution: {
        Row: {
          condition_id: string
          created_at: string | null
          id: string
          is_resolved: boolean | null
          market_slug: string | null
          payout_per_share_down: number | null
          payout_per_share_up: number | null
          raw_json: Json | null
          resolution_source: string | null
          resolved_at: string | null
          updated_at: string | null
          winning_outcome: string | null
          winning_token_id: string | null
        }
        Insert: {
          condition_id: string
          created_at?: string | null
          id: string
          is_resolved?: boolean | null
          market_slug?: string | null
          payout_per_share_down?: number | null
          payout_per_share_up?: number | null
          raw_json?: Json | null
          resolution_source?: string | null
          resolved_at?: string | null
          updated_at?: string | null
          winning_outcome?: string | null
          winning_token_id?: string | null
        }
        Update: {
          condition_id?: string
          created_at?: string | null
          id?: string
          is_resolved?: boolean | null
          market_slug?: string | null
          payout_per_share_down?: number | null
          payout_per_share_up?: number | null
          raw_json?: Json | null
          resolution_source?: string | null
          resolved_at?: string | null
          updated_at?: string | null
          winning_outcome?: string | null
          winning_token_id?: string | null
        }
        Relationships: []
      }
      position_snapshots: {
        Row: {
          avg_price: number
          created_at: string
          current_price: number | null
          id: string
          is_closed: boolean | null
          market_slug: string
          market_title: string | null
          outcome: string
          pnl: number | null
          pnl_percent: number | null
          shares: number
          snapshot_at: string
          trader_username: string
          value: number | null
        }
        Insert: {
          avg_price: number
          created_at?: string
          current_price?: number | null
          id?: string
          is_closed?: boolean | null
          market_slug: string
          market_title?: string | null
          outcome: string
          pnl?: number | null
          pnl_percent?: number | null
          shares: number
          snapshot_at?: string
          trader_username?: string
          value?: number | null
        }
        Update: {
          avg_price?: number
          created_at?: string
          current_price?: number | null
          id?: string
          is_closed?: boolean | null
          market_slug?: string
          market_title?: string | null
          outcome?: string
          pnl?: number | null
          pnl_percent?: number | null
          shares?: number
          snapshot_at?: string
          trader_username?: string
          value?: number | null
        }
        Relationships: []
      }
      positions: {
        Row: {
          avg_price: number
          created_at: string
          current_price: number | null
          id: string
          market: string
          market_slug: string | null
          outcome: string
          pnl: number | null
          pnl_percent: number | null
          shares: number
          trader_username: string
          updated_at: string
        }
        Insert: {
          avg_price: number
          created_at?: string
          current_price?: number | null
          id?: string
          market: string
          market_slug?: string | null
          outcome: string
          pnl?: number | null
          pnl_percent?: number | null
          shares: number
          trader_username?: string
          updated_at?: string
        }
        Update: {
          avg_price?: number
          created_at?: string
          current_price?: number | null
          id?: string
          market?: string
          market_slug?: string | null
          outcome?: string
          pnl?: number | null
          pnl_percent?: number | null
          shares?: number
          trader_username?: string
          updated_at?: string
        }
        Relationships: []
      }
      price_ticks: {
        Row: {
          asset: string
          created_at: string
          delta: number | null
          delta_percent: number | null
          id: string
          price: number
          source: string | null
        }
        Insert: {
          asset: string
          created_at?: string
          delta?: number | null
          delta_percent?: number | null
          id?: string
          price: number
          source?: string | null
        }
        Update: {
          asset?: string
          created_at?: string
          delta?: number | null
          delta_percent?: number | null
          id?: string
          price?: number
          source?: string | null
        }
        Relationships: []
      }
      raw_subgraph_events: {
        Row: {
          amount_usd: number
          created_at: string | null
          event_type: string
          fee_usd: number | null
          id: string
          ingested_at: string | null
          market_id: string
          outcome: string | null
          price: number | null
          raw_json: Json | null
          shares: number
          timestamp: string
          tx_hash: string | null
          wallet: string
        }
        Insert: {
          amount_usd?: number
          created_at?: string | null
          event_type: string
          fee_usd?: number | null
          id: string
          ingested_at?: string | null
          market_id: string
          outcome?: string | null
          price?: number | null
          raw_json?: Json | null
          shares?: number
          timestamp: string
          tx_hash?: string | null
          wallet: string
        }
        Update: {
          amount_usd?: number
          created_at?: string | null
          event_type?: string
          fee_usd?: number | null
          id?: string
          ingested_at?: string | null
          market_id?: string
          outcome?: string | null
          price?: number | null
          raw_json?: Json | null
          shares?: number
          timestamp?: string
          tx_hash?: string | null
          wallet?: string
        }
        Relationships: []
      }
      realtime_price_logs: {
        Row: {
          asset: string
          created_at: string
          id: string
          outcome: string | null
          price: number
          raw_timestamp: number | null
          received_at: string
          source: string
        }
        Insert: {
          asset: string
          created_at?: string
          id?: string
          outcome?: string | null
          price: number
          raw_timestamp?: number | null
          received_at?: string
          source: string
        }
        Update: {
          asset?: string
          created_at?: string
          id?: string
          outcome?: string | null
          price?: number
          raw_timestamp?: number | null
          received_at?: string
          source?: string
        }
        Relationships: []
      }
      reconcile_reports: {
        Row: {
          coverage_pct: number | null
          created_at: string
          csv_filename: string | null
          csv_storage_path: string | null
          error_message: string | null
          fully_covered_count: number | null
          id: string
          not_covered_count: number | null
          partially_covered_count: number | null
          processed_at: string | null
          processing_time_ms: number | null
          report_data: Json | null
          status: string
          total_bot_fills: number | null
          total_csv_transactions: number | null
          unexplained_count: number | null
          zip_filename: string | null
          zip_storage_path: string | null
        }
        Insert: {
          coverage_pct?: number | null
          created_at?: string
          csv_filename?: string | null
          csv_storage_path?: string | null
          error_message?: string | null
          fully_covered_count?: number | null
          id?: string
          not_covered_count?: number | null
          partially_covered_count?: number | null
          processed_at?: string | null
          processing_time_ms?: number | null
          report_data?: Json | null
          status?: string
          total_bot_fills?: number | null
          total_csv_transactions?: number | null
          unexplained_count?: number | null
          zip_filename?: string | null
          zip_storage_path?: string | null
        }
        Update: {
          coverage_pct?: number | null
          created_at?: string
          csv_filename?: string | null
          csv_storage_path?: string | null
          error_message?: string | null
          fully_covered_count?: number | null
          id?: string
          not_covered_count?: number | null
          partially_covered_count?: number | null
          processed_at?: string | null
          processing_time_ms?: number | null
          report_data?: Json | null
          status?: string
          total_bot_fills?: number | null
          total_csv_transactions?: number | null
          unexplained_count?: number | null
          zip_filename?: string | null
          zip_storage_path?: string | null
        }
        Relationships: []
      }
      runner_heartbeats: {
        Row: {
          balance: number | null
          created_at: string
          dry_run: boolean | null
          id: string
          ip_address: string | null
          last_heartbeat: string
          markets_active: number | null
          markets_count: number | null
          metadata: Json | null
          mode: string | null
          positions_count: number | null
          runner_id: string
          runner_type: string
          status: string
          total_locked_profit: number | null
          total_unpaired: number | null
          trades_count: number | null
          version: string | null
        }
        Insert: {
          balance?: number | null
          created_at?: string
          dry_run?: boolean | null
          id?: string
          ip_address?: string | null
          last_heartbeat?: string
          markets_active?: number | null
          markets_count?: number | null
          metadata?: Json | null
          mode?: string | null
          positions_count?: number | null
          runner_id: string
          runner_type?: string
          status?: string
          total_locked_profit?: number | null
          total_unpaired?: number | null
          trades_count?: number | null
          version?: string | null
        }
        Update: {
          balance?: number | null
          created_at?: string
          dry_run?: boolean | null
          id?: string
          ip_address?: string | null
          last_heartbeat?: string
          markets_active?: number | null
          markets_count?: number | null
          metadata?: Json | null
          mode?: string | null
          positions_count?: number | null
          runner_id?: string
          runner_type?: string
          status?: string
          total_locked_profit?: number | null
          total_unpaired?: number | null
          trades_count?: number | null
          version?: string | null
        }
        Relationships: []
      }
      runner_lease: {
        Row: {
          created_at: string
          id: string
          locked_until: string
          runner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          locked_until?: string
          runner_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          locked_until?: string
          runner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      runner_leases: {
        Row: {
          acquired_at: string
          expires_at: string
          heartbeat_at: string
          id: string
          runner_id: string
        }
        Insert: {
          acquired_at?: string
          expires_at?: string
          heartbeat_at?: string
          id?: string
          runner_id: string
        }
        Update: {
          acquired_at?: string
          expires_at?: string
          heartbeat_at?: string
          id?: string
          runner_id?: string
        }
        Relationships: []
      }
      settlement_failures: {
        Row: {
          asset: string
          created_at: string
          down_cost: number
          down_shares: number
          id: string
          lost_cost: number
          lost_side: string
          market_slug: string
          panic_hedge_attempted: boolean
          reason: string
          seconds_remaining: number
          up_cost: number
          up_shares: number
          wallet_address: string | null
        }
        Insert: {
          asset: string
          created_at?: string
          down_cost?: number
          down_shares?: number
          id?: string
          lost_cost: number
          lost_side: string
          market_slug: string
          panic_hedge_attempted?: boolean
          reason: string
          seconds_remaining: number
          up_cost?: number
          up_shares?: number
          wallet_address?: string | null
        }
        Update: {
          asset?: string
          created_at?: string
          down_cost?: number
          down_shares?: number
          id?: string
          lost_cost?: number
          lost_side?: string
          market_slug?: string
          panic_hedge_attempted?: boolean
          reason?: string
          seconds_remaining?: number
          up_cost?: number
          up_shares?: number
          wallet_address?: string | null
        }
        Relationships: []
      }
      settlement_logs: {
        Row: {
          asset: string
          avg_down_cost: number | null
          avg_up_cost: number | null
          close_ts: number
          correlation_id: string | null
          count_dislocation_95: number
          count_dislocation_97: number
          created_at: string
          failure_flag: string | null
          fees: number | null
          final_down_shares: number
          final_up_shares: number
          id: string
          iso: string
          last_180s_dislocation_95: number
          market_id: string
          max_delta: number | null
          min_delta: number | null
          open_ts: number | null
          pair_cost: number | null
          realized_pnl: number | null
          run_id: string | null
          theoretical_pnl: number | null
          time_in_high: number
          time_in_low: number
          time_in_mid: number
          total_payout_usd: number | null
          ts: number
          winning_side: string | null
        }
        Insert: {
          asset: string
          avg_down_cost?: number | null
          avg_up_cost?: number | null
          close_ts: number
          correlation_id?: string | null
          count_dislocation_95?: number
          count_dislocation_97?: number
          created_at?: string
          failure_flag?: string | null
          fees?: number | null
          final_down_shares?: number
          final_up_shares?: number
          id?: string
          iso: string
          last_180s_dislocation_95?: number
          market_id: string
          max_delta?: number | null
          min_delta?: number | null
          open_ts?: number | null
          pair_cost?: number | null
          realized_pnl?: number | null
          run_id?: string | null
          theoretical_pnl?: number | null
          time_in_high?: number
          time_in_low?: number
          time_in_mid?: number
          total_payout_usd?: number | null
          ts: number
          winning_side?: string | null
        }
        Update: {
          asset?: string
          avg_down_cost?: number | null
          avg_up_cost?: number | null
          close_ts?: number
          correlation_id?: string | null
          count_dislocation_95?: number
          count_dislocation_97?: number
          created_at?: string
          failure_flag?: string | null
          fees?: number | null
          final_down_shares?: number
          final_up_shares?: number
          id?: string
          iso?: string
          last_180s_dislocation_95?: number
          market_id?: string
          max_delta?: number | null
          min_delta?: number | null
          open_ts?: number | null
          pair_cost?: number | null
          realized_pnl?: number | null
          run_id?: string | null
          theoretical_pnl?: number | null
          time_in_high?: number
          time_in_low?: number
          time_in_mid?: number
          total_payout_usd?: number | null
          ts?: number
          winning_side?: string | null
        }
        Relationships: []
      }
      shadow_accounting: {
        Row: {
          created_at: string
          daily_losses: number | null
          daily_pnl: number | null
          daily_trades: number | null
          daily_wins: number | null
          drawdown_pct: number | null
          drawdown_usd: number | null
          equity: number
          exposure_by_asset: Json | null
          id: string
          iso: string
          max_drawdown_pct: number | null
          open_positions: number | null
          peak_equity: number | null
          realized_pnl: number
          starting_equity: number
          timestamp: number
          total_fees: number
          total_trades: number | null
          unrealized_pnl: number
        }
        Insert: {
          created_at?: string
          daily_losses?: number | null
          daily_pnl?: number | null
          daily_trades?: number | null
          daily_wins?: number | null
          drawdown_pct?: number | null
          drawdown_usd?: number | null
          equity: number
          exposure_by_asset?: Json | null
          id?: string
          iso?: string
          max_drawdown_pct?: number | null
          open_positions?: number | null
          peak_equity?: number | null
          realized_pnl?: number
          starting_equity?: number
          timestamp: number
          total_fees?: number
          total_trades?: number | null
          unrealized_pnl?: number
        }
        Update: {
          created_at?: string
          daily_losses?: number | null
          daily_pnl?: number | null
          daily_trades?: number | null
          daily_wins?: number | null
          drawdown_pct?: number | null
          drawdown_usd?: number | null
          equity?: number
          exposure_by_asset?: Json | null
          id?: string
          iso?: string
          max_drawdown_pct?: number | null
          open_positions?: number | null
          peak_equity?: number | null
          realized_pnl?: number
          starting_equity?: number
          timestamp?: number
          total_fees?: number
          total_trades?: number | null
          unrealized_pnl?: number
        }
        Relationships: []
      }
      shadow_daily_pnl: {
        Row: {
          avg_loss: number | null
          avg_win: number | null
          created_at: string
          cumulative_pnl: number
          date: string
          emergency_exited: number | null
          ending_equity: number | null
          expired_one_sided: number | null
          id: string
          losses: number
          max_drawdown: number | null
          no_fill: number | null
          paired_hedged: number | null
          profit_factor: number | null
          realized_pnl: number
          starting_equity: number | null
          total_fees: number | null
          total_pnl: number
          trades: number
          unrealized_pnl: number | null
          updated_at: string
          win_rate: number | null
          wins: number
        }
        Insert: {
          avg_loss?: number | null
          avg_win?: number | null
          created_at?: string
          cumulative_pnl?: number
          date: string
          emergency_exited?: number | null
          ending_equity?: number | null
          expired_one_sided?: number | null
          id?: string
          losses?: number
          max_drawdown?: number | null
          no_fill?: number | null
          paired_hedged?: number | null
          profit_factor?: number | null
          realized_pnl?: number
          starting_equity?: number | null
          total_fees?: number | null
          total_pnl?: number
          trades?: number
          unrealized_pnl?: number | null
          updated_at?: string
          win_rate?: number | null
          wins?: number
        }
        Update: {
          avg_loss?: number | null
          avg_win?: number | null
          created_at?: string
          cumulative_pnl?: number
          date?: string
          emergency_exited?: number | null
          ending_equity?: number | null
          expired_one_sided?: number | null
          id?: string
          losses?: number
          max_drawdown?: number | null
          no_fill?: number | null
          paired_hedged?: number | null
          profit_factor?: number | null
          realized_pnl?: number
          starting_equity?: number | null
          total_fees?: number | null
          total_pnl?: number
          trades?: number
          unrealized_pnl?: number | null
          updated_at?: string
          win_rate?: number | null
          wins?: number
        }
        Relationships: []
      }
      shadow_executions: {
        Row: {
          best_ask: number | null
          best_bid: number | null
          cost_usd: number
          created_at: string
          depth_at_best: number | null
          execution_type: string
          fee_usd: number | null
          fill_confidence: string | null
          fill_latency_assumed_ms: number | null
          fill_type: string
          id: string
          iso: string
          position_id: string | null
          price: number
          shares: number
          side: string
          slippage_cents: number | null
          spread: number | null
          timestamp: number
        }
        Insert: {
          best_ask?: number | null
          best_bid?: number | null
          cost_usd: number
          created_at?: string
          depth_at_best?: number | null
          execution_type: string
          fee_usd?: number | null
          fill_confidence?: string | null
          fill_latency_assumed_ms?: number | null
          fill_type: string
          id?: string
          iso?: string
          position_id?: string | null
          price: number
          shares: number
          side: string
          slippage_cents?: number | null
          spread?: number | null
          timestamp: number
        }
        Update: {
          best_ask?: number | null
          best_bid?: number | null
          cost_usd?: number
          created_at?: string
          depth_at_best?: number | null
          execution_type?: string
          fee_usd?: number | null
          fill_confidence?: string | null
          fill_latency_assumed_ms?: number | null
          fill_type?: string
          id?: string
          iso?: string
          position_id?: string | null
          price?: number
          shares?: number
          side?: string
          slippage_cents?: number | null
          spread?: number | null
          timestamp?: number
        }
        Relationships: [
          {
            foreignKeyName: "shadow_executions_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "shadow_positions"
            referencedColumns: ["id"]
          },
        ]
      }
      shadow_hedge_attempts: {
        Row: {
          actual_price: number | null
          attempt_number: number
          created_at: string
          failure_reason: string | null
          hedge_cpp: number | null
          hedge_side: string
          id: string
          is_emergency: boolean | null
          iso: string
          position_id: string | null
          projected_pnl: number | null
          seconds_since_entry: number
          spread_at_attempt: number | null
          success: boolean | null
          target_price: number
          timestamp: number
        }
        Insert: {
          actual_price?: number | null
          attempt_number?: number
          created_at?: string
          failure_reason?: string | null
          hedge_cpp?: number | null
          hedge_side: string
          id?: string
          is_emergency?: boolean | null
          iso?: string
          position_id?: string | null
          projected_pnl?: number | null
          seconds_since_entry: number
          spread_at_attempt?: number | null
          success?: boolean | null
          target_price: number
          timestamp: number
        }
        Update: {
          actual_price?: number | null
          attempt_number?: number
          created_at?: string
          failure_reason?: string | null
          hedge_cpp?: number | null
          hedge_side?: string
          id?: string
          is_emergency?: boolean | null
          iso?: string
          position_id?: string | null
          projected_pnl?: number | null
          seconds_since_entry?: number
          spread_at_attempt?: number | null
          success?: boolean | null
          target_price?: number
          timestamp?: number
        }
        Relationships: [
          {
            foreignKeyName: "shadow_hedge_attempts_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "shadow_positions"
            referencedColumns: ["id"]
          },
        ]
      }
      shadow_positions: {
        Row: {
          adverse_filter_state: Json | null
          asset: string
          best_ask_at_signal: number
          best_bid_at_signal: number
          combined_price_paid: number | null
          created_at: string
          delta_at_entry: number | null
          entry_fill_type: string
          entry_iso: string
          entry_price: number
          entry_timestamp: number
          evaluation_id: string | null
          fees: number | null
          gross_pnl: number | null
          hedge_fill_type: string | null
          hedge_iso: string | null
          hedge_latency_ms: number | null
          hedge_price: number | null
          hedge_spread: number | null
          hedge_timestamp: number | null
          id: string
          market_id: string
          mispricing_at_entry: number | null
          net_pnl: number | null
          paired: boolean | null
          resolution: string | null
          resolution_iso: string | null
          resolution_reason: string | null
          resolution_timestamp: number | null
          roi_pct: number | null
          side: string
          signal_id: string
          size_shares: number
          size_usd: number
          spot_price_at_entry: number | null
          spread_at_entry: number | null
          theoretical_price_at_entry: number | null
          time_to_expiry_at_entry: number | null
          updated_at: string
        }
        Insert: {
          adverse_filter_state?: Json | null
          asset: string
          best_ask_at_signal: number
          best_bid_at_signal: number
          combined_price_paid?: number | null
          created_at?: string
          delta_at_entry?: number | null
          entry_fill_type: string
          entry_iso?: string
          entry_price: number
          entry_timestamp: number
          evaluation_id?: string | null
          fees?: number | null
          gross_pnl?: number | null
          hedge_fill_type?: string | null
          hedge_iso?: string | null
          hedge_latency_ms?: number | null
          hedge_price?: number | null
          hedge_spread?: number | null
          hedge_timestamp?: number | null
          id?: string
          market_id: string
          mispricing_at_entry?: number | null
          net_pnl?: number | null
          paired?: boolean | null
          resolution?: string | null
          resolution_iso?: string | null
          resolution_reason?: string | null
          resolution_timestamp?: number | null
          roi_pct?: number | null
          side: string
          signal_id: string
          size_shares: number
          size_usd?: number
          spot_price_at_entry?: number | null
          spread_at_entry?: number | null
          theoretical_price_at_entry?: number | null
          time_to_expiry_at_entry?: number | null
          updated_at?: string
        }
        Update: {
          adverse_filter_state?: Json | null
          asset?: string
          best_ask_at_signal?: number
          best_bid_at_signal?: number
          combined_price_paid?: number | null
          created_at?: string
          delta_at_entry?: number | null
          entry_fill_type?: string
          entry_iso?: string
          entry_price?: number
          entry_timestamp?: number
          evaluation_id?: string | null
          fees?: number | null
          gross_pnl?: number | null
          hedge_fill_type?: string | null
          hedge_iso?: string | null
          hedge_latency_ms?: number | null
          hedge_price?: number | null
          hedge_spread?: number | null
          hedge_timestamp?: number | null
          id?: string
          market_id?: string
          mispricing_at_entry?: number | null
          net_pnl?: number | null
          paired?: boolean | null
          resolution?: string | null
          resolution_iso?: string | null
          resolution_reason?: string | null
          resolution_timestamp?: number | null
          roi_pct?: number | null
          side?: string
          signal_id?: string
          size_shares?: number
          size_usd?: number
          spot_price_at_entry?: number | null
          spread_at_entry?: number | null
          theoretical_price_at_entry?: number | null
          time_to_expiry_at_entry?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      signal_quality_analysis: {
        Row: {
          actual_pnl: number | null
          actual_price_at_10s: number | null
          actual_price_at_15s: number | null
          actual_price_at_5s: number | null
          actual_price_at_7s: number | null
          ask_depth_down: number | null
          ask_depth_up: number | null
          asset: string
          best_exit_hedge_profit: number | null
          best_exit_sell_profit_10s: number | null
          best_exit_sell_profit_15s: number | null
          bid_depth_down: number | null
          bid_depth_up: number | null
          binance_tick_ts: number | null
          bucket_confidence: number | null
          bucket_n: number | null
          chosen_exit_type: string | null
          created_at: string | null
          delta_bucket: string
          delta_usd: number
          depth_imbalance: number | null
          direction: string
          down_ask: number | null
          down_bid: number | null
          edge_after_spread_10s: number | null
          edge_after_spread_7s: number | null
          effective_spread_hedge: number | null
          effective_spread_sell: number | null
          expected_move_10s: number | null
          expected_move_15s: number | null
          expected_move_5s: number | null
          expected_move_7s: number | null
          id: string
          is_false_edge: boolean | null
          market_id: string
          missed_profit: number | null
          polymarket_tick_ts: number | null
          should_trade: boolean | null
          signal_id: string
          source: string | null
          spot_lead_bucket: string | null
          spot_lead_ms: number | null
          spot_price_at_signal: number
          spread_down: number | null
          spread_percentile_1h: number | null
          spread_up: number | null
          strike_price: number
          taker_volume_last_5s: number | null
          taker_volume_zscore: number | null
          time_remaining_seconds: number
          timestamp_signal_detected: number
          up_ask: number | null
          up_bid: number | null
          updated_at: string | null
          would_have_lost_money: boolean | null
        }
        Insert: {
          actual_pnl?: number | null
          actual_price_at_10s?: number | null
          actual_price_at_15s?: number | null
          actual_price_at_5s?: number | null
          actual_price_at_7s?: number | null
          ask_depth_down?: number | null
          ask_depth_up?: number | null
          asset: string
          best_exit_hedge_profit?: number | null
          best_exit_sell_profit_10s?: number | null
          best_exit_sell_profit_15s?: number | null
          bid_depth_down?: number | null
          bid_depth_up?: number | null
          binance_tick_ts?: number | null
          bucket_confidence?: number | null
          bucket_n?: number | null
          chosen_exit_type?: string | null
          created_at?: string | null
          delta_bucket: string
          delta_usd: number
          depth_imbalance?: number | null
          direction: string
          down_ask?: number | null
          down_bid?: number | null
          edge_after_spread_10s?: number | null
          edge_after_spread_7s?: number | null
          effective_spread_hedge?: number | null
          effective_spread_sell?: number | null
          expected_move_10s?: number | null
          expected_move_15s?: number | null
          expected_move_5s?: number | null
          expected_move_7s?: number | null
          id?: string
          is_false_edge?: boolean | null
          market_id: string
          missed_profit?: number | null
          polymarket_tick_ts?: number | null
          should_trade?: boolean | null
          signal_id: string
          source?: string | null
          spot_lead_bucket?: string | null
          spot_lead_ms?: number | null
          spot_price_at_signal: number
          spread_down?: number | null
          spread_percentile_1h?: number | null
          spread_up?: number | null
          strike_price: number
          taker_volume_last_5s?: number | null
          taker_volume_zscore?: number | null
          time_remaining_seconds: number
          timestamp_signal_detected: number
          up_ask?: number | null
          up_bid?: number | null
          updated_at?: string | null
          would_have_lost_money?: boolean | null
        }
        Update: {
          actual_pnl?: number | null
          actual_price_at_10s?: number | null
          actual_price_at_15s?: number | null
          actual_price_at_5s?: number | null
          actual_price_at_7s?: number | null
          ask_depth_down?: number | null
          ask_depth_up?: number | null
          asset?: string
          best_exit_hedge_profit?: number | null
          best_exit_sell_profit_10s?: number | null
          best_exit_sell_profit_15s?: number | null
          bid_depth_down?: number | null
          bid_depth_up?: number | null
          binance_tick_ts?: number | null
          bucket_confidence?: number | null
          bucket_n?: number | null
          chosen_exit_type?: string | null
          created_at?: string | null
          delta_bucket?: string
          delta_usd?: number
          depth_imbalance?: number | null
          direction?: string
          down_ask?: number | null
          down_bid?: number | null
          edge_after_spread_10s?: number | null
          edge_after_spread_7s?: number | null
          effective_spread_hedge?: number | null
          effective_spread_sell?: number | null
          expected_move_10s?: number | null
          expected_move_15s?: number | null
          expected_move_5s?: number | null
          expected_move_7s?: number | null
          id?: string
          is_false_edge?: boolean | null
          market_id?: string
          missed_profit?: number | null
          polymarket_tick_ts?: number | null
          should_trade?: boolean | null
          signal_id?: string
          source?: string | null
          spot_lead_bucket?: string | null
          spot_lead_ms?: number | null
          spot_price_at_signal?: number
          spread_down?: number | null
          spread_percentile_1h?: number | null
          spread_up?: number | null
          strike_price?: number
          taker_volume_last_5s?: number | null
          taker_volume_zscore?: number | null
          time_remaining_seconds?: number
          timestamp_signal_detected?: number
          up_ask?: number | null
          up_bid?: number | null
          updated_at?: string | null
          would_have_lost_money?: boolean | null
        }
        Relationships: []
      }
      snapshot_logs: {
        Row: {
          adverse_streak: number
          asset: string
          avg_down_cost: number | null
          avg_up_cost: number | null
          bot_state: string
          cheapest_ask_plus_other_mid: number | null
          combined_ask: number | null
          combined_mid: number | null
          correlation_id: string | null
          created_at: string
          delta: number | null
          down_ask: number | null
          down_bid: number | null
          down_mid: number | null
          down_shares: number
          id: string
          iso: string
          market_id: string
          no_liquidity_streak: number
          orderbook_ready: boolean | null
          pair_cost: number | null
          reason_code: string | null
          run_id: string | null
          seconds_remaining: number
          skew: number | null
          spot_price: number | null
          spread_down: number | null
          spread_up: number | null
          strike_price: number | null
          ts: number
          up_ask: number | null
          up_bid: number | null
          up_mid: number | null
          up_shares: number
        }
        Insert: {
          adverse_streak?: number
          asset: string
          avg_down_cost?: number | null
          avg_up_cost?: number | null
          bot_state: string
          cheapest_ask_plus_other_mid?: number | null
          combined_ask?: number | null
          combined_mid?: number | null
          correlation_id?: string | null
          created_at?: string
          delta?: number | null
          down_ask?: number | null
          down_bid?: number | null
          down_mid?: number | null
          down_shares?: number
          id?: string
          iso: string
          market_id: string
          no_liquidity_streak?: number
          orderbook_ready?: boolean | null
          pair_cost?: number | null
          reason_code?: string | null
          run_id?: string | null
          seconds_remaining: number
          skew?: number | null
          spot_price?: number | null
          spread_down?: number | null
          spread_up?: number | null
          strike_price?: number | null
          ts: number
          up_ask?: number | null
          up_bid?: number | null
          up_mid?: number | null
          up_shares?: number
        }
        Update: {
          adverse_streak?: number
          asset?: string
          avg_down_cost?: number | null
          avg_up_cost?: number | null
          bot_state?: string
          cheapest_ask_plus_other_mid?: number | null
          combined_ask?: number | null
          combined_mid?: number | null
          correlation_id?: string | null
          created_at?: string
          delta?: number | null
          down_ask?: number | null
          down_bid?: number | null
          down_mid?: number | null
          down_shares?: number
          id?: string
          iso?: string
          market_id?: string
          no_liquidity_streak?: number
          orderbook_ready?: boolean | null
          pair_cost?: number | null
          reason_code?: string | null
          run_id?: string | null
          seconds_remaining?: number
          skew?: number | null
          spot_price?: number | null
          spread_down?: number | null
          spread_up?: number | null
          strike_price?: number | null
          ts?: number
          up_ask?: number | null
          up_bid?: number | null
          up_mid?: number | null
          up_shares?: number
        }
        Relationships: []
      }
      state_reconciliation_results: {
        Row: {
          account_down: number
          account_up: number
          action_taken: string | null
          created_at: string
          delta_invested: number | null
          delta_shares: number
          id: string
          local_down: number
          local_up: number
          market_id: string
          reconciliation_result: string
          run_id: string | null
          ts: number
        }
        Insert: {
          account_down?: number
          account_up?: number
          action_taken?: string | null
          created_at?: string
          delta_invested?: number | null
          delta_shares?: number
          id?: string
          local_down?: number
          local_up?: number
          market_id: string
          reconciliation_result: string
          run_id?: string | null
          ts: number
        }
        Update: {
          account_down?: number
          account_up?: number
          action_taken?: string | null
          created_at?: string
          delta_invested?: number | null
          delta_shares?: number
          id?: string
          local_down?: number
          local_up?: number
          market_id?: string
          reconciliation_result?: string
          run_id?: string | null
          ts?: number
        }
        Relationships: []
      }
      strike_prices: {
        Row: {
          asset: string
          chainlink_timestamp: number
          close_price: number | null
          close_timestamp: number | null
          created_at: string | null
          event_start_time: string
          id: string
          market_slug: string
          open_price: number | null
          open_timestamp: number | null
          quality: string | null
          source: string | null
          strike_price: number
        }
        Insert: {
          asset: string
          chainlink_timestamp: number
          close_price?: number | null
          close_timestamp?: number | null
          created_at?: string | null
          event_start_time: string
          id?: string
          market_slug: string
          open_price?: number | null
          open_timestamp?: number | null
          quality?: string | null
          source?: string | null
          strike_price: number
        }
        Update: {
          asset?: string
          chainlink_timestamp?: number
          close_price?: number | null
          close_timestamp?: number | null
          created_at?: string | null
          event_start_time?: string
          id?: string
          market_slug?: string
          open_price?: number | null
          open_timestamp?: number | null
          quality?: string | null
          source?: string | null
          strike_price?: number
        }
        Relationships: []
      }
      subgraph_fills: {
        Row: {
          block_number: number | null
          created_at: string | null
          fee_known: boolean | null
          fee_usd: number | null
          id: string
          ingested_at: string | null
          liquidity: string | null
          log_index: number | null
          market_id: string | null
          notional: number
          outcome_side: string | null
          price: number
          raw_json: Json | null
          side: string
          size: number
          timestamp: string
          token_id: string | null
          tx_hash: string | null
          wallet: string
        }
        Insert: {
          block_number?: number | null
          created_at?: string | null
          fee_known?: boolean | null
          fee_usd?: number | null
          id: string
          ingested_at?: string | null
          liquidity?: string | null
          log_index?: number | null
          market_id?: string | null
          notional: number
          outcome_side?: string | null
          price: number
          raw_json?: Json | null
          side: string
          size: number
          timestamp: string
          token_id?: string | null
          tx_hash?: string | null
          wallet: string
        }
        Update: {
          block_number?: number | null
          created_at?: string | null
          fee_known?: boolean | null
          fee_usd?: number | null
          id?: string
          ingested_at?: string | null
          liquidity?: string | null
          log_index?: number | null
          market_id?: string | null
          notional?: number
          outcome_side?: string | null
          price?: number
          raw_json?: Json | null
          side?: string
          size?: number
          timestamp?: string
          token_id?: string | null
          tx_hash?: string | null
          wallet?: string
        }
        Relationships: []
      }
      subgraph_ingest_state: {
        Row: {
          created_at: string | null
          id: string
          is_complete: boolean
          last_sync_at: string | null
          newest_event_ts: string | null
          oldest_event_ts: string | null
          total_events_ingested: number
          updated_at: string | null
          wallet: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_complete?: boolean
          last_sync_at?: string | null
          newest_event_ts?: string | null
          oldest_event_ts?: string | null
          total_events_ingested?: number
          updated_at?: string | null
          wallet: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_complete?: boolean
          last_sync_at?: string | null
          newest_event_ts?: string | null
          oldest_event_ts?: string | null
          total_events_ingested?: number
          updated_at?: string | null
          wallet?: string
        }
        Relationships: []
      }
      subgraph_pnl_markets: {
        Row: {
          avg_down_cost: number | null
          avg_up_cost: number | null
          confidence: string | null
          created_at: string | null
          down_shares: number | null
          drift_flags: Json | null
          fees_known_usd: number | null
          fees_unknown_count: number | null
          id: string
          is_settled: boolean | null
          last_reconciled_at: string | null
          lifecycle_bought: boolean | null
          lifecycle_claimed: boolean | null
          lifecycle_lost: boolean | null
          lifecycle_sold: boolean | null
          lifecycle_state: string | null
          mark_price_down: number | null
          mark_price_up: number | null
          mark_source: string | null
          mark_timestamp: string | null
          market_id: string
          market_slug: string | null
          missing_payout_reason: string | null
          payout_amount_usd: number | null
          payout_ingested: boolean | null
          payout_source: string | null
          payout_ts: string | null
          payout_tx_hash: string | null
          realized_confidence: string | null
          realized_pnl_usd: number | null
          resolution_fetched_at: string | null
          resolution_winning_outcome: string | null
          settled_at: string | null
          settlement_outcome: string | null
          settlement_payout: number | null
          synthetic_closure_created: boolean | null
          synthetic_closure_reason: string | null
          total_cost: number | null
          unrealized_confidence: string | null
          unrealized_pnl_usd: number | null
          up_shares: number | null
          updated_at: string | null
          wallet: string
        }
        Insert: {
          avg_down_cost?: number | null
          avg_up_cost?: number | null
          confidence?: string | null
          created_at?: string | null
          down_shares?: number | null
          drift_flags?: Json | null
          fees_known_usd?: number | null
          fees_unknown_count?: number | null
          id: string
          is_settled?: boolean | null
          last_reconciled_at?: string | null
          lifecycle_bought?: boolean | null
          lifecycle_claimed?: boolean | null
          lifecycle_lost?: boolean | null
          lifecycle_sold?: boolean | null
          lifecycle_state?: string | null
          mark_price_down?: number | null
          mark_price_up?: number | null
          mark_source?: string | null
          mark_timestamp?: string | null
          market_id: string
          market_slug?: string | null
          missing_payout_reason?: string | null
          payout_amount_usd?: number | null
          payout_ingested?: boolean | null
          payout_source?: string | null
          payout_ts?: string | null
          payout_tx_hash?: string | null
          realized_confidence?: string | null
          realized_pnl_usd?: number | null
          resolution_fetched_at?: string | null
          resolution_winning_outcome?: string | null
          settled_at?: string | null
          settlement_outcome?: string | null
          settlement_payout?: number | null
          synthetic_closure_created?: boolean | null
          synthetic_closure_reason?: string | null
          total_cost?: number | null
          unrealized_confidence?: string | null
          unrealized_pnl_usd?: number | null
          up_shares?: number | null
          updated_at?: string | null
          wallet: string
        }
        Update: {
          avg_down_cost?: number | null
          avg_up_cost?: number | null
          confidence?: string | null
          created_at?: string | null
          down_shares?: number | null
          drift_flags?: Json | null
          fees_known_usd?: number | null
          fees_unknown_count?: number | null
          id?: string
          is_settled?: boolean | null
          last_reconciled_at?: string | null
          lifecycle_bought?: boolean | null
          lifecycle_claimed?: boolean | null
          lifecycle_lost?: boolean | null
          lifecycle_sold?: boolean | null
          lifecycle_state?: string | null
          mark_price_down?: number | null
          mark_price_up?: number | null
          mark_source?: string | null
          mark_timestamp?: string | null
          market_id?: string
          market_slug?: string | null
          missing_payout_reason?: string | null
          payout_amount_usd?: number | null
          payout_ingested?: boolean | null
          payout_source?: string | null
          payout_ts?: string | null
          payout_tx_hash?: string | null
          realized_confidence?: string | null
          realized_pnl_usd?: number | null
          resolution_fetched_at?: string | null
          resolution_winning_outcome?: string | null
          settled_at?: string | null
          settlement_outcome?: string | null
          settlement_payout?: number | null
          synthetic_closure_created?: boolean | null
          synthetic_closure_reason?: string | null
          total_cost?: number | null
          unrealized_confidence?: string | null
          unrealized_pnl_usd?: number | null
          up_shares?: number | null
          updated_at?: string | null
          wallet?: string
        }
        Relationships: []
      }
      subgraph_pnl_summary: {
        Row: {
          drift_count: number | null
          first_trade_at: string | null
          last_reconciled_at: string | null
          last_trade_at: string | null
          markets_bought: number | null
          markets_claimed: number | null
          markets_lost: number | null
          markets_sold: number | null
          open_markets: number | null
          overall_confidence: string | null
          realized_confidence: string | null
          resolution_fetch_count: number | null
          settled_markets: number | null
          synthetic_closures_count: number | null
          total_fees_known: number | null
          total_fees_unknown_count: number | null
          total_fills: number | null
          total_markets: number | null
          total_pnl: number | null
          total_realized_pnl: number | null
          total_unrealized_pnl: number | null
          unrealized_confidence: string | null
          updated_at: string | null
          wallet: string
        }
        Insert: {
          drift_count?: number | null
          first_trade_at?: string | null
          last_reconciled_at?: string | null
          last_trade_at?: string | null
          markets_bought?: number | null
          markets_claimed?: number | null
          markets_lost?: number | null
          markets_sold?: number | null
          open_markets?: number | null
          overall_confidence?: string | null
          realized_confidence?: string | null
          resolution_fetch_count?: number | null
          settled_markets?: number | null
          synthetic_closures_count?: number | null
          total_fees_known?: number | null
          total_fees_unknown_count?: number | null
          total_fills?: number | null
          total_markets?: number | null
          total_pnl?: number | null
          total_realized_pnl?: number | null
          total_unrealized_pnl?: number | null
          unrealized_confidence?: string | null
          updated_at?: string | null
          wallet: string
        }
        Update: {
          drift_count?: number | null
          first_trade_at?: string | null
          last_reconciled_at?: string | null
          last_trade_at?: string | null
          markets_bought?: number | null
          markets_claimed?: number | null
          markets_lost?: number | null
          markets_sold?: number | null
          open_markets?: number | null
          overall_confidence?: string | null
          realized_confidence?: string | null
          resolution_fetch_count?: number | null
          settled_markets?: number | null
          synthetic_closures_count?: number | null
          total_fees_known?: number | null
          total_fees_unknown_count?: number | null
          total_fills?: number | null
          total_markets?: number | null
          total_pnl?: number | null
          total_realized_pnl?: number | null
          total_unrealized_pnl?: number | null
          unrealized_confidence?: string | null
          updated_at?: string | null
          wallet?: string
        }
        Relationships: []
      }
      subgraph_positions: {
        Row: {
          avg_cost: number | null
          created_at: string | null
          id: string
          market_id: string | null
          outcome_side: string | null
          raw_json: Json | null
          shares: number
          snapshot_id: string | null
          timestamp: string
          token_id: string
          updated_at: string | null
          wallet: string
        }
        Insert: {
          avg_cost?: number | null
          created_at?: string | null
          id: string
          market_id?: string | null
          outcome_side?: string | null
          raw_json?: Json | null
          shares: number
          snapshot_id?: string | null
          timestamp: string
          token_id: string
          updated_at?: string | null
          wallet: string
        }
        Update: {
          avg_cost?: number | null
          created_at?: string | null
          id?: string
          market_id?: string | null
          outcome_side?: string | null
          raw_json?: Json | null
          shares?: number
          snapshot_id?: string | null
          timestamp?: string
          token_id?: string
          updated_at?: string | null
          wallet?: string
        }
        Relationships: []
      }
      subgraph_reconciliation: {
        Row: {
          created_at: string | null
          delta_shares_down: number | null
          delta_shares_up: number | null
          id: string
          local_shares_down: number | null
          local_shares_up: number | null
          local_source: string | null
          market_id: string | null
          notes: string | null
          severity: string
          status: string | null
          subgraph_shares_down: number | null
          subgraph_shares_up: number | null
          subgraph_source: string | null
          timestamp: string | null
          wallet: string
        }
        Insert: {
          created_at?: string | null
          delta_shares_down?: number | null
          delta_shares_up?: number | null
          id?: string
          local_shares_down?: number | null
          local_shares_up?: number | null
          local_source?: string | null
          market_id?: string | null
          notes?: string | null
          severity: string
          status?: string | null
          subgraph_shares_down?: number | null
          subgraph_shares_up?: number | null
          subgraph_source?: string | null
          timestamp?: string | null
          wallet: string
        }
        Update: {
          created_at?: string | null
          delta_shares_down?: number | null
          delta_shares_up?: number | null
          id?: string
          local_shares_down?: number | null
          local_shares_up?: number | null
          local_source?: string | null
          market_id?: string | null
          notes?: string | null
          severity?: string
          status?: string | null
          subgraph_shares_down?: number | null
          subgraph_shares_up?: number | null
          subgraph_source?: string | null
          timestamp?: string | null
          wallet?: string
        }
        Relationships: []
      }
      subgraph_sync_state: {
        Row: {
          created_at: string | null
          errors_count: number | null
          id: string
          last_block_number: number | null
          last_error: string | null
          last_sync_at: string | null
          last_timestamp: string | null
          payout_error: string | null
          payout_records_synced: number | null
          payout_sync_at: string | null
          records_synced: number | null
          updated_at: string | null
          wallet: string
        }
        Insert: {
          created_at?: string | null
          errors_count?: number | null
          id: string
          last_block_number?: number | null
          last_error?: string | null
          last_sync_at?: string | null
          last_timestamp?: string | null
          payout_error?: string | null
          payout_records_synced?: number | null
          payout_sync_at?: string | null
          records_synced?: number | null
          updated_at?: string | null
          wallet: string
        }
        Update: {
          created_at?: string | null
          errors_count?: number | null
          id?: string
          last_block_number?: number | null
          last_error?: string | null
          last_sync_at?: string | null
          last_timestamp?: string | null
          payout_error?: string | null
          payout_records_synced?: number | null
          payout_sync_at?: string | null
          records_synced?: number | null
          updated_at?: string | null
          wallet?: string
        }
        Relationships: []
      }
      toxicity_features: {
        Row: {
          ask_change_count: number | null
          ask_median_early: number | null
          ask_median_late: number | null
          ask_volatility: number | null
          asset: string
          bid_drift: number | null
          classification: string
          confidence: string | null
          created_at: string
          data_quality: string
          decision: string
          filter_version: string
          id: string
          liquidity_pull_detected: boolean
          market_id: string
          market_slug: string
          market_start_time: string
          max_gap_seconds: number
          mean_distance_to_target: number | null
          mid_drift: number | null
          min_distance_to_target: number | null
          n_ticks: number
          outcome: string | null
          percentile_rank: number | null
          pnl: number | null
          run_id: string | null
          settled_at: string | null
          spread_jump_last_20s: number | null
          spread_volatility: number | null
          target_price: number
          time_near_target_pct: number | null
          toxicity_score: number | null
        }
        Insert: {
          ask_change_count?: number | null
          ask_median_early?: number | null
          ask_median_late?: number | null
          ask_volatility?: number | null
          asset: string
          bid_drift?: number | null
          classification?: string
          confidence?: string | null
          created_at?: string
          data_quality?: string
          decision?: string
          filter_version?: string
          id?: string
          liquidity_pull_detected?: boolean
          market_id: string
          market_slug: string
          market_start_time: string
          max_gap_seconds?: number
          mean_distance_to_target?: number | null
          mid_drift?: number | null
          min_distance_to_target?: number | null
          n_ticks?: number
          outcome?: string | null
          percentile_rank?: number | null
          pnl?: number | null
          run_id?: string | null
          settled_at?: string | null
          spread_jump_last_20s?: number | null
          spread_volatility?: number | null
          target_price?: number
          time_near_target_pct?: number | null
          toxicity_score?: number | null
        }
        Update: {
          ask_change_count?: number | null
          ask_median_early?: number | null
          ask_median_late?: number | null
          ask_volatility?: number | null
          asset?: string
          bid_drift?: number | null
          classification?: string
          confidence?: string | null
          created_at?: string
          data_quality?: string
          decision?: string
          filter_version?: string
          id?: string
          liquidity_pull_detected?: boolean
          market_id?: string
          market_slug?: string
          market_start_time?: string
          max_gap_seconds?: number
          mean_distance_to_target?: number | null
          mid_drift?: number | null
          min_distance_to_target?: number | null
          n_ticks?: number
          outcome?: string | null
          percentile_rank?: number | null
          pnl?: number | null
          run_id?: string | null
          settled_at?: string | null
          spread_jump_last_20s?: number | null
          spread_volatility?: number | null
          target_price?: number
          time_near_target_pct?: number | null
          toxicity_score?: number | null
        }
        Relationships: []
      }
      tracked_wallet_trades: {
        Row: {
          asset: string | null
          created_at: string
          fee: number | null
          id: string
          market_slug: string | null
          outcome: string | null
          price: number
          raw_data: Json | null
          side: string
          size: number
          timestamp: string
          trade_id: string
          wallet_address: string
        }
        Insert: {
          asset?: string | null
          created_at?: string
          fee?: number | null
          id?: string
          market_slug?: string | null
          outcome?: string | null
          price: number
          raw_data?: Json | null
          side: string
          size: number
          timestamp: string
          trade_id: string
          wallet_address: string
        }
        Update: {
          asset?: string | null
          created_at?: string
          fee?: number | null
          id?: string
          market_slug?: string | null
          outcome?: string | null
          price?: number
          raw_data?: Json | null
          side?: string
          size?: number
          timestamp?: string
          trade_id?: string
          wallet_address?: string
        }
        Relationships: []
      }
      trader_stats: {
        Row: {
          active_since: string | null
          avg_trade_size: number | null
          id: string
          last_active: string | null
          total_trades: number | null
          total_volume: number | null
          trader_username: string
          updated_at: string
          win_rate: number | null
        }
        Insert: {
          active_since?: string | null
          avg_trade_size?: number | null
          id?: string
          last_active?: string | null
          total_trades?: number | null
          total_volume?: number | null
          trader_username?: string
          updated_at?: string
          win_rate?: number | null
        }
        Update: {
          active_since?: string | null
          avg_trade_size?: number | null
          id?: string
          last_active?: string | null
          total_trades?: number | null
          total_volume?: number | null
          trader_username?: string
          updated_at?: string
          win_rate?: number | null
        }
        Relationships: []
      }
      trades: {
        Row: {
          created_at: string
          external_id: string | null
          id: string
          market: string
          market_slug: string | null
          outcome: string
          price: number
          shares: number
          side: string
          status: string | null
          timestamp: string
          total: number
          trader_username: string
        }
        Insert: {
          created_at?: string
          external_id?: string | null
          id?: string
          market: string
          market_slug?: string | null
          outcome: string
          price: number
          shares: number
          side: string
          status?: string | null
          timestamp: string
          total: number
          trader_username?: string
        }
        Update: {
          created_at?: string
          external_id?: string | null
          id?: string
          market?: string
          market_slug?: string | null
          outcome?: string
          price?: number
          shares?: number
          side?: string
          status?: string | null
          timestamp?: string
          total?: number
          trader_username?: string
        }
        Relationships: []
      }
      true_pnl_snapshots: {
        Row: {
          clob_balance: number
          created_at: string
          hour: string
          id: string
          open_orders_value: number
          portfolio_value: number
          running_bets_value: number
          total_deposits: number
          true_pnl: number
          true_pnl_percent: number
        }
        Insert: {
          clob_balance?: number
          created_at?: string
          hour: string
          id?: string
          open_orders_value?: number
          portfolio_value?: number
          running_bets_value?: number
          total_deposits?: number
          true_pnl?: number
          true_pnl_percent?: number
        }
        Update: {
          clob_balance?: number
          created_at?: string
          hour?: string
          id?: string
          open_orders_value?: number
          portfolio_value?: number
          running_bets_value?: number
          total_deposits?: number
          true_pnl?: number
          true_pnl_percent?: number
        }
        Relationships: []
      }
      v26_asset_config: {
        Row: {
          asset: string
          created_at: string
          enabled: boolean
          id: string
          price: number
          shares: number
          side: string
          updated_at: string
        }
        Insert: {
          asset: string
          created_at?: string
          enabled?: boolean
          id?: string
          price?: number
          shares?: number
          side?: string
          updated_at?: string
        }
        Update: {
          asset?: string
          created_at?: string
          enabled?: boolean
          id?: string
          price?: number
          shares?: number
          side?: string
          updated_at?: string
        }
        Relationships: []
      }
      v26_config: {
        Row: {
          assets: string[]
          cancel_after_start_sec: number
          config_version: number
          created_at: string
          enabled: boolean
          id: string
          max_lead_time_sec: number
          min_lead_time_sec: number
          price: number
          shares: number
          side: string
          updated_at: string
        }
        Insert: {
          assets?: string[]
          cancel_after_start_sec?: number
          config_version?: number
          created_at?: string
          enabled?: boolean
          id?: string
          max_lead_time_sec?: number
          min_lead_time_sec?: number
          price?: number
          shares?: number
          side?: string
          updated_at?: string
        }
        Update: {
          assets?: string[]
          cancel_after_start_sec?: number
          config_version?: number
          created_at?: string
          enabled?: boolean
          id?: string
          max_lead_time_sec?: number
          min_lead_time_sec?: number
          price?: number
          shares?: number
          side?: string
          updated_at?: string
        }
        Relationships: []
      }
      v26_trades: {
        Row: {
          asset: string
          avg_fill_price: number | null
          created_at: string
          error_message: string | null
          event_end_time: string
          event_start_time: string
          fill_matched_at: string | null
          fill_time_ms: number | null
          filled_shares: number | null
          id: string
          market_id: string
          market_slug: string
          notional: number | null
          order_id: string | null
          placed_at: string | null
          pnl: number | null
          price: number
          result: string | null
          run_id: string | null
          settled_at: string | null
          shares: number
          side: string
          status: string
        }
        Insert: {
          asset: string
          avg_fill_price?: number | null
          created_at?: string
          error_message?: string | null
          event_end_time: string
          event_start_time: string
          fill_matched_at?: string | null
          fill_time_ms?: number | null
          filled_shares?: number | null
          id?: string
          market_id: string
          market_slug: string
          notional?: number | null
          order_id?: string | null
          placed_at?: string | null
          pnl?: number | null
          price?: number
          result?: string | null
          run_id?: string | null
          settled_at?: string | null
          shares?: number
          side?: string
          status?: string
        }
        Update: {
          asset?: string
          avg_fill_price?: number | null
          created_at?: string
          error_message?: string | null
          event_end_time?: string
          event_start_time?: string
          fill_matched_at?: string | null
          fill_time_ms?: number | null
          filled_shares?: number | null
          id?: string
          market_id?: string
          market_slug?: string
          notional?: number | null
          order_id?: string | null
          placed_at?: string | null
          pnl?: number | null
          price?: number
          result?: string | null
          run_id?: string | null
          settled_at?: string | null
          shares?: number
          side?: string
          status?: string
        }
        Relationships: []
      }
      v27_config: {
        Row: {
          asset_thresholds: Json | null
          assets: string[] | null
          causality_max_ms: number | null
          causality_min_ms: number | null
          correction_threshold_pct: number | null
          enabled: boolean | null
          id: string
          shadow_mode: boolean | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          asset_thresholds?: Json | null
          assets?: string[] | null
          causality_max_ms?: number | null
          causality_min_ms?: number | null
          correction_threshold_pct?: number | null
          enabled?: boolean | null
          id?: string
          shadow_mode?: boolean | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          asset_thresholds?: Json | null
          assets?: string[] | null
          causality_max_ms?: number | null
          causality_min_ms?: number | null
          correction_threshold_pct?: number | null
          enabled?: boolean | null
          id?: string
          shadow_mode?: boolean | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      v27_corrections: {
        Row: {
          correction_pct: number
          created_at: string
          current_price: number
          entry_id: string | null
          expected_price: number
          id: string
          is_complete: boolean | null
          ts: number
        }
        Insert: {
          correction_pct: number
          created_at?: string
          current_price: number
          entry_id?: string | null
          expected_price: number
          id?: string
          is_complete?: boolean | null
          ts: number
        }
        Update: {
          correction_pct?: number
          created_at?: string
          current_price?: number
          entry_id?: string | null
          expected_price?: number
          id?: string
          is_complete?: boolean | null
          ts?: number
        }
        Relationships: [
          {
            foreignKeyName: "v27_corrections_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "v27_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      v27_entries: {
        Row: {
          asset: string
          avg_fill_price: number | null
          correction_completed_at: string | null
          correction_started_at: string | null
          created_at: string
          entry_price: number
          exit_price: number | null
          expected_correction: number | null
          filled_shares: number | null
          hedge_at: string | null
          hedge_avg_price: number | null
          hedge_filled_shares: number | null
          hedge_order_id: string | null
          hedge_triggered: boolean | null
          id: string
          market_id: string
          market_slug: string | null
          mispricing_at_entry: number | null
          notional: number
          order_id: string | null
          order_status: string | null
          peak_correction: number | null
          pnl: number | null
          result: string | null
          shares: number
          side: string
          status: string | null
          threshold_at_entry: number | null
          ts: number
        }
        Insert: {
          asset: string
          avg_fill_price?: number | null
          correction_completed_at?: string | null
          correction_started_at?: string | null
          created_at?: string
          entry_price: number
          exit_price?: number | null
          expected_correction?: number | null
          filled_shares?: number | null
          hedge_at?: string | null
          hedge_avg_price?: number | null
          hedge_filled_shares?: number | null
          hedge_order_id?: string | null
          hedge_triggered?: boolean | null
          id?: string
          market_id: string
          market_slug?: string | null
          mispricing_at_entry?: number | null
          notional: number
          order_id?: string | null
          order_status?: string | null
          peak_correction?: number | null
          pnl?: number | null
          result?: string | null
          shares: number
          side: string
          status?: string | null
          threshold_at_entry?: number | null
          ts: number
        }
        Update: {
          asset?: string
          avg_fill_price?: number | null
          correction_completed_at?: string | null
          correction_started_at?: string | null
          created_at?: string
          entry_price?: number
          exit_price?: number | null
          expected_correction?: number | null
          filled_shares?: number | null
          hedge_at?: string | null
          hedge_avg_price?: number | null
          hedge_filled_shares?: number | null
          hedge_order_id?: string | null
          hedge_triggered?: boolean | null
          id?: string
          market_id?: string
          market_slug?: string | null
          mispricing_at_entry?: number | null
          notional?: number
          order_id?: string | null
          order_status?: string | null
          peak_correction?: number | null
          pnl?: number | null
          result?: string | null
          shares?: number
          side?: string
          status?: string | null
          threshold_at_entry?: number | null
          ts?: number
        }
        Relationships: []
      }
      v27_evaluations: {
        Row: {
          action: string | null
          adverse_blocked: boolean | null
          adverse_reason: string | null
          asset: string
          base_threshold: number | null
          book_imbalance: number | null
          causality_passed: boolean | null
          created_at: string
          delta_down: number | null
          delta_up: number | null
          dynamic_threshold: number | null
          id: string
          market_id: string
          mispricing_magnitude: number | null
          mispricing_side: string | null
          pm_down_ask: number | null
          pm_down_bid: number | null
          pm_up_ask: number | null
          pm_up_bid: number | null
          run_id: string | null
          signal_valid: boolean | null
          skip_reason: string | null
          spot_leading_ms: number | null
          spot_price: number | null
          spot_source: string | null
          spread_expansion: number | null
          taker_flow_p90: number | null
          theoretical_down: number | null
          theoretical_up: number | null
          threshold_source: string | null
          ts: number
        }
        Insert: {
          action?: string | null
          adverse_blocked?: boolean | null
          adverse_reason?: string | null
          asset: string
          base_threshold?: number | null
          book_imbalance?: number | null
          causality_passed?: boolean | null
          created_at?: string
          delta_down?: number | null
          delta_up?: number | null
          dynamic_threshold?: number | null
          id?: string
          market_id: string
          mispricing_magnitude?: number | null
          mispricing_side?: string | null
          pm_down_ask?: number | null
          pm_down_bid?: number | null
          pm_up_ask?: number | null
          pm_up_bid?: number | null
          run_id?: string | null
          signal_valid?: boolean | null
          skip_reason?: string | null
          spot_leading_ms?: number | null
          spot_price?: number | null
          spot_source?: string | null
          spread_expansion?: number | null
          taker_flow_p90?: number | null
          theoretical_down?: number | null
          theoretical_up?: number | null
          threshold_source?: string | null
          ts: number
        }
        Update: {
          action?: string | null
          adverse_blocked?: boolean | null
          adverse_reason?: string | null
          asset?: string
          base_threshold?: number | null
          book_imbalance?: number | null
          causality_passed?: boolean | null
          created_at?: string
          delta_down?: number | null
          delta_up?: number | null
          dynamic_threshold?: number | null
          id?: string
          market_id?: string
          mispricing_magnitude?: number | null
          mispricing_side?: string | null
          pm_down_ask?: number | null
          pm_down_bid?: number | null
          pm_up_ask?: number | null
          pm_up_bid?: number | null
          run_id?: string | null
          signal_valid?: boolean | null
          skip_reason?: string | null
          spot_leading_ms?: number | null
          spot_price?: number | null
          spot_source?: string | null
          spread_expansion?: number | null
          taker_flow_p90?: number | null
          theoretical_down?: number | null
          theoretical_up?: number | null
          threshold_source?: string | null
          ts?: number
        }
        Relationships: []
      }
      v27_metrics: {
        Row: {
          adverse_block_reasons: Json | null
          adverse_blocks: number | null
          avg_correction_pct: number | null
          avg_correction_time_ms: number | null
          avg_fill_time_ms: number | null
          corrections_completed: number | null
          corrections_detected: number | null
          created_at: string
          emergency_hedges: number | null
          entries_attempted: number | null
          entries_filled: number | null
          fees_paid: number | null
          fill_rate: number | null
          gross_pnl: number | null
          hedge_success_rate: number | null
          hedges_triggered: number | null
          id: string
          losses: number | null
          net_pnl: number | null
          run_id: string | null
          signal_quality_pct: number | null
          total_signals: number | null
          ts: number
          valid_signals: number | null
          win_rate: number | null
          wins: number | null
        }
        Insert: {
          adverse_block_reasons?: Json | null
          adverse_blocks?: number | null
          avg_correction_pct?: number | null
          avg_correction_time_ms?: number | null
          avg_fill_time_ms?: number | null
          corrections_completed?: number | null
          corrections_detected?: number | null
          created_at?: string
          emergency_hedges?: number | null
          entries_attempted?: number | null
          entries_filled?: number | null
          fees_paid?: number | null
          fill_rate?: number | null
          gross_pnl?: number | null
          hedge_success_rate?: number | null
          hedges_triggered?: number | null
          id?: string
          losses?: number | null
          net_pnl?: number | null
          run_id?: string | null
          signal_quality_pct?: number | null
          total_signals?: number | null
          ts: number
          valid_signals?: number | null
          win_rate?: number | null
          wins?: number | null
        }
        Update: {
          adverse_block_reasons?: Json | null
          adverse_blocks?: number | null
          avg_correction_pct?: number | null
          avg_correction_time_ms?: number | null
          avg_fill_time_ms?: number | null
          corrections_completed?: number | null
          corrections_detected?: number | null
          created_at?: string
          emergency_hedges?: number | null
          entries_attempted?: number | null
          entries_filled?: number | null
          fees_paid?: number | null
          fill_rate?: number | null
          gross_pnl?: number | null
          hedge_success_rate?: number | null
          hedges_triggered?: number | null
          id?: string
          losses?: number | null
          net_pnl?: number | null
          run_id?: string | null
          signal_quality_pct?: number | null
          total_signals?: number | null
          ts?: number
          valid_signals?: number | null
          win_rate?: number | null
          wins?: number | null
        }
        Relationships: []
      }
      v27_price_lookup: {
        Row: {
          asset: string
          avg_down_price: number
          avg_up_price: number
          created_at: string
          delta_bucket: string
          id: string
          max_up: number | null
          min_up: number | null
          sample_count: number
          std_down: number | null
          std_up: number | null
          time_bucket: string
          updated_at: string
        }
        Insert: {
          asset: string
          avg_down_price: number
          avg_up_price: number
          created_at?: string
          delta_bucket: string
          id?: string
          max_up?: number | null
          min_up?: number | null
          sample_count?: number
          std_down?: number | null
          std_up?: number | null
          time_bucket: string
          updated_at?: string
        }
        Update: {
          asset?: string
          avg_down_price?: number
          avg_up_price?: number
          created_at?: string
          delta_bucket?: string
          id?: string
          max_up?: number | null
          min_up?: number | null
          sample_count?: number
          std_down?: number | null
          std_up?: number | null
          time_bucket?: string
          updated_at?: string
        }
        Relationships: []
      }
      v27_signal_tracking: {
        Row: {
          adverse_selection_10s: boolean | null
          adverse_selection_15s: boolean | null
          adverse_selection_5s: boolean | null
          asset: string
          created_at: string
          evaluation_id: string
          hedge_price: number | null
          hedge_side: string | null
          hedge_simulated: boolean | null
          hedge_spread: number | null
          hedge_would_execute: boolean | null
          id: string
          market_id: string
          mispricing_resolved_10s: boolean | null
          mispricing_resolved_15s: boolean | null
          mispricing_resolved_5s: boolean | null
          signal_mispricing: number | null
          signal_price: number | null
          signal_side: string
          signal_spot_price: number | null
          signal_ts: number
          signal_was_correct: boolean | null
          simulated_cpp: number | null
          spot_price_10s: number | null
          spot_price_15s: number | null
          spot_price_5s: number | null
          would_have_profited: boolean | null
        }
        Insert: {
          adverse_selection_10s?: boolean | null
          adverse_selection_15s?: boolean | null
          adverse_selection_5s?: boolean | null
          asset: string
          created_at?: string
          evaluation_id: string
          hedge_price?: number | null
          hedge_side?: string | null
          hedge_simulated?: boolean | null
          hedge_spread?: number | null
          hedge_would_execute?: boolean | null
          id: string
          market_id: string
          mispricing_resolved_10s?: boolean | null
          mispricing_resolved_15s?: boolean | null
          mispricing_resolved_5s?: boolean | null
          signal_mispricing?: number | null
          signal_price?: number | null
          signal_side: string
          signal_spot_price?: number | null
          signal_ts: number
          signal_was_correct?: boolean | null
          simulated_cpp?: number | null
          spot_price_10s?: number | null
          spot_price_15s?: number | null
          spot_price_5s?: number | null
          would_have_profited?: boolean | null
        }
        Update: {
          adverse_selection_10s?: boolean | null
          adverse_selection_15s?: boolean | null
          adverse_selection_5s?: boolean | null
          asset?: string
          created_at?: string
          evaluation_id?: string
          hedge_price?: number | null
          hedge_side?: string | null
          hedge_simulated?: boolean | null
          hedge_spread?: number | null
          hedge_would_execute?: boolean | null
          id?: string
          market_id?: string
          mispricing_resolved_10s?: boolean | null
          mispricing_resolved_15s?: boolean | null
          mispricing_resolved_5s?: boolean | null
          signal_mispricing?: number | null
          signal_price?: number | null
          signal_side?: string
          signal_spot_price?: number | null
          signal_ts?: number
          signal_was_correct?: boolean | null
          simulated_cpp?: number | null
          spot_price_10s?: number | null
          spot_price_15s?: number | null
          spot_price_5s?: number | null
          would_have_profited?: boolean | null
        }
        Relationships: []
      }
      v27_signals: {
        Row: {
          action_taken: boolean | null
          asset: string
          confidence: number | null
          created_at: string
          entry_id: string | null
          id: string
          market_id: string
          mispricing: number
          signal_side: string
          threshold: number
          ts: number
        }
        Insert: {
          action_taken?: boolean | null
          asset: string
          confidence?: number | null
          created_at?: string
          entry_id?: string | null
          id?: string
          market_id: string
          mispricing: number
          signal_side: string
          threshold: number
          ts: number
        }
        Update: {
          action_taken?: boolean | null
          asset?: string
          confidence?: number | null
          created_at?: string
          entry_id?: string | null
          id?: string
          market_id?: string
          mispricing?: number
          signal_side?: string
          threshold?: number
          ts?: number
        }
        Relationships: [
          {
            foreignKeyName: "v27_signals_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "v27_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      v29_aggregate_positions: {
        Row: {
          asset: string
          avg_entry_price: number | null
          avg_hedge_price: number | null
          closed_ts: string | null
          created_at: string
          entry_count: number
          first_entry_ts: string | null
          first_hedge_ts: string | null
          hedge_cost: number
          hedge_count: number
          hedge_shares: number
          id: string
          is_fully_hedged: boolean
          last_entry_ts: string | null
          last_hedge_ts: string | null
          market_slug: string
          realized_pnl: number | null
          run_id: string
          side: string
          state: string
          token_id: string
          total_cost: number
          total_shares: number
          updated_at: string
        }
        Insert: {
          asset: string
          avg_entry_price?: number | null
          avg_hedge_price?: number | null
          closed_ts?: string | null
          created_at?: string
          entry_count?: number
          first_entry_ts?: string | null
          first_hedge_ts?: string | null
          hedge_cost?: number
          hedge_count?: number
          hedge_shares?: number
          id?: string
          is_fully_hedged?: boolean
          last_entry_ts?: string | null
          last_hedge_ts?: string | null
          market_slug: string
          realized_pnl?: number | null
          run_id: string
          side: string
          state?: string
          token_id: string
          total_cost?: number
          total_shares?: number
          updated_at?: string
        }
        Update: {
          asset?: string
          avg_entry_price?: number | null
          avg_hedge_price?: number | null
          closed_ts?: string | null
          created_at?: string
          entry_count?: number
          first_entry_ts?: string | null
          first_hedge_ts?: string | null
          hedge_cost?: number
          hedge_count?: number
          hedge_shares?: number
          id?: string
          is_fully_hedged?: boolean
          last_entry_ts?: string | null
          last_hedge_ts?: string | null
          market_slug?: string
          realized_pnl?: number | null
          run_id?: string
          side?: string
          state?: string
          token_id?: string
          total_cost?: number
          total_shares?: number
          updated_at?: string
        }
        Relationships: []
      }
      v29_bets: {
        Row: {
          asset: string
          buy_count: number | null
          created_at: string
          down_avg_price: number | null
          down_cost: number | null
          down_shares: number | null
          id: string
          market_id: string
          market_slug: string | null
          payout: number | null
          realized_pnl: number | null
          result: string | null
          run_id: string | null
          sell_count: number | null
          settled_outcome: string | null
          status: string
          strike_price: number | null
          total_cost: number | null
          total_revenue: number | null
          unrealized_pnl: number | null
          up_avg_price: number | null
          up_cost: number | null
          up_shares: number | null
          updated_at: string
          window_end: string
          window_start: string
        }
        Insert: {
          asset: string
          buy_count?: number | null
          created_at?: string
          down_avg_price?: number | null
          down_cost?: number | null
          down_shares?: number | null
          id?: string
          market_id: string
          market_slug?: string | null
          payout?: number | null
          realized_pnl?: number | null
          result?: string | null
          run_id?: string | null
          sell_count?: number | null
          settled_outcome?: string | null
          status?: string
          strike_price?: number | null
          total_cost?: number | null
          total_revenue?: number | null
          unrealized_pnl?: number | null
          up_avg_price?: number | null
          up_cost?: number | null
          up_shares?: number | null
          updated_at?: string
          window_end: string
          window_start: string
        }
        Update: {
          asset?: string
          buy_count?: number | null
          created_at?: string
          down_avg_price?: number | null
          down_cost?: number | null
          down_shares?: number | null
          id?: string
          market_id?: string
          market_slug?: string | null
          payout?: number | null
          realized_pnl?: number | null
          result?: string | null
          run_id?: string | null
          sell_count?: number | null
          settled_outcome?: string | null
          status?: string
          strike_price?: number | null
          total_cost?: number | null
          total_revenue?: number | null
          unrealized_pnl?: number | null
          up_avg_price?: number | null
          up_cost?: number | null
          up_shares?: number | null
          updated_at?: string
          window_end?: string
          window_start?: string
        }
        Relationships: []
      }
      v29_config: {
        Row: {
          accumulation_enabled: boolean | null
          aggregate_after_sec: number | null
          assets: string[]
          auto_hedge_enabled: boolean | null
          binance_poll_ms: number
          created_at: string
          delta_threshold: number | null
          emergency_sl_cents: number | null
          enabled: boolean
          force_close_after_sec: number | null
          hedge_min_profit_cents: number | null
          hedge_trigger_cents: number | null
          id: string
          max_sell_retries: number | null
          max_share_price: number
          max_shares: number
          max_total_cost_usd: number | null
          max_total_shares: number | null
          min_delta_usd: number
          min_profit_cents: number | null
          min_share_price: number | null
          order_cooldown_ms: number
          orderbook_poll_ms: number
          prevent_counter_scalping: boolean
          price_buffer_cents: number
          shares_per_trade: number | null
          stop_loss_cents: number | null
          take_profit_cents: number | null
          tick_delta_usd: number | null
          timeout_ms: number
          timeout_seconds: number | null
          trade_size_usd: number
          trailing_distance_cents: number | null
          trailing_trigger_cents: number | null
          updated_at: string
        }
        Insert: {
          accumulation_enabled?: boolean | null
          aggregate_after_sec?: number | null
          assets?: string[]
          auto_hedge_enabled?: boolean | null
          binance_poll_ms?: number
          created_at?: string
          delta_threshold?: number | null
          emergency_sl_cents?: number | null
          enabled?: boolean
          force_close_after_sec?: number | null
          hedge_min_profit_cents?: number | null
          hedge_trigger_cents?: number | null
          id?: string
          max_sell_retries?: number | null
          max_share_price?: number
          max_shares?: number
          max_total_cost_usd?: number | null
          max_total_shares?: number | null
          min_delta_usd?: number
          min_profit_cents?: number | null
          min_share_price?: number | null
          order_cooldown_ms?: number
          orderbook_poll_ms?: number
          prevent_counter_scalping?: boolean
          price_buffer_cents?: number
          shares_per_trade?: number | null
          stop_loss_cents?: number | null
          take_profit_cents?: number | null
          tick_delta_usd?: number | null
          timeout_ms?: number
          timeout_seconds?: number | null
          trade_size_usd?: number
          trailing_distance_cents?: number | null
          trailing_trigger_cents?: number | null
          updated_at?: string
        }
        Update: {
          accumulation_enabled?: boolean | null
          aggregate_after_sec?: number | null
          assets?: string[]
          auto_hedge_enabled?: boolean | null
          binance_poll_ms?: number
          created_at?: string
          delta_threshold?: number | null
          emergency_sl_cents?: number | null
          enabled?: boolean
          force_close_after_sec?: number | null
          hedge_min_profit_cents?: number | null
          hedge_trigger_cents?: number | null
          id?: string
          max_sell_retries?: number | null
          max_share_price?: number
          max_shares?: number
          max_total_cost_usd?: number | null
          max_total_shares?: number | null
          min_delta_usd?: number
          min_profit_cents?: number | null
          min_share_price?: number | null
          order_cooldown_ms?: number
          orderbook_poll_ms?: number
          prevent_counter_scalping?: boolean
          price_buffer_cents?: number
          shares_per_trade?: number | null
          stop_loss_cents?: number | null
          take_profit_cents?: number | null
          tick_delta_usd?: number | null
          timeout_ms?: number
          timeout_seconds?: number | null
          trade_size_usd?: number
          trailing_distance_cents?: number | null
          trailing_trigger_cents?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      v29_config_response: {
        Row: {
          config_json: Json | null
          cooldown_ms: number | null
          down_max_hold_sec: number | null
          down_target_max: number | null
          down_target_min: number | null
          enabled: boolean | null
          id: string
          max_exposure_usd: number | null
          max_share_move_cents: number | null
          max_share_price: number | null
          max_spread_cents: number | null
          min_share_price: number | null
          shares_per_trade: number | null
          signal_delta_usd: number | null
          signal_window_ms: number | null
          up_max_hold_sec: number | null
          up_target_max: number | null
          up_target_min: number | null
          updated_at: string | null
        }
        Insert: {
          config_json?: Json | null
          cooldown_ms?: number | null
          down_max_hold_sec?: number | null
          down_target_max?: number | null
          down_target_min?: number | null
          enabled?: boolean | null
          id?: string
          max_exposure_usd?: number | null
          max_share_move_cents?: number | null
          max_share_price?: number | null
          max_spread_cents?: number | null
          min_share_price?: number | null
          shares_per_trade?: number | null
          signal_delta_usd?: number | null
          signal_window_ms?: number | null
          up_max_hold_sec?: number | null
          up_target_max?: number | null
          up_target_min?: number | null
          updated_at?: string | null
        }
        Update: {
          config_json?: Json | null
          cooldown_ms?: number | null
          down_max_hold_sec?: number | null
          down_target_max?: number | null
          down_target_min?: number | null
          enabled?: boolean | null
          id?: string
          max_exposure_usd?: number | null
          max_share_move_cents?: number | null
          max_share_price?: number | null
          max_spread_cents?: number | null
          min_share_price?: number | null
          shares_per_trade?: number | null
          signal_delta_usd?: number | null
          signal_window_ms?: number | null
          up_max_hold_sec?: number | null
          up_target_max?: number | null
          up_target_min?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      v29_fills: {
        Row: {
          asset: string
          cost_usd: number
          created_at: string
          direction: string
          fill_ts: number
          id: string
          market_slug: string
          order_id: string | null
          price: number
          run_id: string
          shares: number
          signal_id: string | null
        }
        Insert: {
          asset: string
          cost_usd: number
          created_at?: string
          direction: string
          fill_ts: number
          id?: string
          market_slug: string
          order_id?: string | null
          price: number
          run_id: string
          shares: number
          signal_id?: string | null
        }
        Update: {
          asset?: string
          cost_usd?: number
          created_at?: string
          direction?: string
          fill_ts?: number
          id?: string
          market_slug?: string
          order_id?: string | null
          price?: number
          run_id?: string
          shares?: number
          signal_id?: string | null
        }
        Relationships: []
      }
      v29_logs: {
        Row: {
          asset: string | null
          category: string
          created_at: string
          data: Json | null
          id: string
          level: string
          message: string
          run_id: string | null
          ts: number
        }
        Insert: {
          asset?: string | null
          category: string
          created_at?: string
          data?: Json | null
          id?: string
          level?: string
          message: string
          run_id?: string | null
          ts: number
        }
        Update: {
          asset?: string | null
          category?: string
          created_at?: string
          data?: Json | null
          id?: string
          level?: string
          message?: string
          run_id?: string | null
          ts?: number
        }
        Relationships: []
      }
      v29_logs_response: {
        Row: {
          asset: string | null
          category: string | null
          created_at: string | null
          data: Json | null
          id: string
          level: string | null
          message: string | null
          run_id: string | null
        }
        Insert: {
          asset?: string | null
          category?: string | null
          created_at?: string | null
          data?: Json | null
          id?: string
          level?: string | null
          message?: string | null
          run_id?: string | null
        }
        Update: {
          asset?: string | null
          category?: string | null
          created_at?: string | null
          data?: Json | null
          id?: string
          level?: string | null
          message?: string | null
          run_id?: string | null
        }
        Relationships: []
      }
      v29_orders: {
        Row: {
          asset: string
          cost: number | null
          created_at: string
          direction: string
          fill_cost: number | null
          fill_price: number | null
          fill_shares: number | null
          filled_at: string | null
          id: string
          market_id: string
          notes: string | null
          order_id: string | null
          pnl: number | null
          price: number
          run_id: string | null
          shares: number
          side: string
          signal_id: string | null
          status: string
          token_id: string | null
        }
        Insert: {
          asset: string
          cost?: number | null
          created_at?: string
          direction: string
          fill_cost?: number | null
          fill_price?: number | null
          fill_shares?: number | null
          filled_at?: string | null
          id?: string
          market_id: string
          notes?: string | null
          order_id?: string | null
          pnl?: number | null
          price: number
          run_id?: string | null
          shares: number
          side: string
          signal_id?: string | null
          status?: string
          token_id?: string | null
        }
        Update: {
          asset?: string
          cost?: number | null
          created_at?: string
          direction?: string
          fill_cost?: number | null
          fill_price?: number | null
          fill_shares?: number | null
          filled_at?: string | null
          id?: string
          market_id?: string
          notes?: string | null
          order_id?: string | null
          pnl?: number | null
          price?: number
          run_id?: string | null
          shares?: number
          side?: string
          signal_id?: string | null
          status?: string
          token_id?: string | null
        }
        Relationships: []
      }
      v29_positions: {
        Row: {
          asset: string
          created_at: string | null
          hedge_cost: number | null
          hedge_shares: number | null
          id: string
          is_fully_hedged: boolean | null
          market_slug: string
          run_id: string | null
          side: string
          token_id: string | null
          total_cost: number | null
          total_shares: number | null
          updated_at: string | null
        }
        Insert: {
          asset: string
          created_at?: string | null
          hedge_cost?: number | null
          hedge_shares?: number | null
          id?: string
          is_fully_hedged?: boolean | null
          market_slug: string
          run_id?: string | null
          side: string
          token_id?: string | null
          total_cost?: number | null
          total_shares?: number | null
          updated_at?: string | null
        }
        Update: {
          asset?: string
          created_at?: string | null
          hedge_cost?: number | null
          hedge_shares?: number | null
          id?: string
          is_fully_hedged?: boolean | null
          market_slug?: string
          run_id?: string | null
          side?: string
          token_id?: string | null
          total_cost?: number | null
          total_shares?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      v29_signals: {
        Row: {
          asset: string
          binance_price: number
          created_at: string
          delta_usd: number | null
          direction: string
          entry_price: number | null
          exit_price: number | null
          exit_reason: string | null
          fill_ts: number | null
          id: string
          market_slug: string | null
          net_pnl: number | null
          run_id: string
          sell_ts: number | null
          share_price: number | null
          shares: number | null
          signal_key: string | null
          signal_ts: number
          status: string
          strike_price: number | null
        }
        Insert: {
          asset: string
          binance_price: number
          created_at?: string
          delta_usd?: number | null
          direction: string
          entry_price?: number | null
          exit_price?: number | null
          exit_reason?: string | null
          fill_ts?: number | null
          id?: string
          market_slug?: string | null
          net_pnl?: number | null
          run_id: string
          sell_ts?: number | null
          share_price?: number | null
          shares?: number | null
          signal_key?: string | null
          signal_ts: number
          status?: string
          strike_price?: number | null
        }
        Update: {
          asset?: string
          binance_price?: number
          created_at?: string
          delta_usd?: number | null
          direction?: string
          entry_price?: number | null
          exit_price?: number | null
          exit_reason?: string | null
          fill_ts?: number | null
          id?: string
          market_slug?: string | null
          net_pnl?: number | null
          run_id?: string
          sell_ts?: number | null
          share_price?: number | null
          shares?: number | null
          signal_key?: string | null
          signal_ts?: number
          status?: string
          strike_price?: number | null
        }
        Relationships: []
      }
      v29_signals_response: {
        Row: {
          asset: string
          best_ask_t0: number | null
          best_bid_t0: number | null
          binance_delta: number | null
          binance_price: number | null
          binance_ts: number | null
          created_at: string | null
          decision_latency_ms: number | null
          decision_ts: number | null
          direction: string
          entry_price: number | null
          exit_latency_ms: number | null
          exit_price: number | null
          exit_reason: string | null
          exit_ts: number | null
          exit_type: string | null
          fees: number | null
          fill_latency_ms: number | null
          fill_ts: number | null
          gross_pnl: number | null
          id: string
          market_slug: string | null
          net_pnl: number | null
          order_latency_ms: number | null
          price_at_1s: number | null
          price_at_2s: number | null
          price_at_3s: number | null
          price_at_5s: number | null
          run_id: string
          share_price_t0: number | null
          shares: number | null
          signal_ts: number | null
          skip_reason: string | null
          spread_t0: number | null
          status: string
          strike_price: number | null
        }
        Insert: {
          asset: string
          best_ask_t0?: number | null
          best_bid_t0?: number | null
          binance_delta?: number | null
          binance_price?: number | null
          binance_ts?: number | null
          created_at?: string | null
          decision_latency_ms?: number | null
          decision_ts?: number | null
          direction: string
          entry_price?: number | null
          exit_latency_ms?: number | null
          exit_price?: number | null
          exit_reason?: string | null
          exit_ts?: number | null
          exit_type?: string | null
          fees?: number | null
          fill_latency_ms?: number | null
          fill_ts?: number | null
          gross_pnl?: number | null
          id: string
          market_slug?: string | null
          net_pnl?: number | null
          order_latency_ms?: number | null
          price_at_1s?: number | null
          price_at_2s?: number | null
          price_at_3s?: number | null
          price_at_5s?: number | null
          run_id: string
          share_price_t0?: number | null
          shares?: number | null
          signal_ts?: number | null
          skip_reason?: string | null
          spread_t0?: number | null
          status: string
          strike_price?: number | null
        }
        Update: {
          asset?: string
          best_ask_t0?: number | null
          best_bid_t0?: number | null
          binance_delta?: number | null
          binance_price?: number | null
          binance_ts?: number | null
          created_at?: string | null
          decision_latency_ms?: number | null
          decision_ts?: number | null
          direction?: string
          entry_price?: number | null
          exit_latency_ms?: number | null
          exit_price?: number | null
          exit_reason?: string | null
          exit_ts?: number | null
          exit_type?: string | null
          fees?: number | null
          fill_latency_ms?: number | null
          fill_ts?: number | null
          gross_pnl?: number | null
          id?: string
          market_slug?: string | null
          net_pnl?: number | null
          order_latency_ms?: number | null
          price_at_1s?: number | null
          price_at_2s?: number | null
          price_at_3s?: number | null
          price_at_5s?: number | null
          run_id?: string
          share_price_t0?: number | null
          shares?: number | null
          signal_ts?: number | null
          skip_reason?: string | null
          spread_t0?: number | null
          status?: string
          strike_price?: number | null
        }
        Relationships: []
      }
      v29_ticks: {
        Row: {
          alert_triggered: boolean | null
          asset: string
          binance_delta: number | null
          binance_price: number | null
          chainlink_price: number | null
          created_at: string
          down_best_ask: number | null
          down_best_bid: number | null
          fill_latency_ms: number | null
          fill_price: number | null
          fill_size: number | null
          id: string
          market_slug: string | null
          order_id: string | null
          order_latency_ms: number | null
          order_placed: boolean | null
          post_latency_ms: number | null
          run_id: string | null
          sign_latency_ms: number | null
          signal_direction: string | null
          signal_to_fill_ms: number | null
          strike_price: number | null
          ts: number
          up_best_ask: number | null
          up_best_bid: number | null
          used_cache: boolean | null
        }
        Insert: {
          alert_triggered?: boolean | null
          asset: string
          binance_delta?: number | null
          binance_price?: number | null
          chainlink_price?: number | null
          created_at?: string
          down_best_ask?: number | null
          down_best_bid?: number | null
          fill_latency_ms?: number | null
          fill_price?: number | null
          fill_size?: number | null
          id?: string
          market_slug?: string | null
          order_id?: string | null
          order_latency_ms?: number | null
          order_placed?: boolean | null
          post_latency_ms?: number | null
          run_id?: string | null
          sign_latency_ms?: number | null
          signal_direction?: string | null
          signal_to_fill_ms?: number | null
          strike_price?: number | null
          ts: number
          up_best_ask?: number | null
          up_best_bid?: number | null
          used_cache?: boolean | null
        }
        Update: {
          alert_triggered?: boolean | null
          asset?: string
          binance_delta?: number | null
          binance_price?: number | null
          chainlink_price?: number | null
          created_at?: string
          down_best_ask?: number | null
          down_best_bid?: number | null
          fill_latency_ms?: number | null
          fill_price?: number | null
          fill_size?: number | null
          id?: string
          market_slug?: string | null
          order_id?: string | null
          order_latency_ms?: number | null
          order_placed?: boolean | null
          post_latency_ms?: number | null
          run_id?: string | null
          sign_latency_ms?: number | null
          signal_direction?: string | null
          signal_to_fill_ms?: number | null
          strike_price?: number | null
          ts?: number
          up_best_ask?: number | null
          up_best_bid?: number | null
          used_cache?: boolean | null
        }
        Relationships: []
      }
      v29_ticks_response: {
        Row: {
          asset: string
          binance_delta: number | null
          binance_price: number | null
          created_at: string | null
          down_best_ask: number | null
          down_best_bid: number | null
          id: string
          market_slug: string | null
          run_id: string | null
          signal_direction: string | null
          signal_id: string | null
          signal_triggered: boolean | null
          strike_price: number | null
          ts: number
          up_best_ask: number | null
          up_best_bid: number | null
        }
        Insert: {
          asset: string
          binance_delta?: number | null
          binance_price?: number | null
          created_at?: string | null
          down_best_ask?: number | null
          down_best_bid?: number | null
          id?: string
          market_slug?: string | null
          run_id?: string | null
          signal_direction?: string | null
          signal_id?: string | null
          signal_triggered?: boolean | null
          strike_price?: number | null
          ts: number
          up_best_ask?: number | null
          up_best_bid?: number | null
        }
        Update: {
          asset?: string
          binance_delta?: number | null
          binance_price?: number | null
          created_at?: string | null
          down_best_ask?: number | null
          down_best_bid?: number | null
          id?: string
          market_slug?: string | null
          run_id?: string | null
          signal_direction?: string | null
          signal_id?: string | null
          signal_triggered?: boolean | null
          strike_price?: number | null
          ts?: number
          up_best_ask?: number | null
          up_best_bid?: number | null
        }
        Relationships: []
      }
      v30_config: {
        Row: {
          aggressive_exit_sec: number | null
          assets: string[] | null
          base_theta: number | null
          bet_size_base: number | null
          bet_size_vol_factor: number | null
          created_at: string | null
          enabled: boolean | null
          fair_value_model: string | null
          force_counter_at_pct: number | null
          i_max_base: number | null
          id: string
          max_share_price: number | null
          min_share_price: number | null
          theta_inventory_factor: number | null
          theta_time_decay_factor: number | null
          updated_at: string | null
        }
        Insert: {
          aggressive_exit_sec?: number | null
          assets?: string[] | null
          base_theta?: number | null
          bet_size_base?: number | null
          bet_size_vol_factor?: number | null
          created_at?: string | null
          enabled?: boolean | null
          fair_value_model?: string | null
          force_counter_at_pct?: number | null
          i_max_base?: number | null
          id?: string
          max_share_price?: number | null
          min_share_price?: number | null
          theta_inventory_factor?: number | null
          theta_time_decay_factor?: number | null
          updated_at?: string | null
        }
        Update: {
          aggressive_exit_sec?: number | null
          assets?: string[] | null
          base_theta?: number | null
          bet_size_base?: number | null
          bet_size_vol_factor?: number | null
          created_at?: string | null
          enabled?: boolean | null
          fair_value_model?: string | null
          force_counter_at_pct?: number | null
          i_max_base?: number | null
          id?: string
          max_share_price?: number | null
          min_share_price?: number | null
          theta_inventory_factor?: number | null
          theta_time_decay_factor?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      v30_logs: {
        Row: {
          asset: string | null
          category: string
          created_at: string
          data: Json | null
          id: string
          level: string
          message: string
          run_id: string | null
          ts: number
        }
        Insert: {
          asset?: string | null
          category?: string
          created_at?: string
          data?: Json | null
          id?: string
          level?: string
          message: string
          run_id?: string | null
          ts: number
        }
        Update: {
          asset?: string | null
          category?: string
          created_at?: string
          data?: Json | null
          id?: string
          level?: string
          message?: string
          run_id?: string | null
          ts?: number
        }
        Relationships: []
      }
      v30_positions: {
        Row: {
          asset: string
          avg_entry_price: number | null
          created_at: string | null
          direction: string
          id: string
          market_slug: string
          run_id: string
          shares: number | null
          total_cost: number | null
          updated_at: string | null
        }
        Insert: {
          asset: string
          avg_entry_price?: number | null
          created_at?: string | null
          direction: string
          id?: string
          market_slug: string
          run_id: string
          shares?: number | null
          total_cost?: number | null
          updated_at?: string | null
        }
        Update: {
          asset?: string
          avg_entry_price?: number | null
          created_at?: string | null
          direction?: string
          id?: string
          market_slug?: string
          run_id?: string
          shares?: number | null
          total_cost?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      v30_ticks: {
        Row: {
          action_taken: string | null
          asset: string
          c_price: number | null
          created_at: string | null
          delta_to_strike: number | null
          down_best_ask: number | null
          down_best_bid: number | null
          edge_down: number | null
          edge_up: number | null
          fair_p_up: number | null
          id: string
          inventory_down: number | null
          inventory_net: number | null
          inventory_up: number | null
          market_slug: string | null
          run_id: string | null
          seconds_remaining: number | null
          strike_price: number | null
          theta_current: number | null
          ts: number
          up_best_ask: number | null
          up_best_bid: number | null
          z_price: number | null
        }
        Insert: {
          action_taken?: string | null
          asset: string
          c_price?: number | null
          created_at?: string | null
          delta_to_strike?: number | null
          down_best_ask?: number | null
          down_best_bid?: number | null
          edge_down?: number | null
          edge_up?: number | null
          fair_p_up?: number | null
          id?: string
          inventory_down?: number | null
          inventory_net?: number | null
          inventory_up?: number | null
          market_slug?: string | null
          run_id?: string | null
          seconds_remaining?: number | null
          strike_price?: number | null
          theta_current?: number | null
          ts: number
          up_best_ask?: number | null
          up_best_bid?: number | null
          z_price?: number | null
        }
        Update: {
          action_taken?: string | null
          asset?: string
          c_price?: number | null
          created_at?: string | null
          delta_to_strike?: number | null
          down_best_ask?: number | null
          down_best_bid?: number | null
          edge_down?: number | null
          edge_up?: number | null
          fair_p_up?: number | null
          id?: string
          inventory_down?: number | null
          inventory_net?: number | null
          inventory_up?: number | null
          market_slug?: string | null
          run_id?: string | null
          seconds_remaining?: number | null
          strike_price?: number | null
          theta_current?: number | null
          ts?: number
          up_best_ask?: number | null
          up_best_bid?: number | null
          z_price?: number | null
        }
        Relationships: []
      }
      v35_expiry_snapshots: {
        Row: {
          api_down_cost: number
          api_down_qty: number
          api_up_cost: number
          api_up_qty: number
          asset: string
          avg_down_price: number | null
          avg_up_price: number | null
          combined_ask: number | null
          combined_cost: number | null
          created_at: string
          crossing_count: number | null
          down_best_ask: number | null
          down_best_bid: number | null
          down_orders_count: number | null
          expiry_time: string
          id: string
          imbalance_ratio: number | null
          local_down_cost: number
          local_down_qty: number
          local_up_cost: number
          local_up_qty: number
          locked_profit: number | null
          market_slug: string
          paired: number
          predicted_final_value: number | null
          predicted_pnl: number | null
          predicted_winning_side: string | null
          seconds_before_expiry: number | null
          snapshot_time: string
          spot_price: number | null
          strike_price: number | null
          total_cost: number | null
          unpaired: number
          up_best_ask: number | null
          up_best_bid: number | null
          up_orders_count: number | null
          was_imbalanced: boolean | null
        }
        Insert: {
          api_down_cost?: number
          api_down_qty?: number
          api_up_cost?: number
          api_up_qty?: number
          asset: string
          avg_down_price?: number | null
          avg_up_price?: number | null
          combined_ask?: number | null
          combined_cost?: number | null
          created_at?: string
          crossing_count?: number | null
          down_best_ask?: number | null
          down_best_bid?: number | null
          down_orders_count?: number | null
          expiry_time: string
          id?: string
          imbalance_ratio?: number | null
          local_down_cost?: number
          local_down_qty?: number
          local_up_cost?: number
          local_up_qty?: number
          locked_profit?: number | null
          market_slug: string
          paired?: number
          predicted_final_value?: number | null
          predicted_pnl?: number | null
          predicted_winning_side?: string | null
          seconds_before_expiry?: number | null
          snapshot_time: string
          spot_price?: number | null
          strike_price?: number | null
          total_cost?: number | null
          unpaired?: number
          up_best_ask?: number | null
          up_best_bid?: number | null
          up_orders_count?: number | null
          was_imbalanced?: boolean | null
        }
        Update: {
          api_down_cost?: number
          api_down_qty?: number
          api_up_cost?: number
          api_up_qty?: number
          asset?: string
          avg_down_price?: number | null
          avg_up_price?: number | null
          combined_ask?: number | null
          combined_cost?: number | null
          created_at?: string
          crossing_count?: number | null
          down_best_ask?: number | null
          down_best_bid?: number | null
          down_orders_count?: number | null
          expiry_time?: string
          id?: string
          imbalance_ratio?: number | null
          local_down_cost?: number
          local_down_qty?: number
          local_up_cost?: number
          local_up_qty?: number
          locked_profit?: number | null
          market_slug?: string
          paired?: number
          predicted_final_value?: number | null
          predicted_pnl?: number | null
          predicted_winning_side?: string | null
          seconds_before_expiry?: number | null
          snapshot_time?: string
          spot_price?: number | null
          strike_price?: number | null
          total_cost?: number | null
          unpaired?: number
          up_best_ask?: number | null
          up_best_bid?: number | null
          up_orders_count?: number | null
          was_imbalanced?: boolean | null
        }
        Relationships: []
      }
      v35_fills: {
        Row: {
          asset: string
          created_at: string
          fill_key: string
          fill_ts: string
          fill_type: string | null
          id: string
          market_slug: string
          order_id: string | null
          price: number
          side: string
          size: number
          token_id: string | null
          wallet_address: string | null
        }
        Insert: {
          asset: string
          created_at?: string
          fill_key: string
          fill_ts: string
          fill_type?: string | null
          id?: string
          market_slug: string
          order_id?: string | null
          price: number
          side: string
          size: number
          token_id?: string | null
          wallet_address?: string | null
        }
        Update: {
          asset?: string
          created_at?: string
          fill_key?: string
          fill_ts?: string
          fill_type?: string | null
          id?: string
          market_slug?: string
          order_id?: string | null
          price?: number
          side?: string
          size?: number
          token_id?: string | null
          wallet_address?: string | null
        }
        Relationships: []
      }
      v35_orderbook_snapshots: {
        Row: {
          asset: string
          combined_ask: number | null
          combined_mid: number | null
          created_at: string
          down_asks: Json | null
          down_best_ask: number | null
          down_best_bid: number | null
          down_bids: Json | null
          edge: number | null
          id: string
          market_slug: string
          seconds_to_expiry: number | null
          spot_price: number | null
          strike_price: number | null
          ts: number
          up_asks: Json | null
          up_best_ask: number | null
          up_best_bid: number | null
          up_bids: Json | null
        }
        Insert: {
          asset: string
          combined_ask?: number | null
          combined_mid?: number | null
          created_at?: string
          down_asks?: Json | null
          down_best_ask?: number | null
          down_best_bid?: number | null
          down_bids?: Json | null
          edge?: number | null
          id?: string
          market_slug: string
          seconds_to_expiry?: number | null
          spot_price?: number | null
          strike_price?: number | null
          ts: number
          up_asks?: Json | null
          up_best_ask?: number | null
          up_best_bid?: number | null
          up_bids?: Json | null
        }
        Update: {
          asset?: string
          combined_ask?: number | null
          combined_mid?: number | null
          created_at?: string
          down_asks?: Json | null
          down_best_ask?: number | null
          down_best_bid?: number | null
          down_bids?: Json | null
          edge?: number | null
          id?: string
          market_slug?: string
          seconds_to_expiry?: number | null
          spot_price?: number | null
          strike_price?: number | null
          ts?: number
          up_asks?: Json | null
          up_best_ask?: number | null
          up_best_bid?: number | null
          up_bids?: Json | null
        }
        Relationships: []
      }
      v35_positions: {
        Row: {
          asset: string
          combined_cost: number
          created_at: string
          down_cost: number
          down_qty: number
          id: string
          locked_profit: number
          market_slug: string
          paired: number
          seconds_to_expiry: number | null
          timestamp: string
          unpaired: number
          up_cost: number
          up_qty: number
        }
        Insert: {
          asset: string
          combined_cost?: number
          created_at?: string
          down_cost?: number
          down_qty?: number
          id?: string
          locked_profit?: number
          market_slug: string
          paired?: number
          seconds_to_expiry?: number | null
          timestamp?: string
          unpaired?: number
          up_cost?: number
          up_qty?: number
        }
        Update: {
          asset?: string
          combined_cost?: number
          created_at?: string
          down_cost?: number
          down_qty?: number
          id?: string
          locked_profit?: number
          market_slug?: string
          paired?: number
          seconds_to_expiry?: number | null
          timestamp?: string
          unpaired?: number
          up_cost?: number
          up_qty?: number
        }
        Relationships: []
      }
      v35_settlements: {
        Row: {
          asset: string
          combined_cost: number | null
          created_at: string
          down_cost: number | null
          down_qty: number | null
          id: string
          locked_profit: number | null
          market_slug: string
          paired: number | null
          pnl: number | null
          unpaired: number | null
          up_cost: number | null
          up_qty: number | null
          winning_side: string | null
        }
        Insert: {
          asset: string
          combined_cost?: number | null
          created_at?: string
          down_cost?: number | null
          down_qty?: number | null
          id?: string
          locked_profit?: number | null
          market_slug: string
          paired?: number | null
          pnl?: number | null
          unpaired?: number | null
          up_cost?: number | null
          up_qty?: number | null
          winning_side?: string | null
        }
        Update: {
          asset?: string
          combined_cost?: number | null
          created_at?: string
          down_cost?: number | null
          down_qty?: number | null
          id?: string
          locked_profit?: number | null
          market_slug?: string
          paired?: number | null
          pnl?: number | null
          unpaired?: number | null
          up_cost?: number | null
          up_qty?: number | null
          winning_side?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      v_daily_pnl_cumulative: {
        Row: {
          cumulative_realized_pnl: number | null
          cumulative_total_pnl: number | null
          date: string | null
          markets_active: number | null
          realized_pnl: number | null
          total_pnl: number | null
          unrealized_pnl: number | null
          volume_traded: number | null
          wallet: string | null
        }
        Relationships: []
      }
      v_dashboard_pnl_summary: {
        Row: {
          claimed_markets: number | null
          last_updated: string | null
          lost_markets: number | null
          markets_bought: number | null
          markets_sold: number | null
          open_markets: number | null
          settled_markets: number | null
          total_cost: number | null
          total_markets: number | null
          total_payout: number | null
          total_realized_pnl: number | null
          wallet: string | null
        }
        Relationships: []
      }
      v_market_pnl: {
        Row: {
          avg_down_cost: number | null
          avg_up_cost: number | null
          confidence: string | null
          down_shares: number | null
          has_buy: boolean | null
          has_redeem: boolean | null
          has_sell: boolean | null
          id: string | null
          is_claimed: boolean | null
          is_lost: boolean | null
          market_id: string | null
          market_slug: string | null
          realized_pnl: number | null
          resolved_outcome: string | null
          settlement_ts: string | null
          state: string | null
          total_cost: number | null
          total_payout: number | null
          up_shares: number | null
          updated_at: string | null
          wallet: string | null
        }
        Relationships: []
      }
      v26_stats: {
        Row: {
          filled_trades: number | null
          last_trade_at: string | null
          losses: number | null
          settled_trades: number | null
          total_invested: number | null
          total_pnl: number | null
          total_trades: number | null
          win_rate_pct: number | null
          wins: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      cleanup_old_logs: { Args: never; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
