// backend/routes/documents.js — Full document management with quota tracking
const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const prisma = require('../db');
const { authenticate, operatorOnly } = require('../middleware/auth');

// ── PLAN LIMITS ──
const PLAN_LIMITS = {
  STARTER:    { docs: 75,  transactions: 50,  price: 499000,  omset: 100 },
  BISNIS:     { docs: 125, transactions: 100, price: 1299000, omset: 300 },
  PRO:        { docs: 175, transactions: 150, price: 2199000, omset: 600 },
  ENTERPRISE: { docs: 325, transactions: 300, price: 3799000, omset: 1000 },
  CUSTOM:     { docs: 9999,transactions: 9999,price: 0,       omset: 9999 },
};

// ── FILE UPLOAD ──
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + Math.round(Math.random()*1e9) + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 10*1024*1024 } });

// ── HELPERS ──
async function getMonthlyDocCount(companyId) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth()+1, 0, 23, 59, 59);
  return prisma.document.count({
    where: { companyId, createdAt: { gte: start, lte: end }, status: { not: 'REJECTED' } }
  });
}

async function getClientLimit(companyId) {
  const client = await prisma.client.findUnique({ where: { companyId }, select: { plan: true } });
  return PLAN_LIMITS[client?.plan] || PLAN_LIMITS.BISNIS;
}

async function notify(userId, title, message, type='INFO', link=null) {
  try {
    await prisma.notification.create({ data: { userId, title, message, type, link } });
  } catch(e) { console.error('Notify err:', e.message); }
}

