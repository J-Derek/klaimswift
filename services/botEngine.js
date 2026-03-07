/**
 * WhatsApp Bot State Machine — botEngine.js
 * All states persist in Firestore conversations/{phone}.
 * Customer can abandon and resume days later.
 *
 * States: verify → menu → file-type → file-date → file-amount →
 *         file-desc → file-docs → file-confirm → tracking → agent
 */

const { db, admin } = require('../firebase-config');
const wa = require('./whatsappService');
const { encryptPII, decryptPII } = require('./encryptionService');
const { v4: uuidv4 } = require('uuid');

const FieldValue = admin.firestore.FieldValue;

/** Generate claim ID: CLM-YYYY-KE-{7digits} */
function generateClaimId() {
    const year = new Date().getFullYear();
    const digits = String(Math.floor(Math.random() * 9999999)).padStart(7, '0');
    return `CLM-${year}-KE-${digits}`;
}

/** Get or create conversation state from Firestore */
async function getSession(phone) {
    const ref = db.collection('conversations').doc(phone);
    const snap = await ref.get();
    if (snap.exists) return { ref, data: snap.data() };
    const initial = { state: 'verify', phone, createdAt: FieldValue.serverTimestamp() };
    await ref.set(initial);
    return { ref, data: initial };
}

/** Save session state */
async function saveSession(ref, updates) {
    await ref.update({ ...updates, updatedAt: FieldValue.serverTimestamp() });
}

/** Look up member by policy number */
async function findMemberByPolicy(policyNumber) {
    const snap = await db.collection('members')
        .where('policyNumber', '==', policyNumber)
        .limit(1)
        .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, ...decryptPII(doc.data()) };
}

/** Look up member by phone */
async function findMemberByPhone(phone) {
    // Phone is encrypted, so we need to check conversations for memberId
    const convSnap = await db.collection('conversations').doc(phone).get();
    if (!convSnap.exists || !convSnap.data().memberId) return null;
    const memberSnap = await db.collection('members').doc(convSnap.data().memberId).get();
    if (!memberSnap.exists) return null;
    return { id: memberSnap.id, ...decryptPII(memberSnap.data()) };
}

// ─── Main processor ──────────────────────────────────────────────

/**
 * Process an inbound WhatsApp message
 * @param {string} phone - sender phone number (+254...)
 * @param {Object} message - parsed message object
 */
async function process(phone, message) {
    const { ref, data: session } = await getSession(phone);
    const state = session.state || 'verify';
    const text = extractText(message).trim();

    // Update lastWhatsappAt on the member record if we have one
    if (session.memberId) {
        db.collection('members').doc(session.memberId).update({
            lastWhatsappAt: FieldValue.serverTimestamp(),
        }).catch(() => { });
    }

    try {
        switch (state) {
            case 'verify': return await handleVerify(phone, text, ref, session);
            case 'menu': return await handleMenu(phone, text, ref, session);
            case 'file-type': return await handleFileType(phone, text, ref, session);
            case 'file-date': return await handleFileDate(phone, text, ref, session);
            case 'file-amount': return await handleFileAmount(phone, text, ref, session);
            case 'file-desc': return await handleFileDesc(phone, text, ref, session);
            case 'file-docs': return await handleFileDocs(phone, message, ref, session);
            case 'file-confirm': return await handleFileConfirm(phone, text, ref, session);
            case 'tracking': return await handleTracking(phone, text, ref, session);
            case 'agent': return await handleAgent(phone, text, ref, session);
            default:
                await saveSession(ref, { state: 'verify' });
                return await handleVerify(phone, text, ref, session);
        }
    } catch (err) {
        console.error(`Bot error [${state}] for ${phone}:`, err);
        await wa.sendText(phone, '⚠️ Something went wrong. Please try again or type "menu" to restart.');
    }
}

// ─── State handlers ──────────────────────────────────────────────

