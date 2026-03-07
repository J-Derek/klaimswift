/**
 * AES-256-GCM Encryption Service
 * Encrypts all PII fields before Firestore writes.
 * Fields: name, phone, nationalId, mpesaPhone
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY = Buffer.from(process.env.ENCRYPTION_KEY || '', 'hex');

/**
 * Encrypt a plaintext string
 * @param {string} plaintext
 * @returns {string} base64 encoded (iv:tag:ciphertext)
 */
function encrypt(plaintext) {
    if (!plaintext) return plaintext;
    if (!KEY.length) throw new Error('ENCRYPTION_KEY not configured');

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const tag = cipher.getAuthTag();

    // Format: iv:tag:ciphertext (all base64)
    return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted}`;
}

/**
 * Decrypt an encrypted string
 * @param {string} encryptedText format iv:tag:ciphertext
 * @returns {string} plaintext
 */
function decrypt(encryptedText) {
    if (!encryptedText) return encryptedText;
    if (!KEY.length) throw new Error('ENCRYPTION_KEY not configured');

    const [ivB64, tagB64, ciphertext] = encryptedText.split(':');
    if (!ivB64 || !tagB64 || !ciphertext) {
        throw new Error('Invalid encrypted text format');
    }

    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

/** PII fields that must be encrypted */
const PII_FIELDS = ['name', 'phone', 'nationalId', 'mpesaPhone'];

/**
 * Encrypt all PII fields in a member object
 * @param {Object} data - member data
 * @returns {Object} data with PII fields encrypted
 */
function encryptPII(data) {
    const result = { ...data };
    for (const field of PII_FIELDS) {
        if (result[field]) {
            result[field] = encrypt(result[field]);
        }
    }
    return result;
}

/**
 * Decrypt all PII fields in a member object
 * @param {Object} data - member data with encrypted fields
 * @returns {Object} data with PII fields decrypted
 */
function decryptPII(data) {
    const result = { ...data };
    for (const field of PII_FIELDS) {
        if (result[field]) {
            try {
                result[field] = decrypt(result[field]);
            } catch {
                // Field may not be encrypted (legacy data)
            }
        }
    }
    return result;
}

module.exports = { encrypt, decrypt, encryptPII, decryptPII, PII_FIELDS };
