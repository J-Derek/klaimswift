# IRA Compliance Guide

## Kenya Insurance Regulatory Authority (IRA) Requirements

### Data Protection Act 2019 Compliance
| Requirement | Status | Implementation |
|---|---|---|
| AES-256 PII encryption | ✅ | `encryptionService.js` encrypts name, phone, nationalId, mpesaPhone |
| Consent recording | ✅ | `whatsappOptIn=true` + timestamp at first message |
| Consent withdrawal | ✅ | Customer sends STOP → `whatsappOptIn=false` |
| Data export | ✅ | `GET /api/member/data-export` |
| Data deletion | ✅ | `DELETE /api/member/data-delete` (anonymizes, 7yr retention) |
| Data residency | ✅ | Firebase region: `africa-south1` (Cape Town) |
| Audit trail | ✅ | SHA-256 hash-chained blockchain events |

### IRA Reporting
- **Claims Summary Report**: Generated via admin dashboard → IRA Compliance page
- **Fraud Detection Report**: All flagged claims with AI signals
- **M-Pesa Payouts Report**: Full transaction history

### Retention Policy
- All claim records retained for **7 years** per IRA requirements
- Data deletion requests anonymize records but do not delete them
- Blockchain audit trail is permanent and append-only

### Submission Deadlines
- Quarterly reports: End of Q1/Q2/Q3/Q4
- Annual report: January 31st
