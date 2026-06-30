// backend/routes/ai.js — AI Invoice Scanner using Claude API
const router = require('express').Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const prisma = require('../db');
const { authenticate, operatorOnly } = require('../middleware/auth');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// File upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// POST /api/ai/scan-invoice — scan invoice image with Claude
router.post('/scan-invoice', authenticate, operatorOnly, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'File tidak ditemukan.' });

    const { companyId } = req.body;
    const filePath = req.file.path;

    // Save document record
    const doc = await prisma.document.create({
      data: {
        companyId: companyId || await getOperatorCompanyId(),
        uploadedBy: req.user.id,
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        path: filePath,
        status: 'PROCESSING'
      }
    });

    // Read file as base64
    const fileData = fs.readFileSync(filePath);
    const base64Data = fileData.toString('base64');
    const mediaType = req.file.mimetype.startsWith('image/') ? req.file.mimetype : 'image/jpeg';

    // Call Claude API
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64Data }
          },
          {
            type: 'text',
            text: `Kamu adalah sistem OCR akuntansi untuk Indonesia. Baca dokumen ini dan ekstrak data keuangan.

Kembalikan HANYA JSON valid dengan format ini (tanpa teks lain):
{
  "documentType": "INVOICE|RECEIPT|NOTA|BANK_STATEMENT|OTHER",
  "refNumber": "nomor invoice/dokumen",
  "date": "YYYY-MM-DD",
  "vendor": "nama vendor/supplier",
  "npwp": "NPWP vendor jika ada, kosong jika tidak",
  "description": "deskripsi singkat",
  "items": [{"name": "nama item", "qty": 1, "unitPrice": 0, "amount": 0}],
  "dpp": 0,
  "taxType": "PPN_11|PPN_0|PPH_23|PPH_21|NONE",
  "taxAmount": 0,
  "total": 0,
  "currency": "IDR|USD|SGD",
  "confidence": 85,
  "notes": "catatan jika ada keraguan"
}

Aturan:
- Semua angka dalam number, bukan string
- Jika PPN ada di dokumen, taxType = PPN_11 dan hitung DPP = total / 1.11
- Jika tidak ada pajak, taxType = NONE
- confidence = persentase keyakinan kamu (0-100)
- Jika dokumen tidak jelas, isi dengan nilai default dan confidence rendah`
          }
        ]
      }]
    });

    // Parse AI response
    let aiData;
    try {
      const text = message.content[0].text.trim();
      const clean = text.replace(/```json|```/g, '').trim();
      aiData = JSON.parse(clean);
    } catch (e) {
      aiData = {
        documentType: 'OTHER', refNumber: '', date: new Date().toISOString().split('T')[0],
        vendor: '', npwp: '', description: 'Tidak dapat membaca dokumen',
        items: [], dpp: 0, taxType: 'NONE', taxAmount: 0, total: 0,
        currency: 'IDR', confidence: 0, notes: 'Gagal parse response AI'
      };
    }

    // Update document with AI data
    await prisma.document.update({
      where: { id: doc.id },
      data: { status: 'EXTRACTED', aiConfidence: aiData.confidence || 0, aiData }
    });

    res.json({ documentId: doc.id, data: aiData, confidence: aiData.confidence });

  } catch (err) {
    console.error('AI scan error:', err);
    res.status(500).json({ error: 'Gagal memproses dokumen: ' + err.message });
  }
});

// POST /api/ai/scan-bank-statement — scan bank rekening koran
router.post('/scan-bank-statement', authenticate, operatorOnly, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'File tidak ditemukan.' });

    const fileData = fs.readFileSync(req.file.path);
    const base64Data = fileData.toString('base64');

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Data } },
          {
            type: 'text',
            text: `Baca rekening koran bank ini. Kembalikan HANYA JSON:
{
  "bankName": "nama bank",
  "accountNo": "nomor rekening",
  "period": "periode rekening koran",
  "openingBalance": 0,
  "closingBalance": 0,
  "mutations": [
    {"date": "YYYY-MM-DD", "description": "keterangan", "debit": 0, "credit": 0, "balance": 0}
  ],
  "confidence": 85
}`
          }
        ]
      }]
    });

    const text = message.content[0].text.trim();
    const clean = text.replace(/```json|```/g, '').trim();
    const data = JSON.parse(clean);

    res.json({ data, confidence: data.confidence });
  } catch (err) {
    console.error('Bank scan error:', err);
    res.status(500).json({ error: 'Gagal memproses rekening koran: ' + err.message });
  }
});

async function getOperatorCompanyId() {
  const co = await prisma.company.findFirst({ where: { type: 'OPERATOR' } });
  return co?.id;
}

module.exports = router;
