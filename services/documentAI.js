/**
 * Document AI + Fraud Detection — Supabase Version
 */

const axios = require('axios');
const { supabase } = require('../supabase-config');
const wa = require('./whatsappService');

async function analyzeDocument(fileBuffer, mimeType) {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    const processorId = process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID;
    const location = 'us';
    const endpoint = `https://${location}-documentai.googleapis.com/v1/projects/${projectId}/locations/${location}/processors/${processorId}:process`;

    const { GoogleAuth } = require('google-auth-library');
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    const token = await client.getAccessToken();

    const response = await axios.post(endpoint, {
        rawDocument: { content: fileBuffer.toString('base64'), mimeType },
    }, { headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' } });

    const doc = response.data.document;
    return { text: doc.text || '', pages: doc.pages || [], entities: doc.entities || [] };
}

// Fraud rules
async function checkDuplicateClaim(claim) {
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const { data } = await supabase.from('claims')
        .select('claim_id').eq('member_id', claim.member_id).eq('type', claim.type)
        .gte('filed_at', thirtyDaysAgo.toISOString());
    const dupes = (data || []).filter(d => d.claim_id !== claim.claim_id);
    return dupes.length > 0 ? { triggered: true, flag: 'SUSPECT', rule: 'Duplicate Claim', detail: `${dupes.length} similar claim(s) in 30 days` } : { triggered: false };
}

function checkAmountInflation(claim) {
    const rates = { 'Motor Vehicle': 500000, 'Medical': 300000, 'Property': 1000000, 'Life Insurance': 5000000 };
    const threshold = rates[claim.type] || 500000;
    return claim.amount_kes > threshold * 2 ? { triggered: true, flag: 'WARNING', rule: 'Amount Inflation', detail: `KES ${claim.amount_kes.toLocaleString()} exceeds 200% market rate` } : { triggered: false };
}

async function checkVelocity(claim) {
    const oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const { count } = await supabase.from('claims').select('*', { count: 'exact', head: true })
        .eq('member_id', claim.member_id).gte('filed_at', oneYearAgo.toISOString());
    return count > 3 ? { triggered: true, flag: 'ADJUSTER', rule: 'Velocity Check', detail: `${count} claims in 12 months` } : { triggered: false };
}

function calculateAIScore(results) {
    let score = 100;
    const penalties = { SUSPECT: -30, WARNING: -15, ADJUSTER: -20 };
    results.forEach(r => { if (r.triggered) score += penalties[r.flag] || -10; });
    return Math.max(0, Math.min(100, score));
}

function getVerdict(score) { return score >= 75 ? 'safe' : score >= 50 ? 'review' : 'flag'; }

async function processClaimDocuments(claimId) {
    const { data: claim } = await supabase.from('claims').select('*').eq('claim_id', claimId).single();
    if (!claim) return;

    await supabase.from('claims').update({
        status: 'ai_review',
        timeline: [...(claim.timeline || []), { event: 'AI Review Started', timestamp: new Date().toISOString(), actor: 'ai' }],
    }).eq('claim_id', claimId);

    const ruleResults = [];
    ruleResults.push(await checkDuplicateClaim(claim));
    ruleResults.push(checkAmountInflation(claim));
    ruleResults.push(await checkVelocity(claim));

    const triggered = ruleResults.filter(r => r.triggered);
    const aiScore = calculateAIScore(ruleResults);
    const aiVerdict = getVerdict(aiScore);
    const nextStatus = aiVerdict === 'safe' ? 'approved' : aiVerdict === 'review' ? 'adjuster_review' : 'pending';

    await supabase.from('claims').update({
        status: nextStatus, ai_score: aiScore, ai_verdict: aiVerdict,
        timeline: [...(claim.timeline || []),
        { event: 'AI Review Started', timestamp: new Date().toISOString(), actor: 'ai' },
        { event: 'AI Review Completed', timestamp: new Date().toISOString(), actor: 'ai', note: `Score: ${aiScore}, Verdict: ${aiVerdict}, Flags: ${triggered.length}` }
        ],
    }).eq('claim_id', claimId);

    // Notify customer
    const { data: conv } = await supabase.from('conversations').select('phone').eq('member_id', claim.member_id).limit(1).single();
    if (conv) {
        const msg = aiVerdict === 'safe'
            ? `✅ Claim *${claimId}* passed verification (Score: ${aiScore}/100). Processing for payment.`
            : `🔍 Claim *${claimId}* requires additional review. We'll update you shortly.`;
        await wa.sendText(conv.phone, msg);
    }

    try { const bc = require('./blockchainService'); await bc.writeAuditEvent({ eventType: 'AI_VERIFICATION', claimId, actorId: 'ai', actorType: 'ai', data: { aiScore, aiVerdict }, timestamp: new Date().toISOString() }); } catch { }
}

module.exports = { processClaimDocuments, analyzeDocument };
