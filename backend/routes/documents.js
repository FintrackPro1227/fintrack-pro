// backend/routes/documents.js
const router = require('express').Router();
const prisma = require('../db');
const { authenticate, operatorOnly } = require('../middleware/auth');

router.get('/', authenticate, operatorOnly, async (req, res) => {
  try {
    const { status, companyId } = req.query;
    const where = {};
    if (status) where.status = status;
    if (companyId) where.companyId = companyId;
    const docs = await prisma.document.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 100,
      include: { company: { select: { name: true } }, uploadedByUser: { select: { name: true } } }
    });
    res.json(docs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/approve', authenticate, operatorOnly, async (req, res) => {
  try {
    const doc = await prisma.document.update({
      where: { id: req.params.id },
      data: { status: 'APPROVED', reviewedBy: req.user.id, reviewedAt: new Date() }
    });
    res.json({ document: doc, message: 'Dokumen diapprove.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/reject', authenticate, operatorOnly, async (req, res) => {
  try {
    const { notes } = req.body;
    const doc = await prisma.document.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED', reviewedBy: req.user.id, reviewedAt: new Date(), notes }
    });
    res.json({ document: doc, message: 'Dokumen ditolak.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Client upload document
router.post('/client-upload', authenticate, async (req, res) => {
  try {
    // This endpoint is for client portal uploads
    // File handling via multer in ai.js
    res.json({ message: 'Silakan gunakan endpoint /api/ai/scan-invoice untuk upload dengan AI.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
