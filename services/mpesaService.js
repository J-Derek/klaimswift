/**
 * Safaricom Daraja B2C Payout Service
 * Full M-Pesa B2C payment flow:
 * 1. Get OAuth token
 * 2. Initiate B2C payment
 * 3. Handle result/timeout callbacks (in webhook.mpesa.js)
 *
 * CRITICAL: Never mark a claim as 'paid' before Daraja callback confirms it.
 */

const axios = require('axios');

const SANDBOX_URL = 'https://sandbox.safaricom.co.ke';
const PROD_URL = 'https://api.safaricom.co.ke';

function getBaseUrl() {
    return process.env.MPESA_ENV === 'production' ? PROD_URL : SANDBOX_URL;
}

/**
 * Step 1: Get OAuth token from Daraja
 * Uses Basic auth with consumer key:secret
 */
async function getOAuthToken() {
    const url = `${getBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`;
    const auth = Buffer.from(
        `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
    ).toString('base64');

    const response = await axios.get(url, {
        headers: { Authorization: `Basic ${auth}` },
    });

    return response.data.access_token;
}

/**
 * Step 2: Initiate B2C payment
 * @param {Object} params
 * @param {string} params.phone - recipient phone (+254...)
 * @param {number} params.amount - KES amount
 * @param {string} params.claimId - for tracking
 * @param {string} params.remarks - description
 * @returns {Object} Daraja response with ConversationID
 */
async function initiateB2CPayout({ phone, amount, claimId, remarks }) {
    const token = await getOAuthToken();

    // Format phone: ensure 254XXXXXXXXX (no +)
    const formattedPhone = phone.replace(/^\+/, '');

    const payload = {
        InitiatorName: process.env.MPESA_INITIATOR_NAME,
        SecurityCredential: process.env.MPESA_INITIATOR_PASSWORD, // Should be encrypted in production
        CommandID: 'BusinessPayment',
        Amount: Math.round(amount), // Integer, no decimals
        PartyA: process.env.MPESA_SHORTCODE,
        PartyB: formattedPhone,
        Remarks: remarks || `KlaimSwift Payout - ${claimId}`,
        QueueTimeOutURL: process.env.MPESA_TIMEOUT_URL,
        ResultURL: process.env.MPESA_RESULT_URL,
        Occasion: claimId || '',
    };

    const response = await axios.post(
        `${getBaseUrl()}/mpesa/b2c/v1/paymentrequest`,
        payload,
        {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        }
    );

    console.log(`[M-Pesa] B2C initiated: ${claimId} → KES ${amount} → ${formattedPhone}`);
    return response.data;
}

/**
 * Check B2C transaction status (optional utility)
 */
async function checkTransactionStatus(transactionId) {
    const token = await getOAuthToken();

    const payload = {
        Initiator: process.env.MPESA_INITIATOR_NAME,
        SecurityCredential: process.env.MPESA_INITIATOR_PASSWORD,
        CommandID: 'TransactionStatusQuery',
        TransactionID: transactionId,
        PartyA: process.env.MPESA_SHORTCODE,
        IdentifierType: '4',
        ResultURL: process.env.MPESA_RESULT_URL,
        QueueTimeOutURL: process.env.MPESA_TIMEOUT_URL,
        Remarks: 'Status check',
        Occasion: '',
    };

    const response = await axios.post(
        `${getBaseUrl()}/mpesa/transactionstatus/v1/query`,
        payload,
        {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        }
    );

    return response.data;
}

module.exports = { getOAuthToken, initiateB2CPayout, checkTransactionStatus };
