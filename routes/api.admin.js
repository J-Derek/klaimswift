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

// ─── Add Member ───────────────────────────────────────────────

router.post('/add-member', async (req, res) => {
    try {
        const { name, phone, national_id, mpesa_phone, policy_number, insurance_type } = req.body;

        if (!name || !phone || !policy_number) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Add 254 prefix logic if missing (basic sanitization)
        let cleanPhone = phone.replace(/[^0-9]/g, '');
        if (cleanPhone.startsWith('0')) cleanPhone = '254' + cleanPhone.substring(1);
        if (cleanPhone.startsWith('+')) cleanPhone = cleanPhone.substring(1);

        let cleanMpesa = mpesa_phone ? mpesa_phone.replace(/[^0-9]/g, '') : cleanPhone;
        if (cleanMpesa.startsWith('0')) cleanMpesa = '254' + cleanMpesa.substring(1);
        if (cleanMpesa.startsWith('+')) cleanMpesa = cleanMpesa.substring(1);

        const { data, error } = await supabase.from('members').insert({
            name,
            phone: cleanPhone,
            national_id,
            mpesa_phone: cleanMpesa,
            policy_number,
            insurance_type,
            status: 'active'
        }).select();

        if (error) {
            // Check for unique constraint violation on policy_number
            if (error.code === '23505') {
                return res.status(400).json({ error: 'A member with this Policy Number or Phone already exists' });
            }
            throw error;
        }

        res.json({ success: true, member: data[0] });
    } catch (err) {
        console.error('[Admin] Add member error:', err);
        res.status(500).json({ error: 'Internal server error while adding member' });
    }
});

module.exports = router;
