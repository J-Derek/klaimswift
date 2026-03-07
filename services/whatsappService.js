/**
 * WhatsApp Cloud API Service
 * Direct Meta Cloud API integration with retry logic (exponential backoff).
 * Base URL: https://graph.facebook.com/v18.0/{PHONE_NUMBER_ID}/messages
 */

const axios = require('axios');

const BASE_URL = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`;
const HEADERS = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
};

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * Send request with exponential backoff retry
 */
async function sendWithRetry(payload, retries = MAX_RETRIES) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await axios.post(BASE_URL, payload, { headers: HEADERS });
            return res.data;
        } catch (err) {
            if (attempt === retries) throw err;
            const delay = BASE_DELAY_MS * Math.pow(2, attempt);
            console.error(`WhatsApp send failed (attempt ${attempt + 1}), retrying in ${delay}ms...`);
            await new Promise((r) => setTimeout(r, delay));
        }
    }
}

/**
 * Send a plain text message
 */
async function sendText(to, body) {
    return sendWithRetry({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body },
    });
}

/**
 * Send a template message (required outside 24hr window)
 * @param {string} to - recipient phone
 * @param {string} templateName - registered template name
 * @param {Array} components - template components with parameters
 */
async function sendTemplate(to, templateName, components = []) {
    return sendWithRetry({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
            name: templateName,
            language: { code: 'en' },
            components,
        },
    });
}

/**
 * Send interactive buttons (max 3 buttons)
 */
async function sendInteractiveButtons(to, body, buttons) {
    return sendWithRetry({
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
            type: 'button',
            body: { text: body },
            action: {
                buttons: buttons.slice(0, 3).map((btn, i) => ({
                    type: 'reply',
                    reply: { id: btn.id || `btn_${i}`, title: btn.title.slice(0, 20) },
                })),
            },
        },
    });
}

/**
 * Send interactive list (for menus > 3 options)
 */
async function sendInteractiveList(to, body, sections) {
    return sendWithRetry({
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
            type: 'list',
            body: { text: body },
            action: {
                button: 'Select Option',
                sections,
            },
        },
    });
}

/**
 * Send a document
 */
async function sendDocument(to, documentUrl, filename, caption) {
    return sendWithRetry({
        messaging_product: 'whatsapp',
        to,
        type: 'document',
        document: { link: documentUrl, filename, caption },
    });
}

/**
 * Send an image
 */
async function sendImage(to, imageUrl, caption) {
    return sendWithRetry({
        messaging_product: 'whatsapp',
        to,
        type: 'image',
        image: { link: imageUrl, caption },
    });
}

/**
 * Mark a message as read
 */
async function markAsRead(messageId) {
    try {
        return await axios.post(
            BASE_URL,
            {
                messaging_product: 'whatsapp',
                status: 'read',
                message_id: messageId,
            },
            { headers: HEADERS }
        );
    } catch (err) {
        console.error('Failed to mark message as read:', err.message);
    }
}

/**
 * Download media from WhatsApp
 * @param {string} mediaId - Meta media ID
 * @returns {Buffer} media content
 */
async function downloadMedia(mediaId) {
    // Step 1: Get media URL
    const metaRes = await axios.get(
        `https://graph.facebook.com/v18.0/${mediaId}`,
        { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
    );
    // Step 2: Download actual file
    const fileRes = await axios.get(metaRes.data.url, {
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
        responseType: 'arraybuffer',
    });
    return Buffer.from(fileRes.data);
}

/**
 * Check if we're within 24hr messaging window
 * @param {Date|Object} lastWhatsappAt - Firestore timestamp or Date
 * @returns {boolean}
 */
function isWithin24HrWindow(lastWhatsappAt) {
    if (!lastWhatsappAt) return false;
    const ts = lastWhatsappAt.toDate ? lastWhatsappAt.toDate() : new Date(lastWhatsappAt);
    const diffMs = Date.now() - ts.getTime();
    return diffMs < 24 * 60 * 60 * 1000;
}

module.exports = {
    sendText,
    sendTemplate,
    sendInteractiveButtons,
    sendInteractiveList,
    sendDocument,
    sendImage,
    markAsRead,
    downloadMedia,
    isWithin24HrWindow,
};
