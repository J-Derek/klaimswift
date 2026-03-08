/**
 * WhatsApp Bot Engine — Supabase Version
 * State machine for claim filing via WhatsApp.
 */

const { supabase } = require('../supabase-config');
const wa = require('./whatsappService');
const { encryptPII } = require('./encryptionService');
const { v4: uuidv4 } = require('uuid');

// ─── State Machine ───────────────────────────────────────────────

async function process(phone, message) {
    console.log(`[BotEngine] Starting process for phone: ${phone}, type: ${message.type}`);

    try {
        console.log(`[BotEngine] Looking up conversation state in Supabase...`);
        // Get or create conversation state
        let { data: conv, error: fetchErr } = await supabase
            .from('conversations')
            .select('*')
            .eq('phone', phone)
            .maybeSingle();

        if (fetchErr) {
            console.error(`[BotEngine] Error fetching conversation:`, fetchErr);
        }

        if (!conv) {
            console.log(`[BotEngine] No existing conversation found. Initializing new state...`);
            const { data: newConv, error: insertErr } = await supabase
                .from('conversations')
                .insert({ phone, state: 'verify', draft: {} })
                .select()
                .single();
            if (insertErr) console.error(`[BotEngine] Error inserting new conversation:`, insertErr);
            conv = newConv || { phone, state: 'verify', draft: {} };
        }

        console.log(`[BotEngine] Conversation state: ${conv.state}`);

        const text = extractText(message);
        const state = conv.state || 'verify';

        // Global commands
        const cmd = text.toLowerCase().trim();
        if (cmd === 'stop') {
            await supabase.from('conversations').update({ state: 'stopped' }).eq('phone', phone);
            return wa.sendText(phone, 'You have unsubscribed. Send any message to re-subscribe.');
        }
        if (cmd === 'restart' || cmd === 'reset') {
            await supabase.from('conversations').delete().eq('phone', phone);
            return wa.sendText(phone, 'Welcome back! Please enter your policy number (e.g., KEN-2025-MTR-123456):');
        }
        if (cmd === 'menu' && state !== 'verify') {
            await supabase.from('conversations').update({ state: 'menu', draft: {} }).eq('phone', phone);
            return showMenu(phone);
        }

        // State handlers
        switch (state) {
            case 'verify': return handleVerify(phone, text, conv);
            case 'menu': return handleMenu(phone, text, conv);
            case 'file-date': return handleFileDate(phone, text, conv);
            case 'file-docs': return handleFileDocs(phone, message, conv);
            case 'file-confirm': return handleFileConfirm(phone, text, conv);
            case 'tracking': return handleTracking(phone, text, conv);
            case 'agent': return handleAgent(phone, text, conv);
            default:
                await supabase.from('conversations').update({ state: 'verify' }).eq('phone', phone);
                return wa.sendText(phone, 'Welcome to KlaimSwift! Please enter your policy number (e.g., KEN-2025-MTR-123456):');
        }
    } catch (err) {
        console.error(`[BotEngine] CRITICAL FATAL ERROR processing message:`, err);
    }
}

// ─── State Handlers ──────────────────────────────────────────────

async function handleVerify(phone, text, conv) {
    const policyRegex = /^KEN-\d{4}-(MTR|MED|PRO|LIF)-\d{6}$/i;
    if (!policyRegex.test(text.trim())) {
        return wa.sendText(phone, '❌ Invalid format. Please enter your policy number:\n\nFormat: KEN-YYYY-TYPE-NNNNNN\nExample: KEN-2025-MTR-123456');
    }

    // Look up member — NO auto-registration
    const { data: member, error } = await supabase
        .from('members')
        .select('*')
        .eq('policy_number', text.trim().toUpperCase())
        .single();

    if (!member) {
        return wa.sendText(phone,
            `❌ *Policy not found.*\n\n` +
            `The policy number *${text.trim().toUpperCase()}* is not registered in our system.\n\n` +
            `To get started, please:\n` +
            `• Contact your insurance admin to register you, OR\n` +
            `• Visit our website for self-registration.\n\n` +
            `If you believe this is an error, contact support.`
        );
    }

    if (member.status !== 'active') {
        return wa.sendText(phone, `⚠️ Your policy *${member.policy_number}* is currently *${member.status}*. Please contact your admin for assistance.`);
    }

    await supabase.from('conversations').update({
        state: 'menu',
        member_id: member.id,
        member_name: member.name,
    }).eq('phone', phone);

    // Confirm with full member details
    await wa.sendText(phone,
        `✅ *Identity Verified!*\n\n` +
        `👤 *Name:* ${member.name}\n` +
        `🪪 *Policy No:* ${member.policy_number}\n` +
        `🏥 *Coverage:* ${member.insurance_type}\n` +
        `📅 *Status:* ${member.status.toUpperCase()}\n`
    );
    return showMenu(phone);
}