/** STATE: verify — Ask for policy number, look up member */
async function handleVerify(phone, text, ref, session) {
    // Check if text looks like a policy number: KEN-YYYY-XXX-NNNNNN
    const policyRegex = /^KEN-\d{4}-(MTR|MED|PRO|LIF)-\d{6}$/i;

    if (!text || !policyRegex.test(text.toUpperCase())) {
        await wa.sendText(phone,
            '👋 Welcome to *KlaimSwift* — Kenya Insurance Claims Platform.\n\n' +
            'Please enter your *Policy Number* to get started.\n' +
            '_Format: KEN-2025-MTR-123456_'
        );
        await saveSession(ref, { state: 'verify' });
        return;
    }

    const member = await findMemberByPolicy(text.toUpperCase());
    if (!member) {
        await wa.sendText(phone,
            '❌ Policy number not found in our system.\n\n' +
            'Please check and try again, or register at *klaimswift.co.ke*'
        );
        return;
    }

    // Save member linkage
    await saveSession(ref, { state: 'menu', memberId: member.id, memberName: member.name });
    await sendMainMenu(phone, member.name);
}

/** Send the main menu */
async function sendMainMenu(phone, name) {
    await wa.sendInteractiveList(phone,
        `Hello *${name}*! 👋\nHow can we help you today?`,
        [{
            title: 'Main Menu',
            rows: [
                { id: 'file_claim', title: '📝 File a Claim', description: 'Submit a new insurance claim' },
                { id: 'track_claim', title: '📋 Track Claim', description: 'Check status of your claims' },
                { id: 'view_policy', title: '📄 My Policy', description: 'View your policy details' },
                { id: 'payout_info', title: '💰 Payout Info', description: 'M-Pesa payout status' },
                { id: 'talk_agent', title: '📞 Talk to Agent', description: 'Chat with a human agent' },
            ],
        }]
    );
}

/** STATE: menu — Handle main menu selection */
async function handleMenu(phone, text, ref, session) {
    const selection = text.toLowerCase();

    if (selection === 'file_claim' || selection.includes('file') || selection === '1') {
        await saveSession(ref, { state: 'file-type', wip: {} });
        await wa.sendInteractiveButtons(phone,
            '📝 *File a New Claim*\n\nWhat type of claim would you like to file?',
            [
                { id: 'type_motor', title: 'Motor Vehicle' },
                { id: 'type_medical', title: 'Medical' },
                { id: 'type_property', title: 'Property' },
            ]
        );
        // Life insurance as a follow-up since max 3 buttons
        return;
    }

    if (selection === 'track_claim' || selection.includes('track') || selection === '2') {
        await saveSession(ref, { state: 'tracking' });
        return await handleTracking(phone, text, ref, session);
    }

    if (selection === 'view_policy' || selection.includes('policy') || selection === '3') {
        return await showPolicyInfo(phone, session);
    }

    if (selection === 'payout_info' || selection.includes('payout') || selection === '4') {
        return await showPayoutInfo(phone, session);
    }

    if (selection === 'talk_agent' || selection.includes('agent') || selection === '5') {
        await saveSession(ref, { state: 'agent' });
        return await handleAgent(phone, text, ref, session);
    }

    // Default: show menu again
    await sendMainMenu(phone, session.memberName || 'Customer');
}

/** STATE: file-type — Select claim type */
async function handleFileType(phone, text, ref, session) {
    const typeMap = {
        'type_motor': 'Motor Vehicle', 'motor': 'Motor Vehicle', 'motor vehicle': 'Motor Vehicle',
        'type_medical': 'Medical', 'medical': 'Medical',
        'type_property': 'Property', 'property': 'Property',
        'type_life': 'Life Insurance', 'life': 'Life Insurance', 'life insurance': 'Life Insurance',
    };

    const claimType = typeMap[text.toLowerCase()];
    if (!claimType) {
        await wa.sendText(phone, 'Please select a valid claim type: *Motor Vehicle*, *Medical*, *Property*, or *Life Insurance*');
        return;
    }

    const wip = { ...(session.wip || {}), type: claimType };
    await saveSession(ref, { state: 'file-date', wip });
    await wa.sendText(phone, `📅 *${claimType} Claim*\n\nWhen did the incident occur?\n_Please enter the date (e.g., 15/01/2025)_`);
}

