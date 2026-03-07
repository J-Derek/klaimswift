# WhatsApp Message Templates

Register these 4 templates in Meta Business Manager → WhatsApp → Message Templates.

---

## 1. claim_submitted
- **Category**: UTILITY
- **Language**: en
- **Body**:
```
Your claim {{1}} has been submitted successfully.
Amount: KES {{2}}
Est. settlement: 2-3 business days. We'll update you at every step.
```
- **Parameters**: `{{1}}` = Claim ID, `{{2}}` = Amount

---

## 2. claim_approved
- **Category**: UTILITY
- **Language**: en
- **Body**:
```
Great news, {{1}}! Claim {{2}} has been APPROVED.
KES {{3}} will be sent to your M-Pesa ({{4}}) within minutes.
```
- **Parameters**: `{{1}}` = Name, `{{2}}` = Claim ID, `{{3}}` = Amount, `{{4}}` = Phone

---

## 3. claim_rejected
- **Category**: UTILITY
- **Language**: en
- **Body**:
```
We're sorry, {{1}}. Claim {{2}} could not be approved.
Reason: {{3}}
For help: 0800 724 724 or reply to this message.
```
- **Parameters**: `{{1}}` = Name, `{{2}}` = Claim ID, `{{3}}` = Reason

---

## 4. mpesa_sent
- **Category**: UTILITY
- **Language**: en
- **Body**:
```
✅ M-Pesa Sent! KES {{1}} → {{2}}. Confirmation: {{3}}. Claim: {{4}}
```
- **Parameters**: `{{1}}` = Amount, `{{2}}` = Phone, `{{3}}` = TX ID, `{{4}}` = Claim ID

---

## Registration Steps

1. Go to [Meta Business Manager](https://business.facebook.com)
2. Navigate to WhatsApp → Message Templates
3. Click "Create Template"
4. Select category: **UTILITY**
5. Enter template name (e.g., `claim_submitted`)
6. Select language: **English**
7. Enter body text with `{{1}}`, `{{2}}` placeholders
8. Add sample values for each parameter
9. Submit for review (usually approved in minutes)
