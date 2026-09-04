// backend/routes/products.js — Product / item master (shared by Sales & Purchasing)
const router = require('express').Router();
const prisma = require('../db');
const { authenticate, operatorOnly } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  try {
    const { companyId, search } = req.query;
    const where = { companyId };
    if (search) where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } }
    ];
    const products = await prisma.product.findMany({ where, orderBy: { name: 'asc' } });
    res.json(products);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', authenticate, operatorOnly, async (req, res) => {
  try {
    const { companyId, sku, name, unit, category, purchasePrice, sellPrice, stockQty, minStock } = req.body;
    const product = await prisma.product.create({
      data: {
        companyId, sku, name, unit: unit || 'pcs', category,
        purchasePrice: parseFloat(purchasePrice || 0), sellPrice: parseFloat(sellPrice || 0),
        stockQty: parseFloat(stockQty || 0), minStock: parseFloat(minStock || 0)
      }
    });
    res.json(product);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', authenticate, operatorOnly, async (req, res) => {
  try {
    const { name, unit, category, purchasePrice, sellPrice, minStock, isActive } = req.body;
    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: {
        name, unit, category,
        purchasePrice: purchasePrice !== undefined ? parseFloat(purchasePrice) : undefined,
        sellPrice: sellPrice !== undefined ? parseFloat(sellPrice) : undefined,
        minStock: minStock !== undefined ? parseFloat(minStock) : undefined,
        isActive
      }
    });
    res.json(product);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Adjust stock manually (e.g. stock opname)
router.post('/:id/adjust-stock', authenticate, operatorOnly, async (req, res) => {
  try {
    const { qty, notes } = req.body;
    const delta = parseFloat(qty);
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product) return res.status(404).json({ error: 'Produk tidak ditemukan.' });

    const newBalance = parseFloat(product.stockQty) + delta;
    const [updated] = await prisma.$transaction([
      prisma.product.update({ where: { id: product.id }, data: { stockQty: newBalance } }),
      prisma.stockMovement.create({
        data: {
          companyId: product.companyId, productId: product.id,
          type: delta >= 0 ? 'IN' : 'OUT', qty: Math.abs(delta),
          refType: 'ADJUSTMENT', refId: 'MANUAL', balanceAfter: newBalance, notes
        }
      })
    ]);
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/stock-movements', authenticate, async (req, res) => {
  try {
    const movements = await prisma.stockMovement.findMany({
      where: { productId: req.params.id },
      orderBy: { date: 'desc' }
    });
    res.json(movements);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
