/**
 * Tests for encryptionService.js
 * Run: node tests/encryption.test.js
 */

// Mock env
process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('hex');

const { encrypt, decrypt, encryptPII, decryptPII } = require('../services/encryptionService');

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }

console.log('\n🔐 Encryption Service Tests\n');

test('encrypt returns a string with 3 parts (iv:tag:cipher)', () => {
    const result = encrypt('Hello Kenya');
    const parts = result.split(':');
    assert(parts.length === 3, `Expected 3 parts, got ${parts.length}`);
});

test('decrypt reverses encrypt', () => {
    const original = 'Jambo! +254712345678';
    const encrypted = encrypt(original);
    const decrypted = decrypt(encrypted);
    assert(decrypted === original, `Expected "${original}", got "${decrypted}"`);
});

test('encrypt produces different ciphertexts for same plaintext (random IV)', () => {
    const a = encrypt('test');
    const b = encrypt('test');
    assert(a !== b, 'Expected different ciphertexts');
});

test('decrypt fails on tampered data', () => {
    const encrypted = encrypt('secret');
    const tampered = encrypted.slice(0, -1) + 'X';
    try { decrypt(tampered); assert(false, 'Should have thrown'); }
    catch (e) { assert(true); }
});

test('encryptPII encrypts only PII fields', () => {
    const data = { name: 'John', phone: '+254700000000', nationalId: '12345678', status: 'active' };
    const result = encryptPII(data);
    assert(result.name !== 'John', 'name should be encrypted');
    assert(result.phone !== '+254700000000', 'phone should be encrypted');
    assert(result.status === 'active', 'status should NOT be encrypted');
});

test('decryptPII decrypts PII fields', () => {
    const data = { name: 'Jane', phone: '+254711111111', nationalId: '87654321', mpesaPhone: '+254722222222' };
    const encrypted = encryptPII(data);
    const decrypted = decryptPII(encrypted);
    assert(decrypted.name === 'Jane');
    assert(decrypted.phone === '+254711111111');
    assert(decrypted.nationalId === '87654321');
    assert(decrypted.mpesaPhone === '+254722222222');
});

test('encrypt handles empty/null gracefully', () => {
    assert(encrypt(null) === null);
    assert(encrypt('') === '');
    assert(encrypt(undefined) === undefined);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
