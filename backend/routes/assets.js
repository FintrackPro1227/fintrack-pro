// backend/routes/assets.js
const router = require('express').Router();
const prisma = require('../db');
const { authenticate, operatorOnly } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  try {
    const assets = await prisma.asset.findMany({
      where: { companyId: req.query.companyId },
      orderBy: { code: 'asc' },
      include: { depreciations: { orderBy: { period: 'desc' }, take: 1 } }
    });
    res.json(assets);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', authenticate, operatorOnly, async (req, res) => {
  try {
    const { companyId, name, category, location, serialNumber, acquisitionDate, cost, residualValue, usefulLife, method, notes } = req.body;
    const count = await prisma.asset.count({ where: { companyId } });
    const code = 'AST-' + String(count + 1).padStart(3, '0');
    const asset = await prisma.asset.create({
      data: { companyId, code, name, category, location, serialNumber, acquisitionDate: new Date(acquisitionDate), cost: parseFloat(cost), residualValue: parseFloat(residualValue || 0), usefulLife: parseInt(usefulLife), method: method || 'STRAIGHT_LINE', notes }
    });
    res.json({ asset, message: `Aset ${code} berhasil ditambahkan.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST run monthly depreciation
router.post('/depreciate', authenticate, operatorOnly, async (req, res) => {
  try {
    const { companyId, period } = req.body;
    const assets = await prisma.asset.findMany({ where: { companyId, status: 'ACTIVE' } });
    const results = [];
    for (const asset of assets) {
      const annualDepr = (parseFloat(asset.cost) - parseFloat(asset.residualValue)) / asset.usefulLife;
      const monthlyDepr = annualDepr / 12;
      const nbv = parseFloat(asset.cost) - parseFloat(asset.accDepreciation);
      if (nbv <= parseFloat(asset.residualValue)) continue;
      const actualDepr = Math.min(monthlyDepr, nbv - parseFloat(asset.residualValue));
      const depr = await prisma.depreciation.create({
        data: { assetId: asset.id, period: new Date(period), amount: actualDepr, bookValue: nbv - actualDepr, isPosted: false }
      });
      await prisma.asset.update({ where: { id: asset.id }, data: { accDepreciation: { increment: actualDepr } } });
      results.push({ assetCode: asset.code, assetName: asset.name, amount: actualDepr });
    }
    res.json({ message: `Penyusutan ${results.length} aset berhasil dihitung.`, results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST dispose asset
router.post('/:id/dispose', authenticate, operatorOnly, async (req, res) => {
  try {
    const { disposalDate, disposalPrice, disposalReason } = req.body;
    const asset = await prisma.asset.update({
      where: { id: req.params.id },
      data: { status: 'DISPOSED', disposalDate: new Date(disposalDate), disposalPrice: parseFloat(disposalPrice || 0), disposalReason }
    });
    const nbv = parseFloat(asset.cost) - parseFloat(asset.accDepreciation);
    const gainLoss = parseFloat(disposalPrice || 0) - nbv;
    res.json({ asset, gainLoss, message: `Aset ${asset.code} berhasil di-dispose. ${gainLoss >= 0 ? 'Laba' : 'Rugi'} pelepasan: Rp ${Math.abs(gainLoss).toLocaleString('id-ID')}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