function showMenu(phone) {
    return wa.sendInteractiveButtons(phone, 'What would you like to do?', [
        { id: 'file_claim', title: '📋 File a Claim' },
        { id: 'track_claim', title: '🔍 Track Claim' },
        { id: 'speak_agent', title: '💬 Speak to Agent' },
    ]);
}

async function handleMenu(phone, text, conv) {
    const choice = text.toLowerCase();
    if (choice.includes('file') || choice === 'file_claim') {
        // Default the type from the member's insurance_type if possible, or just proceed
        await supabase.from('conversations').update({ state: 'file-date', draft: {} }).eq('phone', phone);
        return wa.sendText(phone, '📅 When did the incident happen? (e.g., Today, Yesterday, or DD/MM/YYYY)');
    }
    if (choice.includes('track') || choice === 'track_claim') {
        await supabase.from('conversations').update({ state: 'tracking' }).eq('phone', phone);
        return wa.sendText(phone, '🔍 Enter your Claim ID to check status (e.g., CLM-2025-KE-XXXXXXX):');
    }
    if (choice.includes('agent') || choice === 'speak_agent') {
        await supabase.from('conversations').update({ state: 'agent', needs_agent: true }).eq('phone', phone);
        return wa.sendText(phone, '💬 You are now connected to an agent. A team member will respond shortly.\n\nType *menu* to return.');
    }
    return showMenu(phone);
}

async function handleFileType(phone, text, conv) {
    const types = ['Motor Vehicle', 'Medical', 'Property', 'Life Insurance'];
    const type = types.find(t => t.toLowerCase() === text.toLowerCase()) || text;
    const draft = { ...(conv.draft || {}), type };
    await supabase.from('conversations').update({ state: 'file-date', draft }).eq('phone', phone);
    return wa.sendText(phone, `📅 When did the incident happen?\n\nFormat: DD/MM/YYYY\nExample: 15/01/2025`);
}

async function handleFileDate(phone, text, conv) {
    const draft = { ...(conv.draft || {}), incidentDate: text };
    await supabase.from('conversations').update({ state: 'file-docs', draft }).eq('phone', phone);
    return wa.sendText(phone, '📎 Please upload your supporting documents (photos, receipts, reports).\n\nSend *done* when you have uploaded all documents.');
}

async function handleFileAmount(phone, text, conv) {
    const amount = parseInt(text.replace(/[,\s]/g, ''), 10);
    if (isNaN(amount) || amount <= 0) {
        return wa.sendText(phone, '❌ Please enter a valid amount in KES:');
    }
    const draft = { ...(conv.draft || {}), amountKES: amount };
    await supabase.from('conversations').update({ state: 'file-desc', draft }).eq('phone', phone);
    return wa.sendText(phone, '📝 Briefly describe what happened:');
}

async function handleFileDesc(phone, text, conv) {
    const draft = { ...(conv.draft || {}), description: text };
    await supabase.from('conversations').update({ state: 'file-docs', draft }).eq('phone', phone);
    return wa.sendText(phone, '📎 Please upload your supporting documents (photos, receipts, reports).\n\nSend *done* when you have uploaded all documents.');
}

async function handleFileDocs(phone, message, conv) {
    const text = extractText(message);
    if (text.toLowerCase() === 'done') {
        await supabase.from('conversations').update({ state: 'file-confirm' }).eq('phone', phone);
        const draft = conv.draft || {};

        // Auto-detect type if not set
        const type = draft.type || 'General';

        const summaryText = `📋 *Claim Summary*\n\n` +
            `Type: ${type}\n` +
            `Date: ${draft.incidentDate}\n` +
            `Documents: ${(draft.documents || []).length}\n\n` +
            `Submit this claim?`;

        return wa.sendInteractiveButtons(phone, summaryText, [
            { id: 'file_confirm_yes', title: '✅ Yes, Submit' },
            { id: 'file_confirm_no', title: '❌ No, Edit' },
        ]);
    }

    // Save document reference
    if (message.type === 'image' || message.type === 'document') {
        const docs = [...(conv.draft?.documents || [])];
        docs.push({
            mediaId: message[message.type]?.id,
            name: message[message.type]?.filename || `doc_${docs.length + 1}`,
            type: message.type,
        });
        const draft = { ...(conv.draft || {}), documents: docs };
        await supabase.from('conversations').update({ draft }).eq('phone', phone);
        return wa.sendText(phone, `✅ Received: ${docs.length} file(s). Send more or type *done*.`);
    }

    return wa.sendText(phone, 'Please send an image or document, or type *done* to finish.');
}

