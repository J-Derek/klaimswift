/**
 * Blockchain Audit Trail — Supabase Version
 * SHA-256 hash chaining with append-only Supabase table.
 */

const crypto = require('crypto');
const { supabase } = require('../supabase-config');

async function writeAuditEvent({ eventType, claimId, actorId, actorType, data, timestamp }) {
    // Get last block
    const { data: lastBlock } = await supabase
        .from('blockchain_events')
        .select('event_hash, block_number')
        .order('block_number', { ascending: false })
        .limit(1)
        .single();

    const previousHash = lastBlock?.event_hash || '0'.repeat(64);
    const blockNumber = (lastBlock?.block_number || 0) + 1;

    const eventPayload = { eventType, claimId, actorId, actorType, data, timestamp: timestamp || new Date().toISOString(), previousHash, blockNumber };

    const eventHash = crypto.createHash('sha256')
        .update(previousHash + JSON.stringify(eventPayload))
        .digest('hex');

    await supabase.from('blockchain_events').insert({
        block_number: blockNumber,
        event_type: eventType,
        claim_id: claimId,
        actor_id: actorId,
        actor_type: actorType,
        data,
        previous_hash: previousHash,
        event_hash: eventHash,
        timestamp: eventPayload.timestamp,
    });

    console.log(`[Blockchain] Block #${blockNumber}: ${eventType} for ${claimId}`);
    return { eventHash, blockNumber };
}

async function getClaimAuditTrail(claimId) {
    const { data } = await supabase
        .from('blockchain_events')
        .select('*')
        .eq('claim_id', claimId)
        .order('block_number', { ascending: true });
    return data || [];
}

async function verifyChain() {
    const { data: blocks } = await supabase
        .from('blockchain_events')
        .select('*')
        .order('block_number', { ascending: true });

    const errors = [];
    let expectedPrev = '0'.repeat(64);

    for (const block of (blocks || [])) {
        if (block.previous_hash !== expectedPrev) errors.push(`Block #${block.block_number}: broken chain`);
        const payload = { eventType: block.event_type, claimId: block.claim_id, actorId: block.actor_id, actorType: block.actor_type, data: block.data, timestamp: block.timestamp, previousHash: block.previous_hash, blockNumber: block.block_number };
        const expected = crypto.createHash('sha256').update(block.previous_hash + JSON.stringify(payload)).digest('hex');
        if (expected !== block.event_hash) errors.push(`Block #${block.block_number}: hash tampered`);
        expectedPrev = block.event_hash;
    }

    return { valid: errors.length === 0, blockCount: (blocks || []).length, errors };
}

module.exports = { writeAuditEvent, getClaimAuditTrail, verifyChain };
