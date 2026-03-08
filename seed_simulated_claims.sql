-- Run this in the Supabase SQL Editor to generate 1 simulated claim for EVERY member in your database!

INSERT INTO claims (
    claim_id,
    member_id, 
    type, 
    amount_kes, 
    status, 
    ai_score, 
    ai_verdict, 
    description,
    documents
)
SELECT 
    'CLM-' || substr(md5(random()::text), 1, 6),
    id,
    CASE WHEN (random() > 0.5) THEN 'accidental' ELSE 'windscreen' END,
    (random() * 40000 + 10000)::int,
    'pending',
    (random() * 40 + 50)::int,
    'AI detected structural impact aligning with user description. Geo-metadata and timestamps verified.',
    'Incident reported: minor fender bender during rush hour traffic.',
    '["https://images.unsplash.com/photo-1605300067645-fed4e97a151b?auto=format&fit=crop&w=400&q=80"]'::jsonb
FROM members;
