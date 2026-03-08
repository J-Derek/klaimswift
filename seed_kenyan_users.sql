-- Insert mock members
INSERT INTO members (id, phone, name, national_id, kra_pin, policy_number, mpesa_phone, registration_status, verified_at)
VALUES 
  (gen_random_uuid(), '254700000001', 'Maina Mwangi', '11223344', 'A123456789B', 'POL-1001', '254700000001', 'verified', now()),
  (gen_random_uuid(), '254711111111', 'Akinyi Ochieng', '22334455', 'A987654321C', 'POL-1002', '254711111111', 'verified', now());

-- Insert mock claims (using subqueries to grab the auto-generated UUIDs of the members above)
INSERT INTO claims (claim_id, member_id, channel, type, description, facility_name, amount_kes, status, ai_score, ai_verdict, document_urls, timeline)
VALUES 
  ('CLM-100001-1', (SELECT id FROM members WHERE phone='254700000001'), 'WhatsApp', 'outpatient', 'Consultation for malaria', 'Aga Khan Hospital', 4500, 'pending', 92, 'Approve - High Confidence. Routine outpatient consultation matching policy limits.', ARRAY['https://example.com/receipt1.pdf'], '[{"event": "Claim Filed", "actor": "Maina Mwangi", "timestamp": "' || now() || '"}]'::jsonb),
  ('CLM-100001-2', (SELECT id FROM members WHERE phone='254711111111'), 'WhatsApp', 'pharmacy', 'Prescription medication', 'Goodlife Pharmacy', 1200, 'adjuster_review', 65, 'Manual Review - Handwriting unclear on prescription receipt.', ARRAY['https://example.com/receipt2.pdf'], '[{"event": "Claim Filed", "actor": "Akinyi Ochieng", "timestamp": "' || now() || '"}]'::jsonb);
