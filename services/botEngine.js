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
            .single();

        if (fetchErr) {
            console.error(`[BotEngine] Error fetching conversation:`, fetchErr);
        }

        if (!conv) {
            console.log(`[BotEngine] No existing conversation found. Initializing new state...`);
            const { error: insertErr } = await supabase.from('conversations').insert({ phone, state: 'verify', draft: {} });
            if (insertErr) console.error(`[BotEngine] Error inserting new conversation:`, insertErr);
            conv = { phone, state: 'verify', draft: {} };
        }

        console.log(`[BotEngine] Conversation state retrieved: ${conv.state}`);


        const text = extractText(message);
        const state = conv.state || 'verify';

        // Global commands
        if (text.toLowerCase() === 'stop') {
            await supabase.from('conversations').update({ state: 'stopped' }).eq('phone', phone);
            return wa.sendText(phone, 'You have unsubscribed. Send any message to re-subscribe.');
        }
        if (text.toLowerCase() === 'menu' && state !== 'verify') {
            await supabase.from('conversations').update({ state: 'menu', draft: {} }).eq('phone', phone);
            return showMenu(phone);
        }

        // State handlers
        switch (state) {
            case 'verify': return handleVerify(phone, text, conv);
            case 'menu': return handleMenu(phone, text, conv);
            case 'file-type': return handleFileType(phone, text, conv);
            case 'file-date': return handleFileDate(phone, text, conv);
            case 'file-amount': return handleFileAmount(phone, text, conv);
            case 'file-desc': return handleFileDesc(phone, text, conv);
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

    // Look up member
    let { data: member } = await supabase
        .from('members')
        .select('*')
        .eq('policy_number', text.trim().toUpperCase())
        .single();

    if (!member) {
        // Auto-register for demo
        const { data: newMember } = await supabase.from('members').insert({
            policy_number: text.trim().toUpperCase(),
            phone: phone,
            name: 'Member ' + text.trim().slice(-6),
            insurance_type: text.includes('MTR') ? 'Motor Vehicle' : text.includes('MED') ? 'Medical' : text.includes('PRO') ? 'Property' : 'Life Insurance',
            status: 'active',
        }).select().single();
        member = newMember;
    }

    await supabase.from('conversations').update({
        state: 'menu',
        member_id: member.id,
        member_name: member.name,
    }).eq('phone', phone);

    await wa.sendText(phone, `✅ *Verified!* Welcome, ${member.name}.\n\nPolicy: ${member.policy_number}\nType: ${member.insurance_type}`);
    return showMenu(phone);
}

function showMenu(phone) {
    return wa.sendButtons(phone, 'What would you like to do?', [
        { id: 'file_claim', title: '📋 File a Claim' },
        { id: 'track_claim', title: '🔍 Track Claim' },
        { id: 'speak_agent', title: '💬 Speak to Agent' },
    ]);
}

async function handleMenu(phone, text, conv) {
    const choice = text.toLowerCase();
    if (choice.includes('file') || choice === 'file_claim') {
        await supabase.from('conversations').update({ state: 'file-type', draft: {} }).eq('phone', phone);
        return wa.sendList(phone, 'Select your claim type:', 'Claim Types', [
            { id: 'Motor Vehicle', title: '🚗 Motor Vehicle', description: 'Accident, theft, damage' },
            { id: 'Medical', title: '🏥 Medical', description: 'Hospital, outpatient, dental' },
            { id: 'Property', title: '🏠 Property', description: 'Fire, flood, theft' },
            { id: 'Life Insurance', title: '💼 Life Insurance', description: 'Death, disability' },
        ]);
    }
    if (choice.includes('track') || choice === 'track_claim') {
        await supabase.from('conversations').update({ state: 'tracking' }).eq('phone', phone);
        return wa.sendText(phone, '🔍 Enter your Claim ID (e.g., CLM-2025-KE-0000001):');
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
    const dateRegex = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/;
    if (!dateRegex.test(text.trim())) {
        return wa.sendText(phone, '❌ Invalid date. Please use DD/MM/YYYY format:');
    }
    const draft = { ...(conv.draft || {}), incidentDate: text.trim() };
    await supabase.from('conversations').update({ state: 'file-amount', draft }).eq('phone', phone);
    return wa.sendText(phone, '💰 What is the estimated claim amount in KES?\n\nExample: 50000');
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
        return wa.sendButtons(phone,
            `📋 *Claim Summary*\n\n` +
            `Type: ${draft.type}\n` +
            `Date: ${draft.incidentDate}\n` +
            `Amount: KES ${(draft.amountKES || 0).toLocaleString()}\n` +
            `Description: ${draft.description}\n` +
            `Documents: ${(draft.documents || []).length}\n\n` +
            `Submit this claim?`,
            [
                { id: 'confirm_yes', title: '✅ Submit' },
                { id: 'confirm_no', title: '❌ Cancel' },
            ]
        );
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
        return wa.sendText(phone, `✅ Document received (${docs.length} total). Send more or type *done*.`);
    }

    return wa.sendText(phone, '📎 Please upload a photo or document, or type *done* to continue.');
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
        type: draft.type,
        amount_kes: draft.amountKES,
        incident_date: draft.incidentDate,
        description: draft.description,
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
        `📋 Type: ${draft.type}\n\n` +
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
    const claimRegex = /^CLM-\d{4}-KE-\d{7}$/i;
    if (!claimRegex.test(text.trim())) {
        return wa.sendText(phone, '❌ Invalid Claim ID. Format: CLM-YYYY-KE-NNNNNNN');
    }

    const { data: claim } = await supabase
        .from('claims')
        .select('*')
        .eq('claim_id', text.trim().toUpperCase())
        .single();

    if (!claim) {
        return wa.sendText(phone, '❌ Claim not found. Please check the ID and try again.');
    }

    const timeline = (claim.timeline || []).slice(-3).map(t =>
        `• ${t.event} — ${t.timestamp?.slice(0, 16)?.replace('T', ' ')}`
    ).join('\n');

    await supabase.from('conversations').update({ state: 'menu' }).eq('phone', phone);

    return wa.sendText(phone,
        `📋 *Claim ${claim.claim_id}*\n\n` +
        `Status: ${claim.status}\n` +
        `Amount: KES ${(claim.amount_kes || 0).toLocaleString()}\n` +
        `AI Score: ${claim.ai_score ?? 'Pending'}\n\n` +
        `📜 *Recent Activity:*\n${timeline || 'No activity yet'}`
    );
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
