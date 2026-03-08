/**
 * KlaimSwift — Claim Simulation Script
 * Creates mock claims in Supabase to test Admin Dashboard real-time updates.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const claimTypes = ['Motor Vehicle', 'Medical', 'Property', 'Life Insurance'];
const incidentDescriptions = [
    "Minor bumper scratch in traffic.",
    "Emergency dental surgery required.",
    "Water damage from kitchen leak.",
    "Property boundary wall damage.",
    "Accidental loss of electronic equipment."
];

async function simulate() {
    console.log('--- KlaimSwift Claim Simulator ---');

    // 1. Get a random member
    const { data: members, error: mErr } = await supabase.from('members').select('id, name').limit(10);
    if (mErr || !members.length) {
        console.error('No members found. Please run seed_kenyan_users.sql first.');
        return;
    }

    const member = members[Math.floor(Math.random() * members.length)];
    const type = claimTypes[Math.floor(Math.random() * claimTypes.length)];
    const amount = Math.floor(Math.random() * 50000) + 5000;
    const desc = incidentDescriptions[Math.floor(Math.random() * incidentDescriptions.length)];

    const year = new Date().getFullYear();
    const claimNum = String(Math.floor(Math.random() * 9999999)).padStart(7, '0');
    const claimId = `SIM-${year}-KE-${claimNum}`;

    console.log(`Generating simulated claim for: ${member.name}`);

    // 2. Insert claim
    const { data, error } = await supabase.from('claims').insert({
        claim_id: claimId,
        member_id: member.id,
        type,
        amount_kes: amount,
        incident_date: new Date().toISOString().split('T')[0],
        description: desc,
        status: 'pending',
        channel: 'WhatsApp (Simulated)',
        timeline: [{
            event: 'Claim Filed',
            timestamp: new Date().toISOString(),
            actor: 'customer',
            note: `Simulated file for ${member.name}`,
        }],
    }).select();

    if (error) {
        console.error('Simulation Failed:', error.message);
    } else {
        console.log(`✅ SUCCESS! Simulated Claim Created: ${claimId}`);
        console.log(`Check your Admin Dashboard now. It should have updated in real-time!`);
    }
}

simulate();
