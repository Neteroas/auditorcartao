import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envContent = fs.readFileSync('.env.local', 'utf8');
const getVar = (name) => { const m = envContent.match(new RegExp(`^${name}=(.*)$`, 'm')); return m ? m[1].trim() : null; };

const supabase = createClient(getVar('VITE_SUPABASE_URL'), getVar('VITE_SUPABASE_ANON_KEY'));

const OLD_CAT = 'Saúde';
const NEW_CAT = 'Saúde (Farmácias)';

async function main() {
  // 1. Contar transações em "Saúde"
  const { data: txs, error: fetchErr } = await supabase
    .from('card_transactions')
    .select('id, description, category')
    .eq('category', OLD_CAT);

  if (fetchErr) { console.error('Erro ao buscar transações:', fetchErr); process.exit(1); }

  console.log(`\nEncontradas ${txs.length} transações na categoria "${OLD_CAT}".`);
  if (txs.length === 0) {
    console.log('Nenhuma transação para migrar.');
  } else {
    console.log('Exemplos:', txs.slice(0, 5).map(t => `"${t.description}"`).join(', '));
  }

  // 2. Migrar todas para "Saúde (Farmácias)"
  if (txs.length > 0) {
    const BATCH = 200;
    let updated = 0;
    const ids = txs.map(t => t.id);
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      const { error: updateErr } = await supabase
        .from('card_transactions')
        .update({ category: NEW_CAT })
        .in('id', batch);
      if (updateErr) { console.error('Erro ao atualizar lote:', updateErr); process.exit(1); }
      updated += batch.length;
    }
    console.log(`\n✅ ${updated} transações migradas de "${OLD_CAT}" → "${NEW_CAT}".`);
  }

  // 3. Verificar se "Saúde" ainda tem transações (deve ser zero)
  const { data: remaining } = await supabase
    .from('card_transactions')
    .select('id')
    .eq('category', OLD_CAT);
  console.log(`\nTransações restantes em "${OLD_CAT}": ${remaining?.length ?? 0}`);

  // 4. Deletar "Saúde" da tabela card_categories (se existir como customizada)
  const { data: catRow } = await supabase
    .from('card_categories')
    .select('id, name')
    .eq('name', OLD_CAT);

  if (catRow && catRow.length > 0) {
    const { error: delErr } = await supabase
      .from('card_categories')
      .delete()
      .eq('name', OLD_CAT);
    if (delErr) console.error('Erro ao deletar categoria:', delErr);
    else console.log(`✅ Categoria "${OLD_CAT}" removida da tabela card_categories.`);
  } else {
    console.log(`ℹ️  "${OLD_CAT}" não estava na tabela card_categories (era categoria padrão do código).`);
  }

  // 5. Verificar se "Saúde (Farmácias)" está na card_categories
  const { data: newCatRow } = await supabase
    .from('card_categories')
    .select('id, name')
    .eq('name', NEW_CAT);

  if (newCatRow && newCatRow.length > 0) {
    console.log(`ℹ️  "${NEW_CAT}" já existe em card_categories. Pode ser removida pois agora será categoria padrão.`);
    const { error: delNewErr } = await supabase
      .from('card_categories')
      .delete()
      .eq('name', NEW_CAT);
    if (delNewErr) console.error('Erro ao remover da customizadas:', delNewErr);
    else console.log(`✅ "${NEW_CAT}" removida de card_categories (agora é categoria padrão no código).`);
  }

  console.log('\n🎉 Migração concluída com sucesso!');
}

main().catch(console.error);
