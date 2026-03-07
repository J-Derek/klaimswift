/**
 * Admin API Routes (Protected — Firebase Auth required)
 * POST /api/admin/approve-claim
 * POST /api/admin/reject-claim
 * GET  /api/member/data-export
 * DELETE /api/member/data-delete
 */

const express = require('express');
const router = express.Router();
const { db, auth, admin } = require('../firebase-config');
const wa = require('../services/whatsappService');
const { decryptPII, encryptPII } = require('../services/encryptionService');

const FieldValue = admin.firestore.FieldValue;

// ─── Auth Middleware ─────────────────────────────────────────────

/**
 * Firebase Auth middleware — verifies ID token from Authorization header
 */
async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        const token = authHeader.split('Bearer ')[1];
        const decoded = await auth.verifyIdToken(token);
        req.adminUser = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// Apply auth to all routes
router.use(requireAuth);

// ─── Approve Claim ───────────────────────────────────────────────

/**
 * POST /api/admin/approve-claim
 * Body: { claimId }
 * Triggers: status update → M-Pesa payout → WhatsApp notification → blockchain
 */
router.post('/approve-claim', async (req, res) => {
    try {
        const { claimId } = req.body;
        if (!claimId) return res.status(400).json({ error: 'claimId required' });

        const claimRef = db.collection('claims').doc(claimId);
        const claimSnap = await claimRef.get();
        if (!claimSnap.exists) return res.status(404).json({ error: 'Claim not found' });

        const claim = claimSnap.data();
        if (claim.status === 'paid') return res.status(400).json({ error: 'Claim already paid' });

        const adminName = req.adminUser.name || req.adminUser.email || 'Admin';

        // Step 1: Update claim status → approved
        await claimRef.update({
            status: 'approved',
            updatedAt: FieldValue.serverTimestamp(),
            timeline: FieldValue.arrayUnion({
                event: 'Approved',
                timestamp: new Date().toISOString(),
                actor: adminName,
                note: `Approved by ${adminName}`,
            }),
        });

        // Step 2: Initiate M-Pesa payout
        try {
            const mpesa = require('../services/mpesaService');
            // Get member phone for payout
            const memberSnap = await db.collection('members').doc(claim.memberId).get();
            const member = memberSnap.exists ? decryptPII(memberSnap.data()) : null;
            const payoutPhone = member?.mpesaPhone || member?.phone;

            if (payoutPhone && claim.amountKES) {
                const payoutResult = await mpesa.initiateB2CPayout({
                    phone: payoutPhone,
                    amount: claim.amountKES,
                    claimId,
                    remarks: `KlaimSwift Payout - ${claimId}`,
                });

                // Step 3: Create mpesa_transactions record
                await db.collection('mpesa_transactions').add({
                    claimId,
                    memberId: claim.memberId,
                    phone: payoutPhone,
                    amount: claim.amountKES,
                    conversationId: payoutResult.ConversationID,
                    originatorConversationId: payoutResult.OriginatorConversationID,
                    status: 'pending',
                    initiatedAt: FieldValue.serverTimestamp(),
                });

                // Step 4: Update claim status → payout_initiated
                await claimRef.update({
                    status: 'payout_initiated',
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }
        } catch (err) {
            console.error('[Admin] M-Pesa payout error:', err);
            // Payout failed but claim is still approved
        }

        // Step 5: Send WhatsApp notification
        if (claim.memberId) {
            const convSnap = await db.collection('conversations')
                .where('memberId', '==', claim.memberId)
                .limit(1)
                .get();

            if (!convSnap.empty) {
                const phone = convSnap.docs[0].id;
                const memberSnap = await db.collection('members').doc(claim.memberId).get();
                const member = memberSnap.exists ? decryptPII(memberSnap.data()) : {};

                try {
                    await wa.sendTemplate(phone, 'claim_approved', [{
                        type: 'body',
                        parameters: [
                            { type: 'text', text: member.name || 'Customer' },
                            { type: 'text', text: claimId },
                            { type: 'text', text: String(claim.amountKES) },
                            { type: 'text', text: member.mpesaPhone || member.phone || '' },
                        ],
                    }]);
                } catch {
                    await wa.sendText(phone,
                        `✅ Great news! Claim *${claimId}* has been *APPROVED*.\n` +
                        `KES ${claim.amountKES?.toLocaleString()} will be sent to your M-Pesa shortly.`
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
                actorId: req.adminUser.uid,
                actorType: 'admin',
                data: { approverName: adminName, amount: claim.amountKES },
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

/**
 * POST /api/admin/reject-claim
 * Body: { claimId, reason }
 */
router.post('/reject-claim', async (req, res) => {
    try {
        const { claimId, reason } = req.body;
        if (!claimId || !reason) return res.status(400).json({ error: 'claimId and reason required' });

        const claimRef = db.collection('claims').doc(claimId);
        const claimSnap = await claimRef.get();
        if (!claimSnap.exists) return res.status(404).json({ error: 'Claim not found' });

        const claim = claimSnap.data();
        const adminName = req.adminUser.name || req.adminUser.email || 'Admin';

        // Update claim
        await claimRef.update({
            status: 'rejected',
            rejectionReason: reason,
            updatedAt: FieldValue.serverTimestamp(),
            timeline: FieldValue.arrayUnion({
                event: 'Rejected',
                timestamp: new Date().toISOString(),
                actor: adminName,
                note: reason,
            }),
        });

        // Send WhatsApp rejection
        if (claim.memberId) {
            const convSnap = await db.collection('conversations')
                .where('memberId', '==', claim.memberId)
                .limit(1)
                .get();

            if (!convSnap.empty) {
                const phone = convSnap.docs[0].id;
                const memberSnap = await db.collection('members').doc(claim.memberId).get();
                const member = memberSnap.exists ? decryptPII(memberSnap.data()) : {};

                try {
                    await wa.sendTemplate(phone, 'claim_rejected', [{
                        type: 'body',
                        parameters: [
                            { type: 'text', text: member.name || 'Customer' },
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
                actorId: req.adminUser.uid,
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

// ─── Data Export (Kenya DPA 2019) ────────────────────────────────

/**
 * GET /api/member/data-export?memberId=xxx
 * Returns all data for a member (GDPR/DPA compliance)
 */
router.get('/member/data-export', async (req, res) => {
    try {
        const { memberId } = req.query;
        if (!memberId) return res.status(400).json({ error: 'memberId required' });

        const memberSnap = await db.collection('members').doc(memberId).get();
        if (!memberSnap.exists) return res.status(404).json({ error: 'Member not found' });

        const memberData = decryptPII(memberSnap.data());

        // Get all claims
        const claimsSnap = await db.collection('claims')
            .where('memberId', '==', memberId)
            .get();

        const claims = claimsSnap.docs.map((d) => d.data());

        res.json({
            member: memberData,
            claims,
            exportedAt: new Date().toISOString(),
            exportedBy: req.adminUser.email,
        });

    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── Data Deletion (Kenya DPA 2019) ──────────────────────────────

/**
 * DELETE /api/member/data-delete?memberId=xxx
 * Anonymizes member data (subject to 7yr IRA retention)
 */
router.delete('/member/data-delete', async (req, res) => {
    try {
        const { memberId } = req.query;
        if (!memberId) return res.status(400).json({ error: 'memberId required' });

        const memberRef = db.collection('members').doc(memberId);
        const memberSnap = await memberRef.get();
        if (!memberSnap.exists) return res.status(404).json({ error: 'Member not found' });

        // Anonymize — don't delete due to IRA 7-year retention requirement
        await memberRef.update({
            name: '[ANONYMIZED]',
            phone: '[ANONYMIZED]',
            nationalId: '[ANONYMIZED]',
            mpesaPhone: '[ANONYMIZED]',
            status: 'deleted',
            anonymizedAt: FieldValue.serverTimestamp(),
            anonymizedBy: req.adminUser.email,
            whatsappOptIn: false,
        });

        res.json({ success: true, memberId, status: 'anonymized' });

    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
