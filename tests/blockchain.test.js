/**
 * Tests for blockchainService.js (hash chaining logic)
 * Run: node tests/blockchain.test.js
 * Note: These test the hash calculation logic without Firebase
 */

const crypto = require('crypto');

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }

console.log('\n⛓️ Blockchain Hash Chain Tests\n');

function hashEvent(previousHash, payload) {
    return crypto.createHash('sha256')
        .update(previousHash + JSON.stringify(payload))
        .digest('hex');
}

test('genesis block starts with zero hash', () => {
    const genesisHash = '0'.repeat(64);
    const payload = { eventType: 'CLAIM_FILED', claimId: 'CLM-2025-KE-0000001', blockNumber: 1, previousHash: genesisHash };
    const hash = hashEvent(genesisHash, payload);
    assert(hash.length === 64, 'SHA-256 should produce 64 hex chars');
    assert(hash !== genesisHash, 'Hash should differ from genesis');
});

test('chain links correctly (block N references block N-1)', () => {
    const genesis = '0'.repeat(64);
    const block1 = { eventType: 'CLAIM_FILED', blockNumber: 1, previousHash: genesis };
    const hash1 = hashEvent(genesis, block1);

    const block2 = { eventType: 'CLAIM_APPROVED', blockNumber: 2, previousHash: hash1 };
    const hash2 = hashEvent(hash1, block2);

    assert(block2.previousHash === hash1, 'Block 2 should reference block 1 hash');
    assert(hash2 !== hash1, 'Block 2 hash should differ from block 1');
});

test('tampered data produces different hash', () => {
    const genesis = '0'.repeat(64);
    const payload = { eventType: 'CLAIM_FILED', claimId: 'CLM-2025-KE-0000001', amountKES: 50000 };
    const originalHash = hashEvent(genesis, payload);

    const tampered = { ...payload, amountKES: 500000 }; // Inflated!
    const tamperedHash = hashEvent(genesis, tampered);

    assert(originalHash !== tamperedHash, 'Tampered data should produce different hash');
});

test('same data always produces same hash (deterministic)', () => {
    const prev = 'abc123'.padEnd(64, '0');
    const payload = { eventType: 'TEST', data: { key: 'value' } };
    const hash1 = hashEvent(prev, payload);
    const hash2 = hashEvent(prev, payload);
    assert(hash1 === hash2, 'Same inputs should produce same hash');
});

test('full chain verification works', () => {
    const chain = [];
    let prevHash = '0'.repeat(64);

    for (let i = 1; i <= 5; i++) {
        const payload = { eventType: `EVENT_${i}`, blockNumber: i, previousHash: prevHash };
        const hash = hashEvent(prevHash, payload);
        chain.push({ ...payload, eventHash: hash });
        prevHash = hash;
    }

    // Verify chain
    let expectedPrev = '0'.repeat(64);
    for (const block of chain) {
        assert(block.previousHash === expectedPrev, `Block ${block.blockNumber} chain broken`);
        const recalc = hashEvent(block.previousHash, {
            eventType: block.eventType, blockNumber: block.blockNumber, previousHash: block.previousHash
        });
        assert(recalc === block.eventHash, `Block ${block.blockNumber} hash mismatch`);
        expectedPrev = block.eventHash;
    }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