async function handleFileConfirm(phone, text, conv) {
    if (text.toLowerCase().includes('no') || text === 'confirm_no') {
        await supabase.from('conversations').update({ state: 'menu', draft: {} }).eq('phone', phone);
        return wa.sendText(phone, '❌ Claim cancelled. Returning to menu.');
    }

    const draft = conv.draft || {};
    const year = new Date().getFullYear();
    const claimNum = String(Math.floor(Math.random() * 9999999)).padStart(7, '0');
    const claimId = `CLM-${year}-KE-${claimNum}`;

    // Create claim in Supabase
    await supabase.from('claims').insert({
        claim_id: claimId,
        member_id: conv.member_id,
        type: draft.type || 'General', // Default to 'General' if not set
        amount_kes: draft.amountKES || 0, // Default to 0 if not set
        incident_date: draft.incidentDate,
        description: draft.description || 'No description provided.', // Default description
        status: 'pending',
        channel: 'WhatsApp',
        documents: draft.documents || [],
        timeline: [{
            event: 'Claim Filed',
            timestamp: new Date().toISOString(),
            actor: 'customer',
            note: `Filed via WhatsApp by ${conv.member_name}`,
        }],
    });

    // Update member claims count
    await supabase.rpc('increment_claims_count', { member_uuid: conv.member_id }).catch(() => { });

    // Reset conversation
    await supabase.from('conversations').update({ state: 'menu', draft: {} }).eq('phone', phone);

    await wa.sendText(phone,
        `✅ *Claim Submitted Successfully!*\n\n` +
        `📄 Claim ID: *${claimId}*\n` +
        `💰 Amount: KES ${(draft.amountKES || 0).toLocaleString()}\n` +
        `📋 Type: ${draft.type || 'General'}\n\n` +
        `⏳ Est. settlement: 2-3 business days\n` +
        `We'll update you at every step.`
    );

    // Trigger async AI verification
    try {
        const docAI = require('./documentAI');
        docAI.processClaimDocuments(claimId).catch(console.error);
    } catch { }

    return showMenu(phone);
}

async function handleTracking(phone, text, conv) {
    const claimId = text.trim().toUpperCase();

    const { data: claim, error } = await supabase
        .from('claims')
        .select('*')
        .eq('claim_id', claimId)
        .single();

    if (error || !claim) {
        return wa.sendText(phone, `❌ *Claim not found.*\n\nWe couldn't find a claim with ID: *${claimId}*.\nPlease double-check the ID or type *menu* to go back.`);
    }

    const statusIcons = {
        'pending': '⏳',
        'approved': '✅',
        'rejected': '❌',
        'payout_initiated': '💸',
        'paid': '💰',
        'suspended': '⚠️'
    };

    const icon = statusIcons[claim.status] || '❓';
    const statusMsg = `🔍 *Claim Status Update*\n\n` +
        `📄 ID: *${claim.claim_id}*\n` +
        `📅 Date Filed: ${new Date(claim.filed_at).toLocaleDateString()}\n` +
        `💼 status: ${icon} *${claim.status.toUpperCase()}*\n\n` +
        `Note: We will notify you of any changes here. Type *menu* to return.`;

    return wa.sendText(phone, statusMsg);
}

async function handleAgent(phone, text, conv) {
    return wa.sendText(phone, '💬 Your message has been forwarded to our team. Type *menu* to return.');
}

// ─── Helpers ─────────────────────────────────────────────────────

function extractText(message) {
    if (!message) return '';
    if (message.type === 'text') return message.text?.body || '';
    if (message.type === 'interactive') return message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || '';
    if (message.type === 'button') return message.button?.text || '';
    return '';
}

module.exports = { process };
