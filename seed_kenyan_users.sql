-- 1. Insert mock Kenyan members 
INSERT INTO members (phone, name, national_id, policy_number, mpesa_phone, status, insurance_type)
VALUES 
  ('254700000001', 'Maina Mwangi', '11223344', 'POL-1001', '254700000001', 'active', 'Comprehensive'),
  ('254711111111', 'Akinyi Ochieng', '22334455', 'POL-1002', '254711111111', 'active', 'Third Party');

-- 2. Insert mock claims mapped to the numbers above
INSERT INTO claims (claim_id, member_id, channel, type, description, amount_kes, status, ai_score, ai_verdict, timeline)
VALUES 
  ('CLM-100001-1', (SELECT id FROM members WHERE phone='254700000001'), 'WhatsApp', 'outpatient', 'Consultation for malaria', 4500, 'pending', 92, 'Approve - High Confidence.', '[{"event": "Claim Filed", "actor": "Maina Mwangi"}]'::jsonb),
  ('CLM-100001-2', (SELECT id FROM members WHERE phone='254711111111'), 'WhatsApp', 'pharmacy', 'Prescription medication', 1200, 'adjuster_review', 65, 'Manual Review Required.', '[{"event": "Claim Filed", "actor": "Akinyi Ochieng"}]'::jsonb);
