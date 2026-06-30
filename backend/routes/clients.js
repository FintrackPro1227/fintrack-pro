// backend/routes/clients.js
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const prisma = require('../db');
const { authenticate, operatorOnly } = require('../middleware/auth');

// GET all clients
router.get('/', authenticate, operatorOnly, async (req, res) => {
  try {
    const clients = await prisma.client.findMany({
      include: {
        company: true,
        user: { select: { id: true, email: true, name: true } },
        invoices: { where: { status: 'UNPAID' }, select: { amount: true } }
      },
      orderBy: { joinDate: 'desc' }
    });
    res.json(clients);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create new client
router.post('/', authenticate, operatorOnly, async (req, res) => {
  try {
    const { name, legalForm, npwp, pkpStatus, type, picName, picPhone, picEmail, plan, notes } = req.body;

    // Create company
    const company = await prisma.company.create({
      data: { name, legalForm, npwp, pkpStatus: pkpStatus === true, type: 'CLIENT', email: picEmail, phone: picPhone }
    });

    // Create portal user for client
    const tempPassword = Math.random().toString(36).slice(-8);
    const hashed = await bcrypt.hash(tempPassword, 10);
    const user = await prisma.user.create({
      data: { email: picEmail.toLowerCase(), password: hashed, name: picName, role: 'CLIENT' }
    });

    // Create client record
    const client = await prisma.client.create({
      data: {
        companyId: company.id, userId: user.id, plan: plan || 'BISNIS',
        status: 'TRIAL', picName, picPhone, picEmail, notes,
        nextBilling: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      },
      include: { company: true, user: { select: { id: true, email: true } } }
    });

    // Seed default chart of accounts for new client
    await seedDefaultAccounts(company.id);

    res.json({ client, tempPassword, message: `Klien ${name} berhasil dibuat. Password portal: ${tempPassword}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET single client
router.get('/:id', authenticate, operatorOnly, async (req, res) => {
  try {
    const client = await prisma.client.findUnique({
      where: { id: req.params.id },
      include: { company: true, user: { select: { id: true, email: true, name: true } }, invoices: true, reports: true }
    });
    if (!client) return res.status(404).json({ error: 'Klien tidak ditemukan.' });
    res.json(client);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT update client
router.put('/:id', authenticate, operatorOnly, async (req, res) => {
  try {
    const { plan, status, notes, picName, picPhone } = req.body;
    const client = await prisma.client.update({
      where: { id: req.params.id },
      data: { plan, status, notes, picName, picPhone },
      include: { company: true }
    });
    res.json(client);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function seedDefaultAccounts(companyId) {
  const defaults = [
    { code: '1000', name: 'Kas dan Bank', type: 'ASSET', category: 'Aset Lancar', normalBalance: 'DEBIT' },
    { code: '1100', name: 'Piutang Usaha', type: 'ASSET', category: 'Aset Lancar', normalBalance: 'DEBIT' },
    { code: '1200', name: 'Persediaan', type: 'ASSET', category: 'Aset Lancar', normalBalance: 'DEBIT' },
    { code: '1300', name: 'PPN Masukan', type: 'ASSET', category: 'Aset Pajak', normalBalance: 'DEBIT' },
    { code: '1500', name: 'Aset Tetap', type: 'ASSET', category: 'Aset Tidak Lancar', normalBalance: 'DEBIT' },
    { code: '1600', name: 'Akumulasi Penyusutan', type: 'ASSET', category: 'Aset Tidak Lancar', normalBalance: 'CREDIT' },
    { code: '2100', name: 'Hutang Usaha', type: 'LIABILITY', category: 'Kewajiban Lancar', normalBalance: 'CREDIT' },
    { code: '2300', name: 'PPN Keluaran', type: 'LIABILITY', category: 'Kewajiban Pajak', normalBalance: 'CREDIT' },
    { code: '2400', name: 'PPh Terutang', type: 'LIABILITY', category: 'Kewajiban Pajak', normalBalance: 'CREDIT' },
    { code: '3000', name: 'Modal Usaha', type: 'EQUITY', category: 'Ekuitas', normalBalance: 'CREDIT' },
    { code: '4000', name: 'Pendapatan Penjualan', type: 'REVENUE', category: 'Pendapatan', normalBalance: 'CREDIT' },
    { code: '5000', name: 'Harga Pokok Penjualan', type: 'EXPENSE', category: 'HPP', normalBalance: 'DEBIT' },
    { code: '5100', name: 'Beban Gaji', type: 'EXPENSE', category: 'Operasional', normalBalance: 'DEBIT' },
    { code: '6100', name: 'Beban Kantor', type: 'EXPENSE', category: 'Operasional', normalBalance: 'DEBIT' },
    { code: '6200', name: 'Beban Penyusutan', type: 'EXPENSE', category: 'Operasional', normalBalance: 'DEBIT' },
    { code: '6300', name: 'Beban Utilitas', type: 'EXPENSE', category: 'Operasional', normalBalance: 'DEBIT' },
  ];
  for (const acc of defaults) {
    await prisma.account.upsert({
      where: { companyId_code: { companyId, code: acc.code } },
      update: {},
      create: { companyId, ...acc }
    });
  }
}

module.exports = router;
