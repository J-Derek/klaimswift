require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// 1. Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function generateClaimsForMembers() {
    console.log("Fetching members from database...");
    const { data: members, error: membersError } = await supabase.from('members').select('*');

    if (membersError) {
        console.error("Error fetching members:", membersError);
        return;
    }

    if (!members || members.length === 0) {
        console.log("No members found. Please register a member in the Admin Panel first.");
        return;
    }

    console.log(`Found ${members.length} members. Generating claims...\n`);

    const claimsToInsert = [];

    for (const member of members) {
        // Generate 1-2 random claims for this member
        const numClaims = Math.floor(Math.random() * 2) + 1;

        for (let i = 0; i < numClaims; i++) {
            claimsToInsert.push({
                phone: member.phone,
                type: Math.random() > 0.5 ? 'accidental_damage' : 'windscreen_damage',
                description: `Simulated claim for ${member.name}. Occurred on Mombasa Road.`,
                amount_kes: Math.floor(Math.random() * 40000) + 10000,
                status: 'pending',
                ai_score: Math.floor(Math.random() * 40) + 50, // Score between 50-90
                ai_summary: 'Evidence appears consistent with descriptions.',
                evidence_urls: ['https://storage.googleapis.com/test/car_damage.jpg']
            });
        }
    }

    // Insert into DB
    const { data: insertedClaims, error: insertError } = await supabase.from('claims').insert(claimsToInsert).select();

    if (insertError) {
        console.error("Error inserting simulated claims:", insertError);
    } else {
        console.log(`✅ Successfully inserted ${insertedClaims.length} realistic claims into the Inbox!`);
        console.log("Refresh the Admin Dashboard to see them.");
    }
}

generateClaimsForMembers();
