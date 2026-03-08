/**
 * WhatsApp Webhook Routes
 * POST /webhook/whatsapp — receives inbound messages
 * GET  /webhook/whatsapp — Meta verification handshake
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const botEngine = require('../services/botEngine');
const { markAsRead } = require('../services/whatsappService');

/**
 * GET /webhook/whatsapp — Meta webhook verification
 */
router.get('/', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
        console.log('[WhatsApp] Webhook verified');
        return res.status(200).send(challenge);
    }

    console.warn('[WhatsApp] Webhook verification failed');
    return res.sendStatus(403);
});

/**
 * POST /webhook/whatsapp — Receive inbound messages
 * Verifies X-Hub-Signature-256, parses message, delegates to botEngine
 */
router.post('/', async (req, res) => {
    // Verify signature
    const signature = req.headers['x-hub-signature-256'];
    if (signature && process.env.WHATSAPP_APP_SECRET) {
        const payload = req.rawBody || JSON.stringify(req.body);
        const expectedSig = 'sha256=' +
            crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET)
                .update(payload)
                .digest('hex');
        if (signature !== expectedSig) {
            console.warn('[WhatsApp] Invalid webhook signature');
            return res.sendStatus(403);
        }
    }

    // Parse webhook payload
    try {
        const entry = req.body?.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;

        if (!value?.messages) return res.sendStatus(200); // Status update or other non-message event

        const promises = [];

        for (const message of value.messages) {
            const phone = message.from; // +254XXXXXXXXX
            console.log(`[WhatsApp] Message from ${phone}: type=${message.type}`);

            // Queue processing to await before lambda freeze
            promises.push(markAsRead(message.id).catch(e => console.error('markAsRead err:', e.message)));
            promises.push(
                botEngine.process(phone, message).catch((err) =>
                    console.error(`[WhatsApp] Bot processing error for ${phone}:`, err)
                )
            );
        }

        await Promise.all(promises);
        return res.sendStatus(200);
    } catch (err) {
        console.error('[WhatsApp] Webhook parse error:', err);
        return res.sendStatus(500);
    }
});

module.exports = router;
