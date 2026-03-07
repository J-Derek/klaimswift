# M-Pesa Daraja API Setup

## 1. Registration
1. Go to [developer.safaricom.co.ke](https://developer.safaricom.co.ke)
2. Sign up / Sign in
3. Create a new app
4. Enable **B2C** API

## 2. Sandbox Credentials
After creating the app:
- **Consumer Key** → `MPESA_CONSUMER_KEY`
- **Consumer Secret** → `MPESA_CONSUMER_SECRET`
- **Shortcode**: Use sandbox shortcode `600000` → `MPESA_SHORTCODE`
- **Initiator Name**: `testapi` → `MPESA_INITIATOR_NAME`
- **Initiator Password**: Sandbox security credential → `MPESA_INITIATOR_PASSWORD`

## 3. Callback URLs
Set in `.env`:
```
MPESA_RESULT_URL=https://yourdomain.com/webhook/mpesa/result
MPESA_TIMEOUT_URL=https://yourdomain.com/webhook/mpesa/timeout
```
**Note**: These must be publicly accessible HTTPS URLs. Use ngrok for local testing:
```bash
ngrok http 3000
```

## 4. Testing
Set `MPESA_ENV=sandbox` in `.env`.

Test phone numbers (sandbox):
- `254708374149`

## 5. Going Live
1. Apply for production credentials at developer.safaricom.co.ke
2. Complete KYC verification
3. Update `.env`:
   - Replace sandbox credentials with production
   - Set `MPESA_ENV=production`
   - Update callback URLs to production domain

## 6. B2C Security Credential
For production, you need to encrypt the initiator password:
1. Download Safaricom production certificate
2. Use OpenSSL to generate security credential:
```bash
openssl rsautl -encrypt -inkey ProductionCertificate.cer -certin -in password.txt -out encrypted.txt
base64 encrypted.txt > credential.txt
```
3. Use the base64 output as `MPESA_INITIATOR_PASSWORD`