/** STATE: file-date — Enter incident date */
async function handleFileDate(phone, text, ref, session) {
    // Basic date validation
    const dateRegex = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/;
    if (!dateRegex.test(text)) {
        await wa.sendText(phone, '❌ Invalid date format. Please enter like: *15/01/2025*');
        return;
    }

    const wip = { ...(session.wip || {}), incidentDate: text };
    await saveSession(ref, { state: 'file-amount', wip });
    await wa.sendText(phone, '💰 *Estimated Claim Amount*\n\nHow much are you claiming in *KES*?\n_Enter amount (e.g., 50000)_');
}

/** STATE: file-amount — Enter KES amount */
async function handleFileAmount(phone, text, ref, session) {
    const amount = parseInt(text.replace(/[,\s]/g, ''), 10);
    if (isNaN(amount) || amount <= 0) {
        await wa.sendText(phone, '❌ Please enter a valid amount in KES (e.g., *50000*)');
        return;
    }

    const wip = { ...(session.wip || {}), amountKES: amount };
    await saveSession(ref, { state: 'file-desc', wip });
    await wa.sendText(phone, '📝 *Incident Description*\n\nPlease describe what happened in detail.');
}

/** STATE: file-desc — Enter description */
async function handleFileDesc(phone, text, ref, session) {
    if (text.length < 10) {
        await wa.sendText(phone, '❌ Please provide a more detailed description (at least 10 characters).');
        return;
    }

    const wip = { ...(session.wip || {}), description: text };
    await saveSession(ref, { state: 'file-docs', wip, docCount: 0 });
    await wa.sendText(phone,
        '📎 *Supporting Documents*\n\n' +
        'Please upload photos or PDFs of:\n' +
        '• Police report (for motor claims)\n' +
        '• Medical receipts (for medical claims)\n' +
        '• Damage photos\n' +
        '• Any other supporting documents\n\n' +
        '_Send documents one at a time. Type *done* when finished._'
    );
}

/** STATE: file-docs — Receive documents */
async function handleFileDocs(phone, message, ref, session) {
    const text = extractText(message).trim().toLowerCase();

    // Check if user is done uploading
    if (text === 'done' || text === 'finish' || text === 'submit') {
        const wip = session.wip || {};
        const docCount = session.docCount || 0;

        if (docCount === 0) {
            await wa.sendText(phone, '⚠️ Please upload at least one document before proceeding. Type *done* when finished.');
            return;
        }

        await saveSession(ref, { state: 'file-confirm' });
        return await showClaimSummary(phone, wip, docCount);
    }

    // Handle document/image uploads
    if (message.type === 'image' || message.type === 'document') {
        const mediaId = message.image?.id || message.document?.id;
        const filename = message.document?.filename || `photo_${Date.now()}.jpg`;

        // Store document reference in wip
        const docs = session.wip?.documents || [];
        docs.push({
            mediaId,
            name: filename,
            type: message.type,
            uploadedAt: new Date().toISOString(),
        });

        const wip = { ...(session.wip || {}), documents: docs };
        const docCount = (session.docCount || 0) + 1;
        await saveSession(ref, { wip, docCount });

        await wa.sendText(phone, `✅ Document received (${docCount} total). Send more or type *done* to proceed.`);
        return;
    }

    await wa.sendText(phone, '📎 Please send a *photo* or *document*, or type *done* if finished uploading.');
}

/** Show claim summary card */
async function showClaimSummary(phone, wip, docCount) {
    const summary =
        `📋 *Claim Summary*\n\n` +
        `*Type:* ${wip.type}\n` +
        `*Incident Date:* ${wip.incidentDate}\n` +
        `*Amount:* KES ${(wip.amountKES || 0).toLocaleString()}\n` +
        `*Description:* ${wip.description}\n` +
        `*Documents:* ${docCount} file(s)\n\n` +
        `Is everything correct?`;

    await wa.sendInteractiveButtons(phone, summary, [
        { id: 'confirm_yes', title: '✅ Confirm & Submit' },
        { id: 'confirm_no', title: '❌ Cancel' },
    ]);
}

