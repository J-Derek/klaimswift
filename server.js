/**
 * KlaimSwift — Express Server Entry Point
 * Kenya Insurance Claims Automation Platform
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ──────────────────────────────────────────────────

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve admin dashboard static files
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// ─── Routes ─────────────────────────────────────────────────────

// WhatsApp webhook
app.use('/webhook/whatsapp', require('./routes/webhook.whatsapp'));

// M-Pesa webhook
app.use('/webhook/mpesa', require('./routes/webhook.mpesa'));

// Admin API (protected)
app.use('/api/admin', require('./routes/api.admin'));
app.use('/api', require('./routes/api.admin')); // Also mount for /api/member/* routes

// ─── Health Check ───────────────────────────────────────────────

app.get('/', (req, res) => {
    res.json({
        name: 'KlaimSwift',
        version: '1.0.0',
        status: 'running',
        region: 'africa-south1',
        timestamp: new Date().toISOString(),
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// ─── Start Server ───────────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`\n⚡ KlaimSwift server running on port ${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   Admin dashboard: http://localhost:${PORT}/admin`);
    console.log(`   WhatsApp webhook: http://localhost:${PORT}/webhook/whatsapp`);
    console.log(`   Health check: http://localhost:${PORT}/health\n`);
});

module.exports = app;
