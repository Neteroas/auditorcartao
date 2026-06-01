import { supabase } from "./supabase";
import type { RawTransaction, InvoiceSummary } from "./pdfExtract";

// Guarantee a unique transaction key for matching
function txKey(t: RawTransaction): string {
  return `${t.source}|${t.date}|${t.description.toLowerCase().slice(0, 40)}|${t.amount.toFixed(2)}`;
}

/** Fetch all data from Supabase for a specific user */
export async function fetchCloudData(userId: string) {
  try {
    // 1. Fetch transactions
    const { data: txsData, error: txsErr } = await supabase
      .from("card_transactions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (txsErr) throw txsErr;

    // Map database columns back to camelCase RawTransaction interface
    const txs: RawTransaction[] = (txsData || []).map((t: any) => ({
      id: t.transaction_id,
      date: t.date,
      description: t.description,
      amount: Number(t.amount),
      installment: t.installment_current && t.installment_total 
        ? { current: t.installment_current, total: t.installment_total }
        : undefined,
      category: t.category,
      source: t.source,
      invoiceDueDate: t.invoice_due_date || undefined
    }));

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
        totalAmount: Number(s.total_amount)
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
        invoice_due_date: t.invoiceDueDate || null
      }));

      const { error } = await supabase.from("card_transactions").insert(txsToInsert);
      if (error) throw error;
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
        invoice_due_date: t.invoiceDueDate || null
      }));

      const { error } = await supabase.from("card_transactions").insert(txsToInsert);
      if (error) throw error;
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
