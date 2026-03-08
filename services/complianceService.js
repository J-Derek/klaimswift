/**
 * IRA Compliance Service — Supabase Version
 */

const PDFDocument = require('pdfkit');
const { supabase } = require('../supabase-config');

async function generateClaimsSummaryReport({ startDate, endDate }) {
    const { data: claims } = await supabase.from('claims')
        .select('*')
        .gte('filed_at', startDate)
        .lte('filed_at', endDate)
        .order('filed_at', { ascending: false });

    const all = claims || [];
    const totalAmount = all.reduce((s, c) => s + (c.amount_kes || 0), 0);
    const approved = all.filter(c => c.status === 'approved' || c.status === 'paid').length;
    const rejected = all.filter(c => c.status === 'rejected').length;
    const flagged = all.filter(c => c.ai_verdict === 'flag').length;
    const avgScore = all.reduce((s, c) => s + (c.ai_score || 0), 0) / (all.length || 1);
    const byType = {};
    all.forEach(c => { byType[c.type] = (byType[c.type] || 0) + 1; });

    return new Promise(resolve => {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];
        doc.on('data', ch => chunks.push(ch));
        doc.on('end', () => resolve(Buffer.concat(chunks)));

        doc.fontSize(20).font('Helvetica-Bold').text('KlaimSwift', { align: 'center' });
        doc.fontSize(12).font('Helvetica').text('IRA Claims Summary Report', { align: 'center' });
        doc.moveDown();
        doc.fontSize(10).text(`Period: ${startDate} to ${endDate}`, { align: 'center' });
        doc.moveDown(2);
        doc.fontSize(14).font('Helvetica-Bold').text('Summary');
        doc.moveDown(0.5);
        doc.fontSize(10).font('Helvetica');
        doc.text(`Total Claims: ${all.length}`);
        doc.text(`Total Amount: KES ${totalAmount.toLocaleString()}`);
        doc.text(`Approved: ${approved} | Rejected: ${rejected} | Fraud Flagged: ${flagged}`);
        doc.text(`Average AI Score: ${avgScore.toFixed(1)}/100`);
        doc.moveDown();
        doc.fontSize(14).font('Helvetica-Bold').text('By Type');
        doc.fontSize(10).font('Helvetica');
        Object.entries(byType).forEach(([t, c]) => doc.text(`  ${t}: ${c}`));
        doc.end();
    });
}

async function generateFraudReport({ startDate, endDate }) {
    const { data: claims } = await supabase.from('claims')
        .select('*')
        .in('ai_verdict', ['flag', 'review'])
        .gte('filed_at', startDate)
        .lte('filed_at', endDate);

    return new Promise(resolve => {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];
        doc.on('data', ch => chunks.push(ch));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.fontSize(20).font('Helvetica-Bold').text('KlaimSwift — Fraud Report', { align: 'center' });
        doc.moveDown(2);
        (claims || []).forEach(c => {
            doc.fontSize(10).font('Helvetica-Bold').text(c.claim_id);
            doc.fontSize(9).font('Helvetica').text(`Type: ${c.type} | KES ${(c.amount_kes || 0).toLocaleString()} | AI: ${c.ai_score} | ${c.ai_verdict}`);
            doc.moveDown(0.5);
        });
        doc.end();
    });
}

async function generatePayoutsReport({ startDate, endDate }) {
    const { data: txs } = await supabase.from('mpesa_transactions')
        .select('*')
        .gte('initiated_at', startDate)
        .lte('initiated_at', endDate);

    const total = (txs || []).filter(t => t.status === 'completed').reduce((s, t) => s + (t.amount || 0), 0);

    return new Promise(resolve => {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];
        doc.on('data', ch => chunks.push(ch));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.fontSize(20).font('Helvetica-Bold').text('KlaimSwift — Payouts Report', { align: 'center' });
        doc.moveDown(2);
        doc.fontSize(12).text(`Total Paid: KES ${total.toLocaleString()}`);
        doc.moveDown();
        (txs || []).forEach(t => {
            doc.fontSize(9).font('Helvetica').text(`${t.claim_id} | KES ${(t.amount || 0).toLocaleString()} | ${t.status} | TX: ${t.transaction_id || '-'}`);
        });
        doc.end();
    });
}

module.exports = { generateClaimsSummaryReport, generateFraudReport, generatePayoutsReport };
