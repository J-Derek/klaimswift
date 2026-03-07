/**
 * IRA Compliance Service
 * Generates Insurance Regulatory Authority reports (PDF output).
 * Handles Kenya DPA 2019 compliance operations.
 */

const PDFDocument = require('pdfkit');
const { db } = require('../firebase-config');
const { decryptPII } = require('./encryptionService');

/**
 * Generate Claims Summary Report (PDF)
 * @param {Object} options - { startDate, endDate }
 * @returns {Buffer} PDF buffer
 */
async function generateClaimsSummaryReport({ startDate, endDate }) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const snap = await db.collection('claims')
        .where('filedAt', '>=', start)
        .where('filedAt', '<=', end)
        .orderBy('filedAt', 'desc')
        .get();

    const claims = snap.docs.map((d) => d.data());

    // Calculate stats
    const totalClaims = claims.length;
    const totalAmount = claims.reduce((sum, c) => sum + (c.amountKES || 0), 0);
    const approved = claims.filter((c) => c.status === 'approved' || c.status === 'paid').length;
    const rejected = claims.filter((c) => c.status === 'rejected').length;
    const pending = claims.filter((c) => !['approved', 'paid', 'rejected'].includes(c.status)).length;
    const fraudFlagged = claims.filter((c) => c.aiVerdict === 'flag').length;
    const avgScore = claims.reduce((sum, c) => sum + (c.aiScore || 0), 0) / (totalClaims || 1);

    const byType = {};
    for (const c of claims) {
        byType[c.type] = (byType[c.type] || 0) + 1;
    }

    return new Promise((resolve) => {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));

        // Header
        doc.fontSize(20).font('Helvetica-Bold').text('KlaimSwift', { align: 'center' });
        doc.fontSize(12).font('Helvetica').text('IRA Claims Summary Report', { align: 'center' });
        doc.moveDown();
        doc.fontSize(10).text(`Period: ${startDate} to ${endDate}`, { align: 'center' });
        doc.text(`Generated: ${new Date().toISOString().slice(0, 10)}`, { align: 'center' });
        doc.moveDown(2);

        // Summary
        doc.fontSize(14).font('Helvetica-Bold').text('Summary');
        doc.moveDown(0.5);
        doc.fontSize(10).font('Helvetica');
        doc.text(`Total Claims Filed: ${totalClaims}`);
        doc.text(`Total Claim Amount: KES ${totalAmount.toLocaleString()}`);
        doc.text(`Approved: ${approved} | Rejected: ${rejected} | Pending: ${pending}`);
        doc.text(`Fraud Flagged: ${fraudFlagged}`);
        doc.text(`Average AI Score: ${avgScore.toFixed(1)}/100`);
        doc.moveDown();

        // By Type
        doc.fontSize(14).font('Helvetica-Bold').text('Claims by Type');
        doc.moveDown(0.5);
        doc.fontSize(10).font('Helvetica');
        for (const [type, count] of Object.entries(byType)) {
            doc.text(`  ${type}: ${count}`);
        }
        doc.moveDown();

        // Claims Table
        doc.fontSize(14).font('Helvetica-Bold').text('Claims Detail');
        doc.moveDown(0.5);
        doc.fontSize(8).font('Helvetica');

        for (const c of claims.slice(0, 100)) {
            doc.text(
                `${c.claimId} | ${c.type} | KES ${(c.amountKES || 0).toLocaleString()} | ` +
                `${c.status} | AI: ${c.aiScore || 'N/A'} | ${c.filedAt?.toDate?.()?.toISOString?.()?.slice(0, 10) || ''}`
            );
        }

        // Footer
        doc.moveDown(2);
        doc.fontSize(8).text('This report is generated for IRA compliance purposes.', { align: 'center' });
        doc.text('KlaimSwift — Kenya Insurance Claims Platform', { align: 'center' });

        doc.end();
    });
}

/**
 * Generate Fraud Detection Report (PDF)
 */
async function generateFraudReport({ startDate, endDate }) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const snap = await db.collection('claims')
        .where('aiVerdict', 'in', ['flag', 'review'])
        .where('filedAt', '>=', start)
        .where('filedAt', '<=', end)
        .get();

    const claims = snap.docs.map((d) => d.data());

    return new Promise((resolve) => {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));

        doc.fontSize(20).font('Helvetica-Bold').text('KlaimSwift', { align: 'center' });
        doc.fontSize(12).font('Helvetica').text('IRA Fraud Detection Report', { align: 'center' });
        doc.moveDown();
        doc.fontSize(10).text(`Period: ${startDate} to ${endDate}`, { align: 'center' });
        doc.moveDown(2);

        doc.fontSize(14).font('Helvetica-Bold').text(`Flagged Claims: ${claims.length}`);
        doc.moveDown();

        for (const c of claims) {
            doc.fontSize(10).font('Helvetica-Bold').text(`${c.claimId}`);
            doc.fontSize(9).font('Helvetica');
            doc.text(`Type: ${c.type} | Amount: KES ${(c.amountKES || 0).toLocaleString()}`);
            doc.text(`AI Score: ${c.aiScore}/100 | Verdict: ${c.aiVerdict}`);
            doc.text(`Status: ${c.status}`);
            doc.moveDown(0.5);
        }

        doc.end();
    });
}

/**
 * Generate M-Pesa Transactions Report (PDF)
 */
async function generatePayoutsReport({ startDate, endDate }) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const snap = await db.collection('mpesa_transactions')
        .where('initiatedAt', '>=', start)
        .where('initiatedAt', '<=', end)
        .get();

    const transactions = snap.docs.map((d) => d.data());
    const totalPaid = transactions
        .filter((t) => t.status === 'completed')
        .reduce((sum, t) => sum + (t.amount || 0), 0);

    return new Promise((resolve) => {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));

        doc.fontSize(20).font('Helvetica-Bold').text('KlaimSwift', { align: 'center' });
        doc.fontSize(12).font('Helvetica').text('M-Pesa Payouts Report', { align: 'center' });
        doc.moveDown();
        doc.fontSize(10).text(`Period: ${startDate} to ${endDate}`, { align: 'center' });
        doc.moveDown(2);

        doc.fontSize(12).font('Helvetica-Bold');
        doc.text(`Total Transactions: ${transactions.length}`);
        doc.text(`Total Paid: KES ${totalPaid.toLocaleString()}`);
        doc.moveDown();

        doc.fontSize(9).font('Helvetica');
        for (const t of transactions) {
            doc.text(
                `${t.claimId} | KES ${(t.amount || 0).toLocaleString()} | ${t.status} | ` +
                `TX: ${t.transactionId || 'N/A'}`
            );
        }

        doc.end();
    });
}

module.exports = {
    generateClaimsSummaryReport,
    generateFraudReport,
    generatePayoutsReport,
};
