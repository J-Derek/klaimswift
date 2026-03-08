-- KlaimSwift Supabase Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)

-- Members table
CREATE TABLE IF NOT EXISTS members (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    policy_number TEXT UNIQUE NOT NULL,
    name TEXT,
    phone TEXT,
    national_id TEXT,
    mpesa_phone TEXT,
    insurance_type TEXT,
    status TEXT DEFAULT 'active',
    claims_count INT DEFAULT 0,
    registered_at TIMESTAMPTZ DEFAULT NOW()
);

-- Claims table
CREATE TABLE IF NOT EXISTS claims (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    claim_id TEXT UNIQUE NOT NULL,
    member_id UUID REFERENCES members(id),
    type TEXT,
    amount_kes NUMERIC DEFAULT 0,
    incident_date TEXT,
    description TEXT,
    status TEXT DEFAULT 'pending',
    channel TEXT DEFAULT 'WhatsApp',
    ai_score INT,
    ai_verdict TEXT,
    documents JSONB DEFAULT '[]'::jsonb,
    timeline JSONB DEFAULT '[]'::jsonb,
    filed_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Conversations (bot state)
CREATE TABLE IF NOT EXISTS conversations (
    phone TEXT PRIMARY KEY,
    state TEXT DEFAULT 'verify',
    member_id UUID REFERENCES members(id),
    member_name TEXT,
    draft JSONB DEFAULT '{}'::jsonb,
    needs_agent BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Blockchain events (append-only audit trail)
CREATE TABLE IF NOT EXISTS blockchain_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    block_number SERIAL,
    event_type TEXT NOT NULL,
    claim_id TEXT,
    actor_id TEXT,
    actor_type TEXT,
    data JSONB DEFAULT '{}'::jsonb,
    previous_hash TEXT NOT NULL,
    event_hash TEXT NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- M-Pesa transactions
CREATE TABLE IF NOT EXISTS mpesa_transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    claim_id TEXT,
    conversation_id TEXT,
    amount NUMERIC DEFAULT 0,
    phone TEXT,
    status TEXT DEFAULT 'pending',
    transaction_id TEXT,
    result_desc TEXT,
    initiated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_claims_member ON claims(member_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_verdict ON claims(ai_verdict);
CREATE INDEX IF NOT EXISTS idx_blockchain_claim ON blockchain_events(claim_id);
CREATE INDEX IF NOT EXISTS idx_blockchain_block ON blockchain_events(block_number);
CREATE INDEX IF NOT EXISTS idx_mpesa_claim ON mpesa_transactions(claim_id);
CREATE INDEX IF NOT EXISTS idx_members_policy ON members(policy_number);

-- Enable Row Level Security (but allow service role full access)
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE blockchain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpesa_transactions ENABLE ROW LEVEL SECURITY;

-- Policies: service_role bypasses RLS automatically
-- Anon/authenticated users: read-only on claims for dashboard
CREATE POLICY "Allow authenticated read on claims" ON claims FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read on members" ON members FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read on mpesa_transactions" ON mpesa_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read on blockchain_events" ON blockchain_events FOR SELECT TO authenticated USING (true);

-- Blockchain: no updates or deletes (append-only)
CREATE POLICY "Blockchain append only" ON blockchain_events FOR INSERT TO authenticated WITH CHECK (true);
