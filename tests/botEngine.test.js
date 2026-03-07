/**
 * Tests for bot engine state transitions
 * Run: node tests/botEngine.test.js
 * Note: Tests state logic patterns without Firebase
 */

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }

console.log('\n🤖 Bot Engine State Tests\n');

// Policy number validation
const policyRegex = /^KEN-\d{4}-(MTR|MED|PRO|LIF)-\d{6}$/i;

test('valid policy numbers pass regex', () => {
    assert(policyRegex.test('KEN-2025-MTR-123456'));
    assert(policyRegex.test('KEN-2024-MED-000001'));
    assert(policyRegex.test('KEN-2025-PRO-999999'));
    assert(policyRegex.test('KEN-2025-LIF-555555'));
});

test('invalid policy numbers fail regex', () => {
    assert(!policyRegex.test('KEN-25-MTR-123456'), 'Short year');
    assert(!policyRegex.test('KEN-2025-ABC-123456'), 'Invalid type');
    assert(!policyRegex.test('KEN-2025-MTR-12345'), 'Short digits');
    assert(!policyRegex.test('POL-2025-MTR-123456'), 'Wrong prefix');
    assert(!policyRegex.test('hello'), 'Random text');
    assert(!policyRegex.test(''), 'Empty string');
});

// Claim ID format
test('claim ID format CLM-YYYY-KE-NNNNNNN', () => {
    const year = new Date().getFullYear();
    const digits = String(Math.floor(Math.random() * 9999999)).padStart(7, '0');
    const claimId = `CLM-${year}-KE-${digits}`;
    assert(/^CLM-\d{4}-KE-\d{7}$/.test(claimId));
});

// Date validation
const dateRegex = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/;

test('valid dates pass', () => {
    assert(dateRegex.test('15/01/2025'));
    assert(dateRegex.test('1/1/2025'));
    assert(dateRegex.test('31-12-2024'));
    assert(dateRegex.test('5.6.2025'));
});

test('invalid dates fail', () => {
    assert(!dateRegex.test('2025-01-15'), 'ISO format not accepted');
    assert(!dateRegex.test('yesterday'));
    assert(!dateRegex.test(''));
});

// Amount parsing
test('amount parsing works for various formats', () => {
    const parse = (s) => parseInt(s.replace(/[,\s]/g, ''), 10);
    assert(parse('50000') === 50000);
    assert(parse('50,000') === 50000);
    assert(parse('1,500,000') === 1500000);
    assert(parse('100 000') === 100000);
});

// Text extraction
function extractText(message) {
    if (!message) return '';
    if (message.type === 'text') return message.text?.body || '';
    if (message.type === 'interactive') return message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || '';
    if (message.type === 'button') return message.button?.text || '';
    return '';
}

test('extractText handles text messages', () => {
    assert(extractText({ type: 'text', text: { body: 'hello' } }) === 'hello');
});

test('extractText handles button replies', () => {
    assert(extractText({ type: 'interactive', interactive: { button_reply: { id: 'confirm_yes' } } }) === 'confirm_yes');
});

test('extractText handles list replies', () => {
    assert(extractText({ type: 'interactive', interactive: { list_reply: { id: 'file_claim' } } }) === 'file_claim');
});

test('extractText handles null/undefined', () => {
    assert(extractText(null) === '');
    assert(extractText(undefined) === '');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
