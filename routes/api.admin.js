/**
 * Admin API Routes (Protected — Supabase Auth required)
 */

const express = require('express');
const router = express.Router();
const { supabase } = require('../supabase-config');
const wa = require('../services/whatsappService');
const { decryptPII, encryptPII } = require('../services/encryptionService');

// ─── Auth Middleware ─────────────────────────────────────────────

async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        const token = authHeader.split('Bearer ')[1];
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        req.adminUser = user;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

router.use(requireAuth);

// ─── Approve Claim ───────────────────────────────────────────────

router.post('/approve-claim', async (req, res) => {
    try {
        const { claimId } = req.body;
        if (!claimId) return res.status(400).json({ error: 'claimId required' });

        const { data: claim, error: claimErr } = await supabase
            .from('claims')
            .select('*')
            .eq('claim_id', claimId)
            .single();

        if (claimErr || !claim) return res.status(404).json({ error: 'Claim not found' });
        if (claim.status === 'paid') return res.status(400).json({ error: 'Claim already paid' });

        const adminName = req.adminUser.email || 'Admin';

        // Step 1: Update claim status → approved
        const newTimelineEvent = {
            event: 'Approved',
            timestamp: new Date().toISOString(),
            actor: adminName,
            note: `Approved by ${adminName}`,
        };

        await supabase.from('claims').update({
            status: 'approved',
            updated_at: new Date().toISOString(),
            timeline: [...(claim.timeline || []), newTimelineEvent],
        }).eq('claim_id', claimId);

        // Step 2: Initiate M-Pesa payout
        try {
            const mpesa = require('../services/mpesaService');

            const { data: member } = await supabase.from('members').select('*').eq('id', claim.member_id).single();
            const payoutPhone = member?.mpesa_phone || member?.phone;

            if (payoutPhone && claim.amount_kes) {
                const payoutResult = await mpesa.initiateB2CPayout({
                    phone: payoutPhone,
                    amount: claim.amount_kes,
                    claimId,
                    remarks: `KlaimSwift Payout - ${claimId}`,
                });

                // Step 3: Create mpesa_transactions record
                await supabase.from('mpesa_transactions').insert({
                    claim_id: claimId,
                    conversation_id: payoutResult.ConversationID,
                    amount: claim.amount_kes,
                    phone: payoutPhone,
                    status: 'pending',
                });

                // Step 4: Update claim status
                await supabase.from('claims').update({
                    status: 'payout_initiated',
                    updated_at: new Date().toISOString(),
                }).eq('claim_id', claimId);
            }
        } catch (err) {
            console.error('[Admin] M-Pesa payout error:', err);
        }

        // Step 5: Send WhatsApp notification
        if (claim.member_id) {
            const { data: conv } = await supabase.from('conversations').select('phone').eq('member_id', claim.member_id).limit(1).single();

            if (conv) {
                const phone = conv.phone;
                const { data: member } = await supabase.from('members').select('*').eq('id', claim.member_id).single();

                try {
                    await wa.sendTemplate(phone, 'claim_approved', [{
                        type: 'body',
                        parameters: [
                            { type: 'text', text: member?.name || 'Customer' },
                            { type: 'text', text: claimId },
                            { type: 'text', text: String(claim.amount_kes) },
                            { type: 'text', text: member?.mpesa_phone || member?.phone || '' },
                        ],
                    }]);
                } catch {
                    await wa.sendText(phone,
                        `✅ Great news! Claim *${claimId}* has been *APPROVED*.\n` +
                        `KES ${claim.amount_kes?.toLocaleString()} will be sent to your M-Pesa shortly.`
                    );
                }
            }
        }

        // Step 6: Write blockchain event
        try {
            const blockchain = require('../services/blockchainService');
            await blockchain.writeAuditEvent({
                eventType: 'CLAIM_APPROVED',
                claimId,
                actorId: req.adminUser.id,
                actorType: 'admin',
                data: { approverName: adminName, amount: claim.amount_kes },
                timestamp: new Date().toISOString(),
            });
        } catch { }

        res.json({ success: true, claimId, status: 'approved' });

    } catch (err) {
        console.error('[Admin] Approve claim error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── Reject Claim ────────────────────────────────────────────────

router.post('/reject-claim', async (req, res) => {
    try {
        const { claimId, reason } = req.body;
        if (!claimId || !reason) return res.status(400).json({ error: 'claimId and reason required' });

        const { data: claim, error: claimErr } = await supabase
            .from('claims')
            .select('*')
            .eq('claim_id', claimId)
            .single();

        if (claimErr || !claim) return res.status(404).json({ error: 'Claim not found' });

        const adminName = req.adminUser.email || 'Admin';

        // Update claim
        await supabase.from('claims').update({
            status: 'rejected',
            updated_at: new Date().toISOString(),
            timeline: [...(claim.timeline || []), {
                event: 'Rejected',
                timestamp: new Date().toISOString(),
                actor: adminName,
                note: reason,
            }],
        }).eq('claim_id', claimId);

        // Send WhatsApp rejection
        if (claim.member_id) {
            const { data: conv } = await supabase.from('conversations').select('phone').eq('member_id', claim.member_id).limit(1).single();

            if (conv) {
                const phone = conv.phone;
                const { data: member } = await supabase.from('members').select('*').eq('id', claim.member_id).single();

                try {
                    await wa.sendTemplate(phone, 'claim_rejected', [{
                        type: 'body',
                        parameters: [
                            { type: 'text', text: member?.name || 'Customer' },
                            { type: 'text', text: claimId },
                            { type: 'text', text: reason },
                        ],
                    }]);
                } catch {
                    await wa.sendText(phone,
                        `❌ We're sorry. Claim *${claimId}* could not be approved.\n` +
                        `Reason: ${reason}\n\n` +
                        `For help: 0800 724 724 or reply to this message.`
                    );
                }
            }
        }

        // Blockchain event
        try {
            const blockchain = require('../services/blockchainService');
            await blockchain.writeAuditEvent({
                eventType: 'CLAIM_REJECTED',
                claimId,
                actorId: req.adminUser.id,
                actorType: 'admin',
                data: { reason },
                timestamp: new Date().toISOString(),
            });
        } catch { }

        res.json({ success: true, claimId, status: 'rejected' });

    } catch (err) {
        console.error('[Admin] Reject claim error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── Seed Mock Data ───────────────────────────────────────────────

router.post('/seed-mock', async (req, res) => {
    try {
        const mockMembers = [
            {
                phone: '254700000001',
                name: 'Maina Mwangi',
                national_id: '11223344',
                kra_pin: 'A123456789B',
                policy_number: 'POL-1001',
                mpesa_phone: '254700000001',
                registration_status: 'verified',
                verified_at: new Date().toISOString()
            },
            {
                phone: '254711111111',
                name: 'Akinyi Ochieng',
                national_id: '22334455',
                kra_pin: 'A987654321C',
                policy_number: 'POL-1002',
                mpesa_phone: '254711111111',
                registration_status: 'verified',
                verified_at: new Date().toISOString()
            }
        ];

        for (const member of mockMembers) {
            const { data } = await supabase.from('members').select('id').eq('phone', member.phone);
            if (!data || data.length === 0) {
                await supabase.from('members').insert(member);
            }
        }

        const { data: membersInDb } = await supabase.from('members').select('id, phone');
        const maina = membersInDb.find(m => m.phone === '254700000001');
        const akinyi = membersInDb.find(m => m.phone === '254711111111');

        if (!maina || !akinyi) {
            return res.status(500).json({ error: 'Failed to retrieve seeded members' });
        }

        const mockClaims = [
            {
                claim_id: 'CLM-' + Date.now().toString().slice(-6) + '-1',
                member_id: maina.id,
                channel: 'WhatsApp',
                type: 'outpatient',
                description: 'Consultation for malaria',
                facility_name: 'Aga Khan Hospital',
                amount_kes: 4500,
                status: 'pending',
                ai_score: 92,
                ai_verdict: 'Approve - High Confidence. Routine outpatient consultation matching policy limits.',
                document_urls: ['https://example.com/receipt1.pdf'],
                timeline: [{ event: 'Claim Filed', actor: 'Maina Mwangi', timestamp: new Date().toISOString() }]
            },
            {
                claim_id: 'CLM-' + Date.now().toString().slice(-6) + '-2',
                member_id: akinyi.id,
                channel: 'WhatsApp',
                type: 'pharmacy',
                description: 'Prescription medication',
                facility_name: 'Goodlife Pharmacy',
                amount_kes: 1200,
                status: 'adjuster_review',
                ai_score: 65,
                ai_verdict: 'Manual Review - Handwriting unclear on prescription receipt.',
                document_urls: ['https://example.com/receipt2.pdf'],
                timeline: [{ event: 'Claim Filed', actor: 'Akinyi Ochieng', timestamp: new Date().toISOString() }]
            }
        ];

        await supabase.from('claims').insert(mockClaims);

        res.json({ success: true });
    } catch (err) {
        console.error('[Admin] Seed mock error:', err);
        res.status(500).json({ error: 'Internal server error while seeding' });
    }
});

module.exports = router;
