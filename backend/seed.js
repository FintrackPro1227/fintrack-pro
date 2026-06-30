// backend/seed.js — Initial data setup
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // 1. Create FinTrack Pro company (operator)
  const operatorCompany = await prisma.company.upsert({
    where: { id: 'operator-company-001' },
    update: {},
    create: {
      id: 'operator-company-001',
      name: 'PT FinTrack Teknologi Indonesia',
      type: 'OPERATOR',
      legalForm: 'PT',
      npwp: '01.000.123.4-567.000',
      pkpStatus: true,
      email: 'halo@fintrackpro.id',
      phone: '08123456789',
    }
  });

  // 2. Create superadmin user
  const adminPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'FinTrack2026!', 10);
  const admin = await prisma.user.upsert({
    where: { email: process.env.ADMIN_EMAIL || 'admin@fintrackpro.id' },
    update: {},
    create: {
      email: process.env.ADMIN_EMAIL || 'admin@fintrackpro.id',
      password: adminPassword,
      name: 'Super Admin',
      role: 'SUPERADMIN',
    }
  });

  // 3. Create default accounts for operator company
  const accounts = [
    { code: '1000', name: 'Kas dan Bank', type: 'ASSET', category: 'Aset Lancar', normalBalance: 'DEBIT' },
    { code: '1100', name: 'Piutang Usaha', type: 'ASSET', category: 'Aset Lancar', normalBalance: 'DEBIT' },
    { code: '1300', name: 'PPN Masukan', type: 'ASSET', category: 'Aset Pajak', normalBalance: 'DEBIT' },
    { code: '1500', name: 'Aset Tetap', type: 'ASSET', category: 'Aset Tidak Lancar', normalBalance: 'DEBIT' },
    { code: '1600', name: 'Akumulasi Penyusutan', type: 'ASSET', category: 'Aset Tidak Lancar', normalBalance: 'CREDIT' },
    { code: '2100', name: 'Hutang Usaha', type: 'LIABILITY', category: 'Kewajiban Lancar', normalBalance: 'CREDIT' },
    { code: '2300', name: 'PPN Keluaran', type: 'LIABILITY', category: 'Kewajiban Pajak', normalBalance: 'CREDIT' },
    { code: '2400', name: 'PPh Terutang', type: 'LIABILITY', category: 'Kewajiban Pajak', normalBalance: 'CREDIT' },
    { code: '3000', name: 'Modal Usaha', type: 'EQUITY', category: 'Ekuitas', normalBalance: 'CREDIT' },
    { code: '4000', name: 'Pendapatan Layanan', type: 'REVENUE', category: 'Pendapatan', normalBalance: 'CREDIT' },
    { code: '5000', name: 'HPP', type: 'EXPENSE', category: 'HPP', normalBalance: 'DEBIT' },
    { code: '5100', name: 'Beban Gaji', type: 'EXPENSE', category: 'Operasional', normalBalance: 'DEBIT' },
    { code: '6100', name: 'Beban Kantor', type: 'EXPENSE', category: 'Operasional', normalBalance: 'DEBIT' },
    { code: '6200', name: 'Beban Penyusutan', type: 'EXPENSE', category: 'Operasional', normalBalance: 'DEBIT' },
    { code: '6300', name: 'Beban Server & Hosting', type: 'EXPENSE', category: 'Operasional', normalBalance: 'DEBIT' },
  ];

  for (const acc of accounts) {
    await prisma.account.upsert({
      where: { companyId_code: { companyId: operatorCompany.id, code: acc.code } },
      update: {},
      create: { companyId: operatorCompany.id, ...acc }
    });
  }

  // 4. Create sample bank account for operator
  await prisma.bankAccount.upsert({
    where: { id: 'bank-op-001' },
    update: {},
    create: {
      id: 'bank-op-001',
      companyId: operatorCompany.id,
      name: 'BCA 123-456-7890',
      bankName: 'Bank BCA',
      accountNo: '1234567890',
      type: 'CHECKING',
      balance: 45800000
    }
  });

  console.log('\n✅ Seed selesai!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🔑 Login admin:`);
  console.log(`   Email    : ${process.env.ADMIN_EMAIL || 'admin@fintrackpro.id'}`);
  console.log(`   Password : ${process.env.ADMIN_PASSWORD || 'FinTrack2026!'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🌐 Buka browser: http://localhost:3000`);
  console.log('');
}

main()
  .catch(e => { console.error('❌ Seed error:', e); process.exit(1); })
  .finally(async () => await prisma.$disconnect());