// ── GET all docs (operator) ──
router.get('/', authenticate, operatorOnly, async (req, res) => {
  try {
    const { status, companyId, limit=100 } = req.query;
    const where = {};
    if (status) where.status = status;
    if (companyId) where.companyId = companyId;
    const docs = await prisma.document.findMany({
      where, orderBy: { createdAt: 'desc' }, take: parseInt(limit),
      include: { company: { select: { name: true } }, uploadedByUser: { select: { name: true, role: true } } }
    });
    res.json(docs);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── GET quota status ──
router.get('/quota/:companyId', authenticate, async (req, res) => {
  try {
    const { companyId } = req.params;
    const [used, limit, client] = await Promise.all([
      getMonthlyDocCount(companyId),
      getClientLimit(companyId),
      prisma.client.findUnique({ where: { companyId }, select: { plan: true } })
    ]);
    res.json({
      plan: client?.plan || 'BISNIS',
      used, limit: limit.docs,
      remaining: Math.max(0, limit.docs - used),
      percentage: Math.round(used/limit.docs*100),
      isNearLimit: used >= limit.docs * 0.8,
      isOverLimit: used >= limit.docs,
      transactionLimit: limit.transactions,
      omsetLimit: limit.omset
    });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── GET docs for logged-in client ──
router.get('/client', authenticate, async (req, res) => {
  try {
    const client = await prisma.client.findUnique({
      where: { userId: req.user.id }, include: { company: true }
    });
    if (!client) return res.status(404).json({ error: 'Klien tidak ditemukan.' });

    const { month } = req.query;
    const where = { companyId: client.companyId };
    if (month) {
      const [yr, mo] = month.split('-').map(Number);
      where.createdAt = { gte: new Date(yr, mo-1, 1), lte: new Date(yr, mo, 0, 23, 59, 59) };
    }

    const [docs, used, limit] = await Promise.all([
      prisma.document.findMany({
        where, orderBy: { createdAt: 'desc' }, take: 200,
        select: { id: true, originalName: true, status: true, aiConfidence: true, createdAt: true, notes: true, uploadedByUser: { select: { name: true } } }
      }),
      getMonthlyDocCount(client.companyId),
      getClientLimit(client.companyId)
    ]);

    const now = new Date();
    const todayCount = docs.filter(d => new Date(d.createdAt).toDateString() === now.toDateString()).length;

    res.json({ documents: docs, quota: { used, limit: limit.docs, remaining: Math.max(0, limit.docs-used) }, todayCount });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── GET document stats for operator dashboard ──
router.get('/stats', authenticate, operatorOnly, async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfDay = new Date(now); startOfDay.setHours(0,0,0,0);

    const [pending, processing, todayUploads, thisMonthTotal, clients] = await Promise.all([
      prisma.document.count({ where: { status: 'PENDING' } }),
      prisma.document.count({ where: { status: 'PROCESSING' } }),
      prisma.document.count({ where: { createdAt: { gte: startOfDay } } }),
      prisma.document.count({ where: { createdAt: { gte: startOfMonth } } }),
      prisma.client.findMany({ where: { status: 'ACTIVE' }, include: { company: { select: { id: true, name: true } } } })
    ]);

    const clientQuotas = await Promise.all(clients.map(async c => {
      const used = await getMonthlyDocCount(c.companyId);
      const lim = PLAN_LIMITS[c.plan] || PLAN_LIMITS.BISNIS;
      return { clientId: c.id, companyName: c.company.name, plan: c.plan, used, limit: lim.docs, percentage: Math.round(used/lim.docs*100), isNearLimit: used >= lim.docs*0.8, isOverLimit: used >= lim.docs };
    }));

    res.json({ pending, processing, todayUploads, thisMonthTotal, clientQuotas, nearLimitClients: clientQuotas.filter(c=>c.isNearLimit).length });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── POST quick-upload (OPERATOR — input dokumen dari WA) ──
router.post('/quick-upload', authenticate, operatorOnly, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'File tidak ditemukan.' });
    const { companyId, notes, source='WHATSAPP' } = req.body;
    if (!companyId) return res.status(400).json({ error: 'companyId wajib diisi.' });

    const [used, limit] = await Promise.all([
      getMonthlyDocCount(companyId),
      getClientLimit(companyId)
    ]);

    if (used >= limit.docs) {
      return res.status(400).json({
        error: `Kuota dokumen bulan ini sudah penuh (${used}/${limit.docs}). Klien perlu upgrade paket.`,
        quotaFull: true, used, limit: limit.docs
      });
    }

    const doc = await prisma.document.create({
      data: {
        companyId, uploadedBy: req.user.id,
        filename: req.file.filename, originalName: req.file.originalname,
        mimeType: req.file.mimetype, size: req.file.size, path: req.file.path,
        status: 'PENDING', notes: notes || `Dikirim via ${source}`, sourceType: source
      },
      include: { company: { select: { name: true } } }
    });

    const newCount = used + 1;

    // Notify client
    const client = await prisma.client.findUnique({ where: { companyId }, select: { userId: true } });
    if (client?.userId) {
      await notify(client.userId, '📄 Dokumen diterima ✓',
        `1 dokumen baru dari ${source==='WHATSAPP'?'WhatsApp':'Portal'} sudah diterima tim FinRapi. Total bulan ini: ${newCount} dokumen.`,
        'SUCCESS', '/portal/documents');

      if (newCount >= limit.docs * 0.8) {
        await notify(client.userId, '⚠️ Kuota dokumen hampir penuh',
          `Kamu sudah menggunakan ${newCount} dari ${limit.docs} dokumen bulan ini (${Math.round(newCount/limit.docs*100)}%). Pertimbangkan upgrade paket.`,
          'WARNING');
      }
    }

    res.json({
      document: doc,
      quota: { used: newCount, limit: limit.docs, remaining: limit.docs - newCount },
      message: `✓ Dokumen ${doc.company.name} berhasil diinput. Bulan ini: ${newCount}/${limit.docs}`
    });
  } catch(err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// ── POST client-upload (CLIENT — upload dari portal) ──
router.post('/client-upload', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'File tidak ditemukan.' });

    const client = await prisma.client.findUnique({
      where: { userId: req.user.id }, include: { company: true }
    });
    if (!client) return res.status(403).json({ error: 'Akses ditolak.' });

    const [used, limit] = await Promise.all([
      getMonthlyDocCount(client.companyId),
      getClientLimit(client.companyId)
    ]);

    if (used >= limit.docs) {
      return res.status(400).json({
        error: `Kuota dokumen bulan ini sudah habis (${used}/${limit.docs}). Hubungi tim FinRapi untuk upgrade.`,
        quotaFull: true
      });
    }

    const { notes, category } = req.body;
    const doc = await prisma.document.create({
      data: {
        companyId: client.companyId, uploadedBy: req.user.id,
        filename: req.file.filename, originalName: req.file.originalname,
        mimeType: req.file.mimetype, size: req.file.size, path: req.file.path,
        status: 'PENDING', notes: notes || category || 'Upload dari portal klien', sourceType: 'PORTAL'
      }
    });

    // Notify all operators
    const operators = await prisma.user.findMany({
      where: { role: { in: ['OPERATOR','ACCOUNTANT','SUPERADMIN'] }, isActive: true },
      select: { id: true }
    });
    await Promise.all(operators.map(op =>
      notify(op.id, `📄 Dokumen baru — ${client.company.name}`,
        `${client.picName} mengirim dokumen via Portal. Segera diproses.`, 'INFO', '/operator/docsqueue')
    ));

    const newCount = used + 1;
    res.json({
      document: { id: doc.id, status: doc.status, createdAt: doc.createdAt },
      quota: { used: newCount, limit: limit.docs, remaining: limit.docs - newCount },
      message: 'Dokumen berhasil dikirim! Tim FinRapi akan proses dalam 1–4 jam kerja.'
    });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── PUT approve ──
router.put('/:id/approve', authenticate, operatorOnly, async (req, res) => {
  try {
    const doc = await prisma.document.update({
      where: { id: req.params.id },
      data: { status: 'APPROVED', reviewedBy: req.user.id, reviewedAt: new Date() },
      include: { company: { select: { name: true } } }
    });
    const client = await prisma.client.findUnique({ where: { companyId: doc.companyId }, select: { userId: true } });
    if (client?.userId) await notify(client.userId, 'Dokumen disetujui ✓', `Dokumen "${doc.originalName}" sudah diverifikasi.`, 'SUCCESS');
    res.json({ document: doc, message: 'Dokumen diapprove.' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── PUT reject ──
router.put('/:id/reject', authenticate, operatorOnly, async (req, res) => {
  try {
    const { notes } = req.body;
    const doc = await prisma.document.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED', reviewedBy: req.user.id, reviewedAt: new Date(), notes }
    });
    const client = await prisma.client.findUnique({ where: { companyId: doc.companyId }, select: { userId: true } });
    if (client?.userId) await notify(client.userId, 'Dokumen perlu dikirim ulang', `"${doc.originalName}" tidak dapat diproses. Alasan: ${notes||'Dokumen tidak jelas'}. Mohon kirim ulang.`, 'WARNING');
    res.json({ document: doc, message: 'Dokumen ditolak.' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── GET notifications ──
router.get('/notifications', authenticate, async (req, res) => {
  try {
    const notifs = await prisma.notification.findMany({
      where: { userId: req.user.id, isRead: false },
      orderBy: { createdAt: 'desc' }, take: 20
    });
    res.json(notifs);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.put('/notifications/read-all', authenticate, async (req, res) => {
  try {
    await prisma.notification.updateMany({ where: { userId: req.user.id, isRead: false }, data: { isRead: true } });
    res.json({ message: 'Semua notifikasi dibaca.' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.put('/notifications/:id/read', authenticate, async (req, res) => {
  try {
    await prisma.notification.update({ where: { id: req.params.id }, data: { isRead: true } });
    res.json({ message: 'OK' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
module.exports.PLAN_LIMITS = PLAN_LIMITS;
