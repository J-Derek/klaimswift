-- ────────────────────────────────────────────────────────────────────────────
-- KlaimSwift — Seed Members (Run in Supabase SQL Editor)
-- Policy Format: KEN-YYYY-TYPE-NNNNNN
--   Types: MTR=Motor, MED=Medical, PRO=Property, LIF=Life Insurance
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO members (phone, name, national_id, policy_number, mpesa_phone, status, insurance_type)
VALUES
  -- Motor Vehicle Members
  ('+254712345001', 'Amina Wanjiku Odhiambo',   '12345001', 'KEN-2025-MTR-100001', '0712345001', 'active',   'Motor Vehicle'),
  ('+254712345002', 'Brian Otieno Mwangi',       '12345002', 'KEN-2025-MTR-100002', '0712345002', 'active',   'Motor Vehicle'),
  ('+254712345003', 'Christine Akinyi Kamau',    '12345003', 'KEN-2025-MTR-100003', '0712345003', 'active',   'Motor Vehicle'),
  ('+254712345004', 'David Kipchoge Rotich',     '12345004', 'KEN-2024-MTR-100004', '0712345004', 'active',   'Motor Vehicle'),
  ('+254712345005', 'Esther Wambui Njoroge',     '12345005', 'KEN-2024-MTR-100005', '0712345005', 'suspended','Motor Vehicle'),

  -- Medical Members
  ('+254712345006', 'Francis Mutua Kioko',       '12345006', 'KEN-2025-MED-200001', '0712345006', 'active',   'Medical'),
  ('+254712345007', 'Grace Moraa Nyamweya',      '12345007', 'KEN-2025-MED-200002', '0712345007', 'active',   'Medical'),
  ('+254712345008', 'Hassan Abdi Farah',         '12345008', 'KEN-2025-MED-200003', '0712345008', 'active',   'Medical'),
  ('+254712345009', 'Irene Chebet Bett',         '12345009', 'KEN-2024-MED-200004', '0712345009', 'active',   'Medical'),
  ('+254712345010', 'John Kariuki Gacheru',      '12345010', 'KEN-2024-MED-200005', '0712345010', 'active',   'Medical'),

  -- Property Members
  ('+254712345011', 'Kathambi Mumbi Ndegwa',     '12345011', 'KEN-2025-PRO-300001', '0712345011', 'active',   'Property'),
  ('+254712345012', 'Leonard Ochieng Onyango',   '12345012', 'KEN-2025-PRO-300002', '0712345012', 'active',   'Property'),
  ('+254712345013', 'Mary Njeri Githinji',       '12345013', 'KEN-2025-PRO-300003', '0712345013', 'active',   'Property'),
  ('+254712345014', 'Ndirangu Mwaura Kamande',   '12345014', 'KEN-2024-PRO-300004', '0712345014', 'suspended','Property'),
  ('+254712345015', 'Olive Atieno Odero',        '12345015', 'KEN-2024-PRO-300005', '0712345015', 'active',   'Property'),

  -- Life Insurance Members
  ('+254712345016', 'Peter Muthomi Murithi',     '12345016', 'KEN-2025-LIF-400001', '0712345016', 'active',   'Life Insurance'),
  ('+254712345017', 'Queen Wanjiru Thuku',       '12345017', 'KEN-2025-LIF-400002', '0712345017', 'active',   'Life Insurance'),
  ('+254712345018', 'Robert Barasa Wafula',      '12345018', 'KEN-2025-LIF-400003', '0712345018', 'active',   'Life Insurance'),
  ('+254712345019', 'Sylvia Chelangat Koech',    '12345019', 'KEN-2024-LIF-400004', '0712345019', 'active',   'Life Insurance'),
  ('+254712345020', 'Thomas Kamau Wachira',      '12345020', 'KEN-2024-LIF-400005', '0712345020', 'active',   'Life Insurance')
ON CONFLICT (policy_number) DO NOTHING;

-- ─── Quick reference for WhatsApp testing ───────────────────────────────────
-- Active: KEN-2025-MTR-100001 → Amina Wanjiku Odhiambo
-- Active: KEN-2025-MED-200001 → Francis Mutua Kioko
-- Active: KEN-2025-PRO-300001 → Kathambi Mumbi Ndegwa
-- Active: KEN-2025-LIF-400001 → Peter Muthomi Murithi
-- Suspended (should be blocked): KEN-2025-MTR-100005, KEN-2024-PRO-300004
-- ────────────────────────────────────────────────────────────────────────────