/** STATE: file-confirm — Confirm or cancel claim */
async function handleFileConfirm(phone, text, ref, session) {
    const answer = text.toLowerCase();

    if (answer === 'confirm_no' || answer.includes('cancel') || answer === 'no') {
        await saveSession(ref, { state: 'menu', wip: null, docCount: null });
        await wa.sendText(phone, '❌ Claim cancelled. Returning to main menu...');
        await sendMainMenu(phone, session.memberName || 'Customer');
        return;
    }

    if (answer === 'confirm_yes' || answer.includes('confirm') || answer === 'yes') {
        const wip = session.wip || {};
        const claimId = generateClaimId();

        // Create claim in Firestore
        const claimData = {
            claimId,
            memberId: session.memberId,
            policyNumber: '', // Will be filled from member record
            type: wip.type,
            incidentDate: wip.incidentDate,
            amountKES: wip.amountKES,
            description: wip.description,
            status: 'pending',
            channel: 'WhatsApp',
            aiScore: null,
            aiVerdict: null,
            documents: (wip.documents || []).map((d) => ({
                name: d.name,
                mediaId: d.mediaId,
                type: d.type,
                url: null, // Will be set after upload to Storage
                aiResult: null,
                aiReason: null,
                uploadedAt: d.uploadedAt,
            })),
            blockchainTxHash: null,
            timeline: [
                { event: 'Claim Filed', timestamp: new Date().toISOString(), actor: 'customer', note: `Filed via WhatsApp` },
            ],
            mpesaTransactionId: null,
            filedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };

        // Get member's policy number
        if (session.memberId) {
            const memberSnap = await db.collection('members').doc(session.memberId).get();
            if (memberSnap.exists) {
                claimData.policyNumber = memberSnap.data().policyNumber || '';
                // Increment claims count
                await db.collection('members').doc(session.memberId).update({
                    claimsCount: FieldValue.increment(1),
                });
            }
        }

        await db.collection('claims').doc(claimId).set(claimData);

        // Clear WIP and return to menu
        await saveSession(ref, { state: 'menu', wip: null, docCount: null });

        // Send confirmation
        await wa.sendText(phone,
            `✅ *Claim Submitted Successfully!*\n\n` +
            `*Claim ID:* ${claimId}\n` +
            `*Type:* ${wip.type}\n` +
            `*Amount:* KES ${(wip.amountKES || 0).toLocaleString()}\n\n` +
            `Your documents are being verified by our AI system. ` +
            `Estimated settlement: *2-3 business days*.\n\n` +
            `We'll update you at every step. 🚀`
        );

        // Send template for record
        try {
            await wa.sendTemplate(phone, 'claim_submitted', [{
                type: 'body',
                parameters: [
                    { type: 'text', text: claimId },
                    { type: 'text', text: (wip.amountKES || 0).toLocaleString() },
                ],
            }]);
        } catch {
            // Template may not be registered yet
        }

        // Trigger async document AI processing
        try {
            const documentAI = require('./documentAI');
            documentAI.processClaimDocuments(claimId).catch((err) =>
                console.error('Document AI processing error:', err)
            );
        } catch {
            // Document AI service may not be initialized
        }

        return;
    }

    await showClaimSummary(phone, session.wip || {}, session.docCount || 0);
}

