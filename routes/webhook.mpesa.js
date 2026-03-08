/**
 * M-Pesa Daraja Webhook Routes — Supabase Version
 */

const express = require('express');
const router = express.Router();
const { supabase } = require('../supabase-config');
const wa = require('../services/whatsappService');

router.post('/result', async (req, res) => {
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

    try {
        const result = req.body?.Result;
        if (!result) return;

        const conversationId = result.ConversationID;
        const resultCode = result.ResultCode;
        const transactionId = result.TransactionID;

        const { data: txDoc } = await supabase
            .from('mpesa_transactions')
            .select('*')
            .eq('conversation_id', conversationId)
            .limit(1)
            .single();

        if (!txDoc) {
            console.error(`[M-Pesa] No transaction found for ConvID: ${conversationId}`);
            return;
        }

        if (resultCode === 0) {
            // SUCCESS
            await supabase.from('mpesa_transactions').update({
                status: 'completed',
                transaction_id: transactionId,
                result_desc: result.ResultDesc,
                completed_at: new Date().toISOString(),
            }).eq('id', txDoc.id);

            // Update claim status → paid
            if (txDoc.claim_id) {
                const { data: claim } = await supabase.from('claims').select('timeline').eq('claim_id', txDoc.claim_id).single();

                await supabase.from('claims').update({
                    status: 'paid',
                    updated_at: new Date().toISOString(),
                    timeline: [...(claim?.timeline || []), {
                        event: 'M-Pesa Payout Confirmed',
                        timestamp: new Date().toISOString(),
                        actor: 'system',
                        note: `TX: ${transactionId}`,
                    }],
                }).eq('claim_id', txDoc.claim_id);
            }

            // WhatsApp confirmation
            if (txDoc.phone) {
                try {
                    await wa.sendTemplate(txDoc.phone, 'mpesa_sent', [{
                        type: 'body',
                        parameters: [
                            { type: 'text', text: String(txDoc.amount) },
                            { type: 'text', text: txDoc.phone },
                            { type: 'text', text: transactionId },
                            { type: 'text', text: txDoc.claim_id || '' },
                        ],
                    }]);
                } catch {
                    await wa.sendText(txDoc.phone,
                        `✅ *M-Pesa Sent!*\nKES ${txDoc.amount?.toLocaleString()} → ${txDoc.phone}\n` +
                        `Confirmation: ${transactionId}\nClaim: ${txDoc.claim_id}`
                    );
                }
            }

            // Blockchain
            try {
                const blockchain = require('../services/blockchainService');
                await blockchain.writeAuditEvent({
                    eventType: 'MPESA_PAYOUT_CONFIRMED',
                    claimId: txDoc.claim_id,
                    actorId: 'daraja',
                    actorType: 'system',
                    data: { transactionId, amount: txDoc.amount },
                    timestamp: new Date().toISOString(),
                });
            } catch { }

        } else {
            // FAILURE
            await supabase.from('mpesa_transactions').update({
                status: 'failed',
                result_desc: result.ResultDesc,
            }).eq('id', txDoc.id);

            // Revert claim
            if (txDoc.claim_id) {
                const { data: claim } = await supabase.from('claims').select('timeline').eq('claim_id', txDoc.claim_id).single();
                await supabase.from('claims').update({
                    status: 'approved',
                    updated_at: new Date().toISOString(),
                    timeline: [...(claim?.timeline || []), {
                        event: 'M-Pesa Payout Failed',
                        timestamp: new Date().toISOString(),
                        actor: 'system',
                        note: result.ResultDesc,
                    }],
                }).eq('claim_id', txDoc.claim_id);
            }
        }
    } catch (err) {
        console.error('[M-Pesa] Result processing error:', err);
    }
});

router.post('/timeout', async (req, res) => {
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

    try {
        const result = req.body?.Result;
        if (result?.ConversationID) {
            const { data: txDoc } = await supabase
                .from('mpesa_transactions')
                .select('*')
                .eq('conversation_id', result.ConversationID)
                .limit(1)
                .single();

            if (txDoc) {
                await supabase.from('mpesa_transactions').update({
                    status: 'timeout',
                }).eq('id', txDoc.id);

                if (txDoc.claim_id) {
                    await supabase.from('claims').update({
                        status: 'approved',
                        updated_at: new Date().toISOString(),
                    }).eq('claim_id', txDoc.claim_id);
                }
            }
        }
    } catch (err) {
        console.error('[M-Pesa] Timeout processing error:', err);
    }
});

module.exports = router;
