/**
 * Firebase Admin SDK Configuration
 * Region: africa-south1 (Cape Town) — Required by Kenya DPA 2019
 */

const admin = require('firebase-admin');
require('dotenv').config();

let db, rtdb, storage, auth;

try {
    const serviceAccount = {
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    };

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });

    db = admin.firestore();
    rtdb = admin.database();
    storage = admin.storage();
    auth = admin.auth();

    // Firestore settings
    db.settings({ ignoreUndefinedProperties: true });
} catch (err) {
    console.error('Firebase initialization failed (check your Vercel Environment Variables):', err.message);
}

module.exports = { admin, db, rtdb, storage, auth };