/** STATE: tracking — Show claim statuses */
async function handleTracking(phone, text, ref, session) {
    if (!session.memberId) {
        await saveSession(ref, { state: 'verify' });
        return await wa.sendText(phone, 'Please verify your policy number first.');
    }

    const snap = await db.collection('claims')
        .where('memberId', '==', session.memberId)
        .orderBy('filedAt', 'desc')
        .limit(5)
        .get();

    if (snap.empty) {
        await wa.sendText(phone, '📋 You have no claims on record.\n\nWould you like to file a new claim?');
        await saveSession(ref, { state: 'menu' });
        await sendMainMenu(phone, session.memberName || 'Customer');
        return;
    }

    const statusEmojis = {
        pending: '🟡', ai_review: '🔵', adjuster_review: '🟠',
        approved: '✅', rejected: '❌', paid: '💰',
        payout_initiated: '⏳',
    };

    let msg = '📋 *Your Claims*\n\n';
    snap.forEach((doc) => {
        const c = doc.data();
        const emoji = statusEmojis[c.status] || '⚪';
        msg += `${emoji} *${c.claimId}*\n`;
        msg += `   Type: ${c.type}\n`;
        msg += `   Amount: KES ${(c.amountKES || 0).toLocaleString()}\n`;
        msg += `   Status: ${c.status?.replace(/_/g, ' ').toUpperCase()}\n\n`;
    });

    await wa.sendText(phone, msg);
    await saveSession(ref, { state: 'menu' });
    await sendMainMenu(phone, session.memberName || 'Customer');
}

/** Show policy info */
async function showPolicyInfo(phone, session) {
    if (!session.memberId) return;
    const snap = await db.collection('members').doc(session.memberId).get();
    if (!snap.exists) return;
    const m = decryptPII(snap.data());

    await wa.sendText(phone,
        `📄 *Your Policy Details*\n\n` +
        `*Name:* ${m.name}\n` +
        `*Policy:* ${m.policyNumber}\n` +
        `*Type:* ${m.insuranceType}\n` +
        `*Status:* ${m.status}\n` +
        `*Claims Filed:* ${m.claimsCount || 0}`
    );
}

/** Show payout info */
async function showPayoutInfo(phone, session) {
    if (!session.memberId) return;
    const snap = await db.collection('claims')
        .where('memberId', '==', session.memberId)
        .where('status', 'in', ['approved', 'paid', 'payout_initiated'])
        .orderBy('updatedAt', 'desc')
        .limit(3)
        .get();

    if (snap.empty) {
        await wa.sendText(phone, '💰 No active payouts found.');
        return;
    }

    let msg = '💰 *Payout Status*\n\n';
    snap.forEach((doc) => {
        const c = doc.data();
        msg += `*${c.claimId}* — KES ${(c.amountKES || 0).toLocaleString()}\n`;
        msg += `Status: ${c.status?.toUpperCase()}\n`;
        if (c.mpesaTransactionId) msg += `M-Pesa TX: ${c.mpesaTransactionId}\n`;
        msg += '\n';
    });

    await wa.sendText(phone, msg);
}

/** STATE: agent — Hand off to human agent */
async function handleAgent(phone, text, ref, session) {
    // Mark conversation as needing agent in admin inbox
    await saveSession(ref, { state: 'agent', needsAgent: true, agentRequestedAt: FieldValue.serverTimestamp() });

    // Push to Realtime DB for admin notifications
    const { rtdb } = require('../firebase-config');
    await rtdb.ref('agent_queue').push({
        phone,
        memberId: session.memberId || null,
        memberName: session.memberName || 'Unknown',
        requestedAt: new Date().toISOString(),
        status: 'unassigned',
    });

    await wa.sendText(phone,
        '📞 *Agent Request Received*\n\n' +
        'A human agent will be with you shortly. ' +
        'You can continue to type messages here — they will be forwarded to the agent.\n\n' +
        'Type *menu* to return to the main menu.'
    );

    // Check if they want to return to menu
    if (text.toLowerCase() === 'menu') {
        await saveSession(ref, { state: 'menu', needsAgent: false });
        await sendMainMenu(phone, session.memberName || 'Customer');
    }
}

// ─── Utilities ───────────────────────────────────────────────────

/** Extract text content from any message type */
function extractText(message) {
    if (!message) return '';
    if (message.type === 'text') return message.text?.body || '';
    if (message.type === 'interactive') {
        return message.interactive?.button_reply?.id ||
            message.interactive?.list_reply?.id || '';
    }
    if (message.type === 'button') return message.button?.text || '';
    return '';
}

module.exports = { process };
