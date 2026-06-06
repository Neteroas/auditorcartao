import { supabase } from "./supabase";
import { sanitizeTransaction, type RawTransaction, type InvoiceSummary } from "./pdfExtract";

// Guarantee a unique transaction key for matching
function txKey(t: RawTransaction): string {
  return `${t.source}|${t.date}|${t.description.toLowerCase().slice(0, 40)}|${t.amount.toFixed(2)}`;
}

/** Fetch ALL transactions from Supabase with pagination (Supabase default limit is 1000 rows).
 * Iterates in batches of 1000 until no more rows are returned. */
async function fetchAllTransactions(userId: string): Promise<RawTransaction[]> {
  const PAGE_SIZE = 1000;
  const allRows: any[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("card_transactions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    allRows.push(...data);

    // If we got fewer rows than PAGE_SIZE, we've reached the end
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return allRows.map((t: any) => {
    const rawTx: RawTransaction = {
      id: t.transaction_id,
      date: t.date,
      description: t.description,
      amount: Number(t.amount),
      installment:
        t.installment_current && t.installment_total
          ? { current: t.installment_current, total: t.installment_total }
          : undefined,
      category: t.category,
      source: t.source,
      invoiceDueDate: t.invoice_due_date || undefined,
      isManualCategory: t.is_manual_category || false,
    };
    const sanitized = sanitizeTransaction(rawTx);
    if (sanitized.amount !== rawTx.amount || sanitized.description !== rawTx.description) {
      console.log(`[sync] Corrigindo transação corrompida na nuvem: ${sanitized.id} (${sanitized.description})`);
      supabase
        .from("card_transactions")
        .update({
          description: sanitized.description,
          amount: sanitized.amount
        })
        .match({ user_id: userId, transaction_id: sanitized.id })
        .then(({ error }) => {
          if (error) console.error("Erro ao atualizar transação corrigida na nuvem:", error);
        });
    }
    return sanitized;
  });
}

/**
 * Remove duplicate transactions from Supabase.
 * Groups all rows by the canonical txKey (source|date|description|amount).
 * For each group with > 1 row, keeps the earliest (created_at ASC) and
 * deletes the rest using the DB primary key `id`.
 * Returns the number of rows removed.
 */
export async function deduplicateCloudTransactions(userId: string): Promise<{ removed: number }> {
  const PAGE_SIZE = 1000;
  const allRows: { id: string; source: string; date: string; description: string; amount: number }[] = [];
  let from = 0;

  // Fetch only the columns needed for dedup (much lighter than full *)
  while (true) {
    const { data, error } = await supabase
      .from("card_transactions")
      .select("id, source, date, description, amount")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }) // keep the earliest
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  if (allRows.length === 0) return { removed: 0 };

  // Group by txKey; the first occurrence (already ordered by created_at) is the keeper
  const seen = new Set<string>();
  const toDelete: string[] = [];

  for (const row of allRows) {
    const key = `${row.source}|${row.date}|${String(row.description).toLowerCase().slice(0, 40)}|${Number(row.amount).toFixed(2)}`;
    if (seen.has(key)) {
      toDelete.push(row.id); // duplicate — mark for deletion
    } else {
      seen.add(key);
    }
  }

  if (toDelete.length === 0) return { removed: 0 };

  console.log(`[dedup] Removendo ${toDelete.length} transações duplicadas da nuvem…`);

  // Delete in batches of 200 (Supabase .in() limit)
  const BATCH = 200;
  for (let i = 0; i < toDelete.length; i += BATCH) {
    const { error } = await supabase
      .from("card_transactions")
      .delete()
      .in("id", toDelete.slice(i, i + BATCH))
      .eq("user_id", userId);

    if (error) throw error;
  }

  console.log(`[dedup] ${toDelete.length} duplicatas removidas com sucesso.`);
  return { removed: toDelete.length };
}

/** Fetch all data from Supabase for a specific user */
export async function fetchCloudData(userId: string) {
  try {
    // 1. Fetch ALL transactions (paginated to bypass the default 1000-row limit)
    const txs = await fetchAllTransactions(userId);

    // 2. Fetch custom categories
    const { data: catsData, error: catsErr } = await supabase
      .from("card_categories")
      .select("name")
      .eq("user_id", userId);

    if (catsErr) throw catsErr;
    const customCategories: string[] = (catsData || []).map((c: any) => c.name);

    // 3. Fetch invoice summaries
    const { data: sumsData, error: sumsErr } = await supabase
      .from("card_summaries")
      .select("*")
      .eq("user_id", userId);

    if (sumsErr) throw sumsErr;

    const summaries: Record<string, InvoiceSummary> = {};
    for (const s of sumsData || []) {
      summaries[s.source] = {
        previousBalance: Number(s.previous_balance),
        paymentsCredits: Number(s.payments_credits),
        localPurchases: Number(s.local_purchases),
        intlPurchases: Number(s.intl_purchases),
        feesAndCharges: Number(s.fees_and_charges),
        totalAmount: Number(s.total_amount),
      };
    }

    return { txs, customCategories, summaries };
  } catch (err) {
    console.error("Error fetching cloud data:", err);
    throw err;
  }
}

/** Upload local data and merge with existing cloud data */
export async function syncLocalDataToCloud(
  userId: string,
  localTxs: RawTransaction[],
  localCats: string[],
  localSums: Record<string, InvoiceSummary>,
  defaultCategories: string[]
) {
  try {
    // 1. Get existing cloud data to prevent duplicates
    const cloud = await fetchCloudData(userId);
    const cloudKeys = new Set(cloud.txs.map(txKey));

    // 2. Identify new transactions to upload
    const newTxs = localTxs.filter((t) => !cloudKeys.has(txKey(t)));
    if (newTxs.length > 0) {
      const txsToInsert = newTxs.map((t) => ({
        user_id: userId,
        transaction_id: t.id,
        date: t.date,
        description: t.description,
        amount: t.amount,
        installment_current: t.installment?.current || null,
        installment_total: t.installment?.total || null,
        category: t.category,
        source: t.source,
        invoice_due_date: t.invoiceDueDate || null,
        is_manual_category: t.isManualCategory || false,
      }));

      // Insert in batches of 500 to avoid request size limits
      const BATCH = 500;
      for (let i = 0; i < txsToInsert.length; i += BATCH) {
        const { error } = await supabase
          .from("card_transactions")
          .insert(txsToInsert.slice(i, i + BATCH));
        if (error) throw error;
      }
    }

    // 2.b Identify transactions that were manually categorized locally but differ from the cloud
    const txsToUpdate = localTxs.filter((lt) => {
      if (!lt.isManualCategory) return false;
      const ct = cloud.txs.find((c) => txKey(c) === txKey(lt));
      return ct && ct.category !== lt.category;
    });

    if (txsToUpdate.length > 0) {
      console.log("Sincronizando categorizações manuais para o Supabase:", txsToUpdate.length);
      for (const lt of txsToUpdate) {
        const ct = cloud.txs.find((c) => txKey(c) === txKey(lt));
        if (ct) {
          await supabase
            .from("card_transactions")
            .update({ category: lt.category })
            .match({ user_id: userId, transaction_id: ct.id });
        }
      }
    }

    // 3. Identify and upload custom categories (excluding defaults)
    const newCats = localCats.filter((c) => !defaultCategories.includes(c) && !cloud.customCategories.includes(c));
    console.log("Categorias customizadas para upload:", newCats);
    
    if (newCats.length > 0) {
      const catsToInsert = newCats.map((name) => ({
        user_id: userId,
        name
      }));
      // Use upsert or select to avoid duplicates
      const { error } = await supabase.from("card_categories").upsert(catsToInsert, { onConflict: "user_id,name" });
      if (error) throw error;
      console.log("Categorias upadas com sucesso:", newCats);
    }

    // 4. Upload summaries
    const sumKeys = Object.keys(localSums);
    if (sumKeys.length > 0) {
      const sumsToInsert = sumKeys.map((source) => {
        const s = localSums[source];
        return {
          user_id: userId,
          source,
          previous_balance: s.previousBalance,
          payments_credits: s.paymentsCredits,
          local_purchases: s.localPurchases,
          intl_purchases: s.intlPurchases,
          fees_and_charges: s.feesAndCharges,
          total_amount: s.totalAmount
        };
      });

      const { error } = await supabase.from("card_summaries").upsert(sumsToInsert, { onConflict: "user_id,source" });
      if (error) throw error;
    }

    // 5. Return the newly aggregated data
    return await fetchCloudData(userId);
  } catch (err) {
    console.error("Error syncing local data to cloud:", err);
    throw err;
  }
}

/** Sync a new set of transactions, categories and summaries to Supabase */
export async function uploadTransactionsToCloud(
  userId: string,
  txs: RawTransaction[],
  summaries: Record<string, InvoiceSummary>
) {
  try {
    if (txs.length > 0) {
      const txsToInsert = txs.map((t) => ({
        user_id: userId,
        transaction_id: t.id,
        date: t.date,
        description: t.description,
        amount: t.amount,
        installment_current: t.installment?.current || null,
        installment_total: t.installment?.total || null,
        category: t.category,
        source: t.source,
        invoice_due_date: t.invoiceDueDate || null,
        is_manual_category: t.isManualCategory || false,
      }));

      // Insert in batches of 500 to avoid request size limits
      const BATCH = 500;
      for (let i = 0; i < txsToInsert.length; i += BATCH) {
        const { error } = await supabase
          .from("card_transactions")
          .insert(txsToInsert.slice(i, i + BATCH));
        if (error) throw error;
      }
    }

    const sumKeys = Object.keys(summaries);
    if (sumKeys.length > 0) {
      const sumsToInsert = sumKeys.map((source) => {
        const s = summaries[source];
        return {
          user_id: userId,
          source,
          previous_balance: s.previousBalance,
          payments_credits: s.paymentsCredits,
          local_purchases: s.localPurchases,
          intl_purchases: s.intlPurchases,
          fees_and_charges: s.feesAndCharges,
          total_amount: s.totalAmount
        };
      });

      const { error } = await supabase.from("card_summaries").upsert(sumsToInsert, { onConflict: "user_id,source" });
      if (error) throw error;
    }
  } catch (err) {
    console.error("Error uploading transactions:", err);
    throw err;
  }
}

/** Bulk-fix historic LojasClaroFoz records in Supabase */
export async function fixHistoricLojasClaroFozCategory(userId: string) {
  try {
    const { error } = await supabase
      .from("card_transactions")
      .update({ category: "Telefonia (Planos/Aparelhos)" })
      .match({ user_id: userId, category: "Vestuário" })
      .ilike("description", "%lojasc%larofoz%foz%iguac%");

    if (error) throw error;
  } catch (err) {
    console.error("Error fixing historic LojasClaroFoz categories:", err);
    throw err;
  }
}

/** Update the category of a transaction in Supabase */
export async function updateTransactionCategoryInCloud(userId: string, transactionId: string, category: string) {
  try {
    const { error } = await supabase
      .from("card_transactions")
      .update({ category })
      .match({ user_id: userId, transaction_id: transactionId });

    if (error) throw error;
  } catch (err) {
    console.error("Error updating transaction category in cloud:", err);
    throw err;
  }
}

/** Remove all transactions and summaries of a specific source (PDF filename) */
export async function removeSourceFromCloud(userId: string, source: string) {
  try {
    const { error: txsErr } = await supabase
      .from("card_transactions")
      .delete()
      .match({ user_id: userId, source });

    if (txsErr) throw txsErr;

    const { error: sumsErr } = await supabase
      .from("card_summaries")
      .delete()
      .match({ user_id: userId, source });

    if (sumsErr) throw sumsErr;
  } catch (err) {
    console.error("Error removing source from cloud:", err);
    throw err;
  }
}

/** Add a new custom category to Supabase */
export async function addCategoryToCloud(userId: string, name: string) {
  try {
    const { error } = await supabase
      .from("card_categories")
      .upsert({ user_id: userId, name }, { onConflict: "user_id,name" });

    if (error) throw error;
  } catch (err) {
    console.error("Error adding category to cloud:", err);
    throw err;
  }
}

/** Rename custom category in user_categories and in all matching transactions */
export async function renameCategoryInCloud(userId: string, oldName: string, newName: string) {
  try {
    // 1. Upsert new category
    const { error: catAddErr } = await supabase
      .from("card_categories")
      .upsert({ user_id: userId, name: newName }, { onConflict: "user_id,name" });
    if (catAddErr) throw catAddErr;

    // 2. Update matching transactions
    const { error: txsErr } = await supabase
      .from("card_transactions")
      .update({ category: newName })
      .match({ user_id: userId, category: oldName });
    if (txsErr) throw txsErr;

    // 3. Delete old custom category entry
    const { error: catDelErr } = await supabase
      .from("card_categories")
      .delete()
      .match({ user_id: userId, name: oldName });
    if (catDelErr) throw catDelErr;
  } catch (err) {
    console.error("Error renaming category in cloud:", err);
    throw err;
  }
}

/** Delete all transactions and summaries of a specific user */
export async function clearAllCloudData(userId: string) {
  try {
    const { error: txsErr } = await supabase
      .from("card_transactions")
      .delete()
      .match({ user_id: userId });
    if (txsErr) throw txsErr;

    const { error: sumsErr } = await supabase
      .from("card_summaries")
      .delete()
      .match({ user_id: userId });
    if (sumsErr) throw sumsErr;
  } catch (err) {
    console.error("Error clearing cloud data:", err);
    throw err;
  }
}

/** Migrate all transactions with city names (except Foz do Iguaçu) to "Compras Online" category
 * BUT: Respects custom categories - only recategorizes transactions in DEFAULT categories
 */
export async function fixOnlinePurchasesByCity(userId: string) {
  try {
    // Fetch custom categories to know which ones to preserve
    const { data: customCatsData, error: catsErr } = await supabase
      .from("card_categories")
      .select("name")
      .eq("user_id", userId);

    if (catsErr) throw catsErr;
    
    const customCategories = new Set((customCatsData || []).map((c: any) => c.name));
    console.log("Custom categories to preserve:", Array.from(customCategories));
    
    const DEFAULT_CATEGORIES = [
      "Ifood / Restaurantes", "Alimentação", "Mercados / Panificadoras", "Transporte", "Assinaturas", "Compras Online",
      "Saúde", "Vestuário", "Lazer", "Viagem", "Educação", "Serviços", "Telefonia (Planos/Aparelhos)", "Tarifas",
      "Pagamentos/Créditos", "Outros"
    ];
    
    const CITY_PATTERNS = [
      "sao paulo", "rio de janeiro", "belo horizonte", "brasilia", "curitiba", "porto alegre",
      "salvador", "fortaleza", "recife", "manaus", "goiania", "campinas", "santos", "sorocaba",
      "guarulhos", "osasco", "diadema", "mogi cruzes", "atibaia", "ribeirao preto", "matao",
      "araraquara", "piracicaba", "presidente prudente", "aracatuba", "bauru", "jundiai", "franca",
      "botucatu", "jau", "blumenau", "itajai", "joinville", "florianopolis", "chapeco", "santa maria",
      "caxias do sul", "vicosa", "campina grande", "joao pessoa", "aracaju", "maceio", "teresina",
      "natal", "parnamirim", "petrolina", "juazeiro", "feira de santana", "ilheus", "belem",
      "santarem", "maraba", "castanhal", "ananindeua", "parauapebas", "novo repartimento", "altamira",
      "tucurui", "macapa", "boa vista", "itabuna", "jequie", "teixeira de freitas", "victoria da conquista",
      "pouso alegre", "uberaba", "divinopolis", "contagem", "betim", "sete lagoas", "ipatinga",
      "governador valadares", "montes claros", "ituiutaba", "muriae", "barbacena", "ouro preto",
      "mariana", "congonhas", "itabira", "tres coracoes", "varginha", "juiz de fora", "unai",
      "patos de minas", "araguari", "uberlandia", "itumbiara", "catalao", "jatai", "rio verde",
      "morrinhos", "anapolis", "aparecida de goiania", "luziania", "formosa", "cristalina",
      "cidade ocidental", "planaltina", "aguas lindas de goias", "gama", "taguatinga", "ceilandia",
      "samambaia", "riacho fundo", "sobradinho", "guara", "nucleo bandeirante", "recanto das emas",
      "aguas claras", "sao sebastiao", "paranoa", "itapoa", "sao goncalo", "duque de caxias",
      "niteroi", "sao joao de meriti", "nova iguazu", "mesquita", "nilopolis", "marica",
      "sao pedro da aldeia", "araruama", "cabo frio", "buzios", "iguaba grande", "casimiro de abreu",
      "rio das flores", "silva jardim", "carmo", "conceicao de macabu", "macae", "campos dos goitacazes",
      "quissama", "carapebus", "cardoso moreira", "italva", "itaperuna", "bom jesus do itabapoana",
      "natividade", "miracema", "porciunciula", "santo antonio de padua", "sao fidelis",
      "sao jose do calcado", "barra de sao francisco", "coracaozinho", "coracao de jesus",
      "indaiatuba", "cajamar", "uniao da vitoria",
    ];

    // Fetch all transactions for this user that need migration
    const { data: txsData, error: fetchErr } = await supabase
      .from("card_transactions")
      .select("id, description, category")
      .eq("user_id", userId)
      .neq("category", "Compras Online");

    if (fetchErr) throw fetchErr;

    if (!txsData || txsData.length === 0) return { updated: 0 };

    let updateCount = 0;

    // Process each transaction
    for (const tx of txsData) {
      const desc = tx.description.toLowerCase();
      
      // ✅ IMPORTANTE: Skip if already in a custom category (preserve user's choices!)
      if (customCategories.has(tx.category)) {
        console.log(`Skipping ${tx.id}: already in custom category "${tx.category}"`);
        continue;
      }

      // Skip if Foz do Iguaçu
      if (desc.includes("foz") && desc.includes("iguac")) {
        continue;
      }

      // Check if any city pattern matches
      let found = false;
      for (const city of CITY_PATTERNS) {
        if (desc.includes(city)) {
          found = true;
          break;
        }
      }

      // Additional pattern: detect city-like patterns (e.g., "CORACAO DE J BR", "UNIO DA VITR BR")
      // These are typically city names in abbreviated form
      if (!found) {
        const cityLikePattern = /\b[a-z]{3,}\s+(?:de\s+)?[a-z]{1,2}\b.*br\b/;
        if (cityLikePattern.test(desc)) {
          found = true;
        }
      }

      if (found) {
        const { error: updateErr } = await supabase
          .from("card_transactions")
          .update({ category: "Compras Online" })
          .eq("id", tx.id)
          .eq("user_id", userId);

        if (updateErr) {
          console.error(`Error updating transaction ${tx.id}:`, updateErr);
        } else {
          updateCount++;
        }
      }
    }

    console.log(`Migrated ${updateCount} transactions to "Compras Online"`);
    return { updated: updateCount };
  } catch (err) {
    console.error("Error fixing online purchases by city:", err);
    throw err;
  }
}

/** Recategorize all transactions using updated categorization logic */
export async function recategorizeAllTransactions(userId: string) {
  try {
    // Import the categorize function
    const { categorize } = await import("./pdfExtract");

    // Fetch custom categories to preserve user's manual choices
    const { data: customCatsData, error: catsErr } = await supabase
      .from("card_categories")
      .select("name")
      .eq("user_id", userId);
    if (catsErr) throw catsErr;
    const customCategories = new Set((customCatsData || []).map((c: any) => c.name));

    // Fetch ALL transactions for this user
    const { data: txsData, error: fetchErr } = await supabase
      .from("card_transactions")
      .select("id, description, amount, category")
      .eq("user_id", userId);

    if (fetchErr) throw fetchErr;

    if (!txsData || txsData.length === 0) {
      console.log("No transactions to recategorize");
      return { updated: 0 };
    }

    let updateCount = 0;

    // Process each transaction
    for (const tx of txsData) {
      // ✅ Preserve user's manual classification into custom categories
      if (customCategories.has(tx.category)) {
        continue;
      }

      const correctCategory = categorize(tx.description, tx.amount);

      // Only update if category differs
      if (tx.category !== correctCategory) {
        const { error: updateErr } = await supabase
          .from("card_transactions")
          .update({ category: correctCategory })
          .eq("id", tx.id)
          .eq("user_id", userId);

        if (updateErr) {
          console.error(`Error updating transaction ${tx.id}:`, updateErr);
        } else {
          console.log(`Recategorized: "${tx.description}" from "${tx.category}" to "${correctCategory}"`);
          updateCount++;
        }
      }

    }

    console.log(`Recategorized ${updateCount} transactions total`);
    return { updated: updateCount };
  } catch (err) {
    console.error("Error recategorizing transactions:", err);
    throw err;
  }
}

/**
 * Bulk-recategorize all transactions whose description starts with "UBER*" or "99APP*"
 * to the "Transporte" category.
 * Respects is_manual_category = true (never overwrites user's explicit choices).
 * Returns the number of rows updated.
 */
export async function bulkRecategorizeTransport(userId: string): Promise<{ updated: number }> {
  try {
    // Fetch all transactions that are NOT already "Transporte" and NOT manually categorized
    const { data: txsData, error: fetchErr } = await supabase
      .from("card_transactions")
      .select("id, description, category, is_manual_category")
      .eq("user_id", userId)
      .neq("category", "Transporte");

    if (fetchErr) throw fetchErr;
    if (!txsData || txsData.length === 0) return { updated: 0 };

    // Filter locally: match UBER* or 99APP* patterns (case-insensitive)
    const TRANSPORT_PATTERN = /^(uber\s*\*|99\s*app\s*\*|99app)/i;

    const toUpdate = txsData.filter((tx: any) => {
      if (tx.is_manual_category) return false; // preserve manual choices
      return TRANSPORT_PATTERN.test(tx.description?.trim() ?? "");
    });

    if (toUpdate.length === 0) {
      console.log("[bulkTransport] Nenhuma transação encontrada para recategorizar.");
      return { updated: 0 };
    }

    console.log(`[bulkTransport] Recategorizando ${toUpdate.length} transações para "Transporte"…`);

    // Update in batches of 200
    const BATCH = 200;
    let updated = 0;
    for (let i = 0; i < toUpdate.length; i += BATCH) {
      const ids = toUpdate.slice(i, i + BATCH).map((tx: any) => tx.id);
      const { error: updateErr } = await supabase
        .from("card_transactions")
        .update({ category: "Transporte", is_manual_category: true })
        .in("id", ids)
        .eq("user_id", userId);

      if (updateErr) throw updateErr;
      updated += ids.length;
    }

    console.log(`[bulkTransport] ${updated} transações recategorizadas com sucesso.`);
    return { updated };
  } catch (err) {
    console.error("Erro ao recategorizar transações de transporte:", err);
    throw err;
  }
}

/**
 * Bulk-update the category (and mark as manual) for a specific list of
 * transaction_id values. Used when the user opts to propagate a manual
 * category change to similar transactions across all invoices.
 */
export async function bulkUpdateCategoryByIds(
  userId: string,
  transactionIds: string[],
  category: string
): Promise<{ updated: number }> {
  if (transactionIds.length === 0) return { updated: 0 };

  const BATCH = 200;
  let updated = 0;

  for (let i = 0; i < transactionIds.length; i += BATCH) {
    const batch = transactionIds.slice(i, i + BATCH);
    const { error } = await supabase
      .from("card_transactions")
      .update({ category, is_manual_category: true })
      .in("transaction_id", batch)
      .eq("user_id", userId);

    if (error) throw error;
    updated += batch.length;
  }

  console.log(`[propagate] ${updated} lançamentos similares atualizados para "${category}".`);
  return { updated };
}

/**
 * Checks all card_transactions in the database for the user that have an invoice_due_date.
 * If the due date doesn't end with "-11", updates it in bulk (grouped by old date) to end with "-11".
 * Also recategorizes any Sanepar transactions still sitting in "Serviços" or "Outros" to "Serviços"
 * so existing cloud records pick up the new keyword.
 */
export async function fixCloudInvoiceDueDates(userId: string): Promise<{ updated: number }> {
  try {
    const { data, error } = await supabase
      .from("card_transactions")
      .select("invoice_due_date")
      .eq("user_id", userId)
      .not("invoice_due_date", "is", null);

    if (error) throw error;

    const uniqueDates = Array.from(new Set((data || []).map(d => d.invoice_due_date)));
    let updatedCount = 0;

    for (const oldDate of uniqueDates) {
      if (oldDate && /^\d{4}-\d{2}-\d{2}$/.test(oldDate)) {
        const parts = oldDate.split('-');
        if (parts[2] !== '11') {
          const newDate = `${parts[0]}-${parts[1]}-11`;
          const { error: updateErr, count } = await supabase
            .from("card_transactions")
            .update({ invoice_due_date: newDate })
            .eq("user_id", userId)
            .eq("invoice_due_date", oldDate);
          
          if (updateErr) throw updateErr;
          updatedCount += count || 0;
        }
      }
    }
    
    if (updatedCount > 0) {
      console.log(`[fixDates] Corrigidos ${updatedCount} lançamentos para o vencimento dia 11.`);
    }

    // Fix Sanepar: ensure cloud records are in "Serviços" (not "Outros")
    // Only touch non-manually-categorized transactions
    const { error: saneErr } = await supabase
      .from("card_transactions")
      .update({ category: "Serviços" })
      .eq("user_id", userId)
      .eq("is_manual_category", false)
      .ilike("description", "%sanepar%");
    
    if (saneErr) console.error("[fixDates] Sanepar recategorization error:", saneErr);

    return { updated: updatedCount };
  } catch (err) {
    console.error("Erro ao corrigir datas de vencimento no cloud:", err);
    throw err;
  }
}
