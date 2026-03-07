/**
 * Blockchain Audit Trail Service
 * SHA-256 hash chaining in Firestore (fallback implementation).
 *
 * Each event is chained: hash = SHA-256(previousHash + eventData)
 * This creates an immutable, verifiable audit trail.
 *
 * Records are APPEND-ONLY. Never update or delete any blockchain event.
 *
 * Full Hyperledger Fabric setup guide in docs/SETUP.md
 */

const crypto = require('crypto');
const { db, admin } = require('../firebase-config');

const FieldValue = admin.firestore.FieldValue;
const COLLECTION = 'blockchain_events';

/**
 * Write an audit event to the blockchain
 * @param {Object} event
 * @param {string} event.eventType - e.g. CLAIM_FILED, CLAIM_APPROVED
 * @param {string} event.claimId
 * @param {string} event.actorId
 * @param {string} event.actorType - 'customer' | 'admin' | 'system' | 'ai'
 * @param {Object} event.data - event-specific payload
 * @param {string} event.timestamp - ISO 8601
 * @returns {Object} { eventHash, blockNumber }
 */
async function writeAuditEvent({ eventType, claimId, actorId, actorType, data, timestamp }) {
    // Get the last event hash for chaining
    const lastEventSnap = await db.collection(COLLECTION)
        .orderBy('blockNumber', 'desc')
        .limit(1)
        .get();

    const previousHash = lastEventSnap.empty ? '0'.repeat(64) : lastEventSnap.docs[0].data().eventHash;
    const blockNumber = lastEventSnap.empty ? 1 : lastEventSnap.docs[0].data().blockNumber + 1;

    // Create event payload
    const eventPayload = {
        eventType,
        claimId,
        actorId,
        actorType,
        data,
        timestamp: timestamp || new Date().toISOString(),
        previousHash,
        blockNumber,
    };

    // Calculate SHA-256 hash
    const eventHash = crypto
        .createHash('sha256')
        .update(previousHash + JSON.stringify(eventPayload))
        .digest('hex');

    // Store in Firestore (append-only)
    const record = {
        ...eventPayload,
        eventHash,
        createdAt: FieldValue.serverTimestamp(),
    };

    await db.collection(COLLECTION).doc(`block_${blockNumber}`).set(record);

    console.log(`[Blockchain] Block #${blockNumber}: ${eventType} for ${claimId} → ${eventHash.slice(0, 16)}...`);

    return { eventHash, blockNumber };
}

/**
 * Get full audit trail for a claim
 * @param {string} claimId
 * @returns {Array} ordered list of events
 */
async function getClaimAuditTrail(claimId) {
    const snap = await db.collection(COLLECTION)
        .where('claimId', '==', claimId)
        .orderBy('blockNumber', 'asc')
        .get();

    return snap.docs.map((doc) => doc.data());
}

/**
 * Verify an event has not been tampered with
 * @param {string} eventHash - hash to verify
 * @returns {Object} { valid, block }
 */
async function verifyEvent(eventHash) {
    // Find the block with this hash
    const snap = await db.collection(COLLECTION)
        .where('eventHash', '==', eventHash)
        .limit(1)
        .get();

    if (snap.empty) return { valid: false, error: 'Event not found' };

    const block = snap.docs[0].data();

    // Recalculate hash
    const payload = {
        eventType: block.eventType,
        claimId: block.claimId,
        actorId: block.actorId,
        actorType: block.actorType,
        data: block.data,
        timestamp: block.timestamp,
        previousHash: block.previousHash,
        blockNumber: block.blockNumber,
    };

    const recalculatedHash = crypto
        .createHash('sha256')
        .update(block.previousHash + JSON.stringify(payload))
        .digest('hex');

    const valid = recalculatedHash === eventHash;

    if (!valid) {
        console.error(`[Blockchain] TAMPERED BLOCK #${block.blockNumber}! Expected ${eventHash}, got ${recalculatedHash}`);
    }

    return { valid, block };
}

/**
 * Verify entire chain integrity
 * @returns {Object} { valid, blockCount, errors }
 */
async function verifyChain() {
    const snap = await db.collection(COLLECTION)
        .orderBy('blockNumber', 'asc')
        .get();

    const errors = [];
    let previousHash = '0'.repeat(64);

    for (const doc of snap.docs) {
        const block = doc.data();

        // Verify chain linkage
        if (block.previousHash !== previousHash) {
            errors.push(`Block #${block.blockNumber}: broken chain link`);
        }

        // Verify hash
        const payload = {
            eventType: block.eventType,
            claimId: block.claimId,
            actorId: block.actorId,
            actorType: block.actorType,
            data: block.data,
            timestamp: block.timestamp,
            previousHash: block.previousHash,
            blockNumber: block.blockNumber,
        };

        const expectedHash = crypto
            .createHash('sha256')
            .update(block.previousHash + JSON.stringify(payload))
            .digest('hex');

        if (expectedHash !== block.eventHash) {
            errors.push(`Block #${block.blockNumber}: hash mismatch (tampered)`);
        }

        previousHash = block.eventHash;
    }

    return {
        valid: errors.length === 0,
        blockCount: snap.size,
        errors,
    };
}

module.exports = { writeAuditEvent, getClaimAuditTrail, verifyEvent, verifyChain };
