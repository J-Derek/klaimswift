# KlaimSwift — Setup Guide

## Prerequisites
- Node.js 18+
- Firebase project (Blaze plan for Cloud Functions)
- Meta Business account with WhatsApp Business API
- Google Cloud project with Document AI enabled
- Safaricom Daraja API developer account

---

## 1. Firebase Setup

### 1.1 Create Project
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create new project: **klaimswift**
3. **CRITICAL**: Set region to **africa-south1 (Cape Town)** — required by Kenya DPA 2019
4. Enable Firestore Database
5. Enable Firebase Storage
6. Enable Firebase Authentication (Email/Password provider)
7. Enable Realtime Database

### 1.2 Service Account
1. Go to Project Settings → Service Accounts
2. Click "Generate new private key"
3. Save as `google-credentials.json` in project root
4. Copy values to `.env`:
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_PRIVATE_KEY` (include quotes, escape newlines)
   - `FIREBASE_CLIENT_EMAIL`
   - `FIREBASE_DATABASE_URL`
   - `FIREBASE_STORAGE_BUCKET`

### 1.3 Deploy Security Rules
```bash
firebase deploy --only firestore:rules,storage
```

### 1.4 Deploy Indexes
```bash
firebase deploy --only firestore:indexes
```

### 1.5 Create Admin User
```bash
# In Firebase Console → Authentication → Users → Add User
# Email: admin@klaimswift.co.ke
# Password: (your secure password)
```

### 1.6 Update Admin Dashboard Config
Edit `admin/login.html` and `admin/index.html`:
Replace `YOUR_API_KEY`, `YOUR_PROJECT_ID`, etc. with your Firebase web config.

---

## 2. WhatsApp Business API Setup
See [WHATSAPP_TEMPLATES.md](./WHATSAPP_TEMPLATES.md) for full guide.

1. Create Meta Business account at [business.facebook.com](https://business.facebook.com)
2. Create WhatsApp Business App
3. Get Phone Number ID and Token from WhatsApp → API Setup
4. Set `.env`:
   - `WHATSAPP_TOKEN`
   - `WHATSAPP_PHONE_ID`
   - `WHATSAPP_VERIFY_TOKEN` (any random string)
   - `WHATSAPP_BUSINESS_ACCOUNT_ID`
5. Set webhook URL: `https://yourdomain.com/webhook/whatsapp`

---

## 3. Google Document AI Setup

1. Enable Document AI API in Google Cloud Console
2. Create a Form Parser processor
3. Note the Processor ID
4. Set `.env`:
   - `GOOGLE_CLOUD_PROJECT_ID`
   - `GOOGLE_DOCUMENT_AI_PROCESSOR_ID`
   - `GOOGLE_APPLICATION_CREDENTIALS=./google-credentials.json`

---

## 4. Safaricom Daraja API Setup
See [MPESA_SETUP.md](./MPESA_SETUP.md) for full guide.

1. Register at [developer.safaricom.co.ke](https://developer.safaricom.co.ke)
2. Create an app with B2C API access
3. Set `.env` with sandbox credentials first
4. Set `MPESA_ENV=sandbox` for testing

---

## 5. Generate Encryption Key

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Copy output to `ENCRYPTION_KEY` in `.env`.

---

## 6. Install & Run

```bash
npm install
cp .env.example .env
# Fill in all values in .env
node server.js
```

Server starts at `http://localhost:3000`
Admin dashboard at `http://localhost:3000/admin`

---

## 7. Deployment (Railway / Render)

### Railway
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

### Render
1. Connect GitHub repo
2. Set Build Command: `npm install`
3. Set Start Command: `node server.js`
4. Add all env vars from `.env`
