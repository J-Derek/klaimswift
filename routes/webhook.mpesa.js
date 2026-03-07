/**
 * M-Pesa Daraja Webhook Routes
 * POST /webhook/mpesa/result  — B2C payment result callback
 * POST /webhook/mpesa/timeout — B2C timeout callback
 */

const express = require('express');
const router = express.Router();
const { db, admin } = require('../firebase-config');
const wa = require('../services/whatsappService');

const FieldValue = admin.firestore.FieldValue;

/**
 * POST /webhook/mpesa/result — Daraja B2C result callback
 */
router.post('/result', async (req, res) => {
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

    try {
        const result = req.body?.Result;
        if (!result) return;

        const conversationId = result.ConversationID;
        const resultCode = result.ResultCode;
        const transactionId = result.TransactionID;

        console.log(`[M-Pesa] Result: ConvID=${conversationId}, Code=${resultCode}, TxID=${transactionId}`);

        // Find the pending transaction
        const txSnap = await db.collection('mpesa_transactions')
            .where('conversationId', '==', conversationId)
            .limit(1)
            .get();

        if (txSnap.empty) {
            console.error(`[M-Pesa] No transaction found for ConvID: ${conversationId}`);
            return;
        }

        const txDoc = txSnap.docs[0];
        const txData = txDoc.data();

        if (resultCode === 0) {
            // ── SUCCESS ──
            // Parse result parameters
            const params = {};
            if (result.ResultParameters?.ResultParameter) {
                for (const p of result.ResultParameters.ResultParameter) {
                    params[p.Key] = p.Value;
                }
            }

            // Update transaction record
            await txDoc.ref.update({
                status: 'completed',
                transactionId,
                resultCode,
                resultDesc: result.ResultDesc,
                completedAt: FieldValue.serverTimestamp(),
                resultParams: params,
            });

            // Update claim status → paid
            if (txData.claimId) {
                await db.collection('claims').doc(txData.claimId).update({
                    status: 'paid',
                    mpesaTransactionId: transactionId,
                    updatedAt: FieldValue.serverTimestamp(),
                    timeline: FieldValue.arrayUnion({
                        event: 'M-Pesa Payout Confirmed',
                        timestamp: new Date().toISOString(),
                        actor: 'system',
                        note: `TX: ${transactionId}`,
                    }),
                });
            }

            // Send WhatsApp confirmation to customer
            if (txData.phone) {
                try {
                    await wa.sendTemplate(txData.phone, 'mpesa_sent', [{
                        type: 'body',
                        parameters: [
                            { type: 'text', text: String(txData.amount) },
                            { type: 'text', text: txData.phone },
                            { type: 'text', text: transactionId },
                            { type: 'text', text: txData.claimId || '' },
                        ],
                    }]);
                } catch {
                    await wa.sendText(txData.phone,
                        `✅ *M-Pesa Sent!*\nKES ${txData.amount?.toLocaleString()} → ${txData.phone}\n` +
                        `Confirmation: ${transactionId}\nClaim: ${txData.claimId}`
                    );
                }
            }

            // Write blockchain event
            try {
                const blockchain = require('../services/blockchainService');
                await blockchain.writeAuditEvent({
                    eventType: 'MPESA_PAYOUT_CONFIRMED',
                    claimId: txData.claimId,
                    actorId: 'daraja',
                    actorType: 'system',
                    data: { transactionId, amount: txData.amount },
                    timestamp: new Date().toISOString(),
                });
            } catch { }

        } else {
            // ── FAILURE ──
            await txDoc.ref.update({
                status: 'failed',
                resultCode,
                resultDesc: result.ResultDesc,
                failedAt: FieldValue.serverTimestamp(),
            });

            // Revert claim to approved (not paid)
            if (txData.claimId) {
                await db.collection('claims').doc(txData.claimId).update({
                    status: 'approved',
                    updatedAt: FieldValue.serverTimestamp(),
                    timeline: FieldValue.arrayUnion({
                        event: 'M-Pesa Payout Failed',
                        timestamp: new Date().toISOString(),
                        actor: 'system',
                        note: result.ResultDesc,
                    }),
                });
            }

            // Notify admin via Realtime DB
            const { rtdb } = require('../firebase-config');
            await rtdb.ref('notifications/mpesa_failures').push({
                claimId: txData.claimId,
                amount: txData.amount,
                error: result.ResultDesc,
                timestamp: new Date().toISOString(),
            });
        }
    } catch (err) {
        console.error('[M-Pesa] Result processing error:', err);
    }
});

/**
 * POST /webhook/mpesa/timeout — Daraja B2C timeout
 */
router.post('/timeout', async (req, res) => {
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

    try {
        console.warn('[M-Pesa] Timeout callback received:', JSON.stringify(req.body));

        // Mark transaction as timed out
        const result = req.body?.Result;
        if (result?.ConversationID) {
            const snap = await db.collection('mpesa_transactions')
                .where('conversationId', '==', result.ConversationID)
                .limit(1)
                .get();

            if (!snap.empty) {
                const txDoc = snap.docs[0];
                await txDoc.ref.update({
                    status: 'timeout',
                    timedOutAt: FieldValue.serverTimestamp(),
                });

                // Revert claim status
                if (txDoc.data().claimId) {
                    await db.collection('claims').doc(txDoc.data().claimId).update({
                        status: 'approved',
                        updatedAt: FieldValue.serverTimestamp(),
                    });
                }
            }
        }
    } catch (err) {
        console.error('[M-Pesa] Timeout processing error:', err);
    }
});

module.exports = router;
