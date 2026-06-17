import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envContent = fs.readFileSync('.env.local', 'utf8');
const getVar = (name) => { const m = envContent.match(new RegExp(`^${name}=(.*)$`, 'm')); return m ? m[1].trim() : null; };

const supabase = createClient(getVar('VITE_SUPABASE_URL'), getVar('VITE_SUPABASE_ANON_KEY'));

async function main() {
  const { data: txs, error: txErr } = await supabase
    .from('card_transactions')
    .select('*');

  if (txErr) {
    console.error('Error fetching transactions:', txErr);
    return;
  }

  const copelTxs = txs.filter(t => t.description.toLowerCase().includes('copel'));
  console.log('--- COPEL TRANSACTIONS ---');
  copelTxs.forEach(t => {
    console.log(`ID: ${t.id} | Desc: ${t.description} | Amt: ${t.amount} | Date: ${t.date} | InvoiceDueDate: ${t.invoice_due_date} | Curr: ${t.installment_current} | Total: ${t.installment_total}`);
  });

  console.log('\n--- ALL INSTALLMENTS IN DB ---');
  const installments = txs.filter(t => t.installment_total || t.installment_current);
  installments.forEach(t => {
    console.log(`Desc: ${t.description} | Amt: ${t.amount} | Date: ${t.date} | InvoiceDueDate: ${t.invoice_due_date} | ${t.installment_current}/${t.installment_total}`);
  });
}
main().catch(console.error);
