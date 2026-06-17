import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { extractData, categorize, sanitizeTransaction, type RawTransaction, type InvoiceSummary } from "@/lib/pdfExtract";
import { UploadDropzone } from "@/components/audit/UploadDropzone";
import { Dashboard } from "@/components/audit/Dashboard";
import { AuthModal } from "@/components/audit/AuthModal";
import { supabase, supabaseEnabled } from "@/lib/supabase";
import {
  addCategoryToCloud,
  bulkRecategorizeBasicBills,
  bulkRecategorizeTransport,
  bulkUpdateCategoryByIds,
  clearAllCloudData,
  deduplicateCloudTransactions,
  fixCloudInvoiceDueDates,
  renameCategoryInCloud,
  removeSourceFromCloud,
  syncLocalDataToCloud,
  updateTransactionCategoryInCloud,
} from "@/lib/supabaseSync";
import { extractDateFromFilename } from "@/lib/pdfExtract";
import { ShieldCheck, Cpu, Lock } from "lucide-react";

/** Force transaction due date day to 11 if it ends in another day */
function fixInvoiceDueDate(t: RawTransaction): RawTransaction {
  if (t.invoiceDueDate && /^\d{4}-\d{2}-\d{2}$/.test(t.invoiceDueDate)) {
    const parts = t.invoiceDueDate.split('-');
    if (parts[2] !== '11') {
      return {
        ...t,
        invoiceDueDate: `${parts[0]}-${parts[1]}-11`
      };
    }
  }
  return t;
}

export const Route = createFileRoute("/")(

  {
    component: Index,
    head: () => ({
      meta: [
        { title: "Auditor de Cartões · Inteligência e Auditoria de Cartão de Crédito" },
        { name: "description", content: "Sistema sênior de auditoria financeira: extraia, categorize e analise suas faturas de cartão de crédito em PDF com gráficos, projeção de parcelas e insights inteligentes." },
      ],
      links: [
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,600&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap",
        },
      ],
    }),
  },
);

const STORAGE_KEY = "atelier-audit-txs-v1";
const CATEGORIES_KEY = "atelier-audit-categories-v1";
const SUMMARIES_KEY = "atelier-audit-summaries-v1";

export const DEFAULT_CATEGORIES = [
  "Mercados / Panificadoras", "Compras Online", "Ifood", "Transporte", "Saúde (Farmácias)",
  "Telefonia (Planos/Aparelhos)", "Tarifas", "Assinaturas", "Copel / Sanepar / Gás",
  "Outros", "Pagamentos/Créditos"
];

const LOJAS_CLARO_FOZ_PATTERN = /lojasc?larofoz.*foz\s+do\s+iguac|foz\s+do\s+iguac.*lojasc?larofoz/i;
const TELEFONIA_CATEGORY = "Telefonia (Planos/Aparelhos)";

function normalizeHistoricTransactionCategory(t: RawTransaction): RawTransaction {
  let category = t.category;
  if (category === "Mercado") {
    category = "Mercados / Panificadoras";
  } else if (category === "Vestuário" && LOJAS_CLARO_FOZ_PATTERN.test(t.description)) {
    category = TELEFONIA_CATEGORY;
  } else if (category === "Contas Básicas (Copel/Sanepar)") {
    category = "Copel / Sanepar / Gás";
  } else if (category === "Ifood / Restaurantes") {
    category = "Ifood";
  } else if (category === "Saúde") {
    category = "Saúde (Farmácias)";
  }
  return { ...t, category };
}

/** Fix transaction categories using the updated categorization logic.
 *  Preserves user-customized categories (anything outside DEFAULT_CATEGORIES
 *  or anything the user kept in their custom categories list). */
function fixLocalTransactionCategories(
  txs: RawTransaction[],
  customCategories: Set<string> = new Set(),
): RawTransaction[] {
  return txs.map((t) => {
    if (t.isManualCategory) return t;
    // Never overwrite a transaction the user moved into a custom category
    if (customCategories.has(t.category)) return t;
    const recalculatedCategory = categorize(t.description, t.amount);
    if (t.category !== recalculatedCategory) {
      return { ...t, category: recalculatedCategory };
    }
    return t;
  });
}


/** Chave única por transação: garante que a mesma transação nunca seja contada duas vezes */
function txKey(t: RawTransaction): string {
  return `${t.source}|${t.date}|${t.description.toLowerCase().slice(0, 40)}|${t.amount.toFixed(2)}`;
}

/**
 * Normaliza a descrição de um lançamento para identificar o mesmo
 * estabelecimento entre faturas diferentes, ignorando códigos de pedido/cliente.
 * Ex: "TIM*TIM 459997617" e "TIM*TIM 123456789" → "tim*tim"
 */
function descriptionKey(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/\d{4,}/g, '')      // remove sequências de 4+ dígitos (códigos de pedido)
    .replace(/[^a-záàâãéèêíïóôõöúüç\*]/g, ' ')  // mantém letras e *
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 35);
}

interface PropagationData {
  newCategory: string;
  merchantLabel: string;   // descrição legível para o modal
  similarTxs: RawTransaction[];
}

function mergeCategories(
  defaultCategories: string[],
  localCategories: string[],
  cloudCategories: string[]
) {
  const customLocal = localCategories.filter((c) => !defaultCategories.includes(c));
  const customCloud = cloudCategories.filter((c) => !defaultCategories.includes(c));
  // IMPORTANTE: Manter TODAS as categorias locais customizadas + as da nuvem
  // Nunca perder uma categoria que o usuário criou localmente!
  return [...defaultCategories, ...Array.from(new Set([...customLocal, ...customCloud]))];
}

function filterActiveCategories(categories: string[], txs: RawTransaction[]): string[] {
  // 1. Normalizar nomes
  let normalized = categories.map((c) => {
    if (c === "Mercado") return "Mercados / Panificadoras";
    if (c === "Contas Básicas (Copel/Sanepar)") return "Copel / Sanepar / Gás";
    if (c === "Ifood / Restaurantes") return "Ifood";
    if (c === "Saúde") return "Saúde (Farmácias)";
    return c;
  });

  // 2. Filtrar categorias vazias indesejadas
  const categoriesWithData = new Set(txs.map((t) => t.category));
  const emptyCategoriesToRemove = new Set([
    "Ifood / Restaurantes",
    "Alimentação",
    "Saúde",
    "Contas Básicas (Copel/Sanepar)",
    "Duplicada-reaproveitar",
    "Diversos",
    "Vestuário",
    "Lazer",
    "Viagem",
    "Educação",
    "Serviços"
  ]);

  normalized = normalized.filter((c) => {
    if (categoriesWithData.has(c)) return true;
    if (emptyCategoriesToRemove.has(c)) return false;
    return true;
  });

  // 3. Garantir os novos defaults
  DEFAULT_CATEGORIES.forEach((c) => {
    if (!normalized.includes(c)) {
      normalized.push(c);
    }
  });

  return Array.from(new Set(normalized));
}

function Index() {
  const [txs, setTxs] = useState<RawTransaction[]>([]);
  const [confirmPropagation, setConfirmPropagation] = useState<PropagationData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categoriesList, setCategoriesList] = useState<string[]>(DEFAULT_CATEGORIES);
  const [summaries, setSummaries] = useState<Record<string, InvoiceSummary>>({});
  const [user, setUser] = useState<User | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<string>("Local");
  const hasImportedData = txs.length > 0 || Object.keys(summaries).length > 0;

  // Refs to always access the latest state inside async callbacks / intervals
  // without stale closure issues
  const txsRef = useRef<RawTransaction[]>([]);
  const summariesRef = useRef<Record<string, InvoiceSummary>>({});
  const categoriesRef = useRef<string[]>(DEFAULT_CATEGORIES);
  const userRef = useRef<User | null>(null);
  // Tracks whether the one-time dedup has already run this session
  const dedupDoneRef = useRef<boolean>(false);

  useEffect(() => {
    let loadedTxs: RawTransaction[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        // Read custom categories first so we don't clobber them when recategorizing
        let customCats = new Set<string>();
        try {
          const rawCats = localStorage.getItem(CATEGORIES_KEY);
          if (rawCats) {
            const parsed: string[] = JSON.parse(rawCats);
            customCats = new Set(parsed.filter((c) => !DEFAULT_CATEGORIES.includes(c)));
          }
        } catch {}

        loadedTxs = JSON.parse(raw);
        loadedTxs = loadedTxs.map(normalizeHistoricTransactionCategory).map(sanitizeTransaction).map(fixInvoiceDueDate);
        // Apply the new categorization logic to fix categories (commented out to preserve manual categorization)
        // loadedTxs = fixLocalTransactionCategories(loadedTxs, customCats);
        setTxs(loadedTxs);
      }
    } catch {
      setTxs([]);
    }


    try {
      const rawCats = localStorage.getItem(CATEGORIES_KEY);
      if (rawCats) {
        const parsed = JSON.parse(rawCats);
        const cleaned = filterActiveCategories(parsed, loadedTxs);
        setCategoriesList(cleaned);
      } else {
        setCategoriesList(DEFAULT_CATEGORIES);
      }
    } catch {
      setCategoriesList(DEFAULT_CATEGORIES);
    }

    try {
      const rawSums = localStorage.getItem(SUMMARIES_KEY);
      if (rawSums) setSummaries(JSON.parse(rawSums));
    } catch {
      setSummaries({});
    }

    async function restoreSession() {
      if (!supabaseEnabled) {
        setCloudStatus("Modo local (Supabase não configurado)");
        return;
      }
      try {
        const { data } = await supabase.auth.getSession();
        const currentUser = data.session?.user ?? null;
        if (currentUser) {
          setUser(currentUser);
          setCloudStatus("Sincronizando com a nuvem...");
          await synchronizeCloud(currentUser.id);
        }
      } catch (err: any) {
        console.error("Erro ao verificar sessão Supabase:", err);
        setCloudStatus("Erro de conexão");
      }
    }

    restoreSession();
  }, []);

  // Keep refs in sync so async callbacks always see latest state
  useEffect(() => {
    txsRef.current = txs;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(txs));
  }, [txs]);

  useEffect(() => {
    categoriesRef.current = categoriesList;
    localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categoriesList));
  }, [categoriesList]);

  useEffect(() => {
    summariesRef.current = summaries;
    localStorage.setItem(SUMMARIES_KEY, JSON.stringify(summaries));
  }, [summaries]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Sincronização automática periódica (a cada 60s) se logado
  useEffect(() => {
    if (!user || !supabaseEnabled) return;

    const syncInterval = setInterval(() => {
      synchronizeCloud(user.id);
    }, 60000); // A cada 60 segundos

    return () => clearInterval(syncInterval);
  }, [user, supabaseEnabled]);

  async function synchronizeCloud(userId: string) {
    if (!supabaseEnabled) {
      setError("Supabase não está configurado");
      setCloudStatus("Modo local (Supabase não configurado)");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Run dedup exactly once per session (cleans up ghosts created by the
      // old 1000-row pagination bug without repeated overhead on every 60s tick)
      if (!dedupDoneRef.current) {
        dedupDoneRef.current = true;
        setCloudStatus("Verificando duplicatas na nuvem...");
        const { removed } = await deduplicateCloudTransactions(userId);
        if (removed > 0) {
          console.log(`[sync] Dedup removeu ${removed} lançamentos duplicados.`);
        }

        // Recategorize UBER* and 99APP* transactions to "Transporte" (one-time per session)
        setCloudStatus("Corrigindo categorias de transporte...");
        const { updated: transportUpdated } = await bulkRecategorizeTransport(userId);
        if (transportUpdated > 0) {
          console.log(`[sync] ${transportUpdated} transações recategorizadas para "Transporte".`);
        }

        // Recategorize basic bills (Sanepar, Copel, etc.) to "Copel / Sanepar / Gás" (one-time per session)
        setCloudStatus("Corrigindo categorias de contas básicas...");
        const { updated: billsUpdated } = await bulkRecategorizeBasicBills(userId);
        if (billsUpdated > 0) {
          console.log(`[sync] ${billsUpdated} transações recategorizadas para "Copel / Sanepar / Gás".`);
        }

        // Correct invoice due dates to end with 11 (one-time per session)
        setCloudStatus("Corrigindo datas de vencimento...");
        const { updated: datesUpdated } = await fixCloudInvoiceDueDates(userId);
        if (datesUpdated > 0) {
          console.log(`[sync] ${datesUpdated} transações corrigidas para o vencimento dia 11.`);
        }
      }

      // Always read from refs so we never use stale closure state
      const currentTxs = txsRef.current;
      const currentCats = categoriesRef.current;
      const currentSums = summariesRef.current;

      setCloudStatus("Sincronizando com a nuvem...");
      const cloud = await syncLocalDataToCloud(userId, currentTxs, currentCats, currentSums, DEFAULT_CATEGORIES);
      
      const normalizedTxs = cloud.txs.map(normalizeHistoricTransactionCategory).map(sanitizeTransaction).map(fixInvoiceDueDate);
      setTxs(normalizedTxs);
      setSummaries(cloud.summaries);
      
      const mergedCats = mergeCategories(DEFAULT_CATEGORIES, currentCats, cloud.customCategories);
      setCategoriesList(filterActiveCategories(mergedCats, normalizedTxs));
      setCloudStatus("Dados sincronizados com a nuvem");
    } catch (err: any) {
      setError(err?.message || "Não foi possível sincronizar com a nuvem.");
      setCloudStatus("Erro de sincronização");
    } finally {
      setBusy(false);
    }
  }

  function handleAuthSuccess(loggedUser: User) {
    setUser(loggedUser);
    setShowAuthModal(false);
    synchronizeCloud(loggedUser.id);
  }

  async function handleFiles(files: File[]) {
    setBusy(true);
    setError(null);
    try {
      // Always read from ref to avoid stale closure (e.g. auto-sync may have updated txs)
      const currentTxs = txsRef.current;
      const currentSums = summariesRef.current;
      const currentCats = categoriesRef.current;

      const all: RawTransaction[] = [];
      const newSummaries: Record<string, InvoiceSummary> = {};
      const alreadyImported: string[] = [];
      // Track sources that were reimported so we can strip old records
      const reimportedSources = new Set<string>();

      for (const f of files) {
        const extracted = await extractData(f);
        if (extracted.summary) {
          newSummaries[f.name] = extracted.summary;
        }

        const existingTxCount = currentTxs.filter((t) => t.source === f.name).length;

        if (extracted.transactions.length === 0) {
          // PDF extracted nothing — warn but don't silently swallow
          if (existingTxCount === 0) {
            // No existing records and nothing new — truly empty or unrecognised layout
            if (!extracted.summary) {
              setError(`Nenhum lançamento foi reconhecido em: ${f.name}. O layout pode estar fora dos padrões suportados, ou o arquivo é uma imagem escaneada.`);
            }
          }
          // If there were existing records, keep them as-is (don't strip on failed re-extract)
          continue;
        }

        if (existingTxCount > 0) {
          // File already has transactions in state.
          // Treat as a deliberate reimport: strip old records for this source
          // and replace with freshly extracted ones to avoid ghost duplicates.
          reimportedSources.add(f.name);
        }

        all.push(...extracted.transactions);
      }

      // Build the updated transaction list:
      // 1. Keep all existing txs EXCEPT those from reimported sources
      // 2. Add freshly extracted txs (deduplicated against what remains)
      const keptTxs = currentTxs.filter((t) => !reimportedSources.has(t.source));
      const keptKeys = new Set(keptTxs.map(txKey));
      const newUnique = all.filter((t) => !keptKeys.has(txKey(t)));
      const updatedTxs = [...keptTxs, ...newUnique].map(normalizeHistoricTransactionCategory).map(fixInvoiceDueDate);

      const updatedSummaries = Object.keys(newSummaries).length > 0
        ? { ...currentSums, ...newSummaries }
        : currentSums;

      if (alreadyImported.length > 0) {
        setError(
          `Arquivo(s) já importado(s): ${alreadyImported.join(", ")}. ` +
          `Use "Limpar análise" se quiser apagar tudo e reimportar do zero.`
        );
      }

      setTxs(updatedTxs);
      setSummaries(updatedSummaries);

      if (userRef.current) {
        // If we reimported sources, first remove them from cloud to avoid stale ghost records
        for (const src of reimportedSources) {
          await removeSourceFromCloud(userRef.current.id, src);
        }

        const cloud = await syncLocalDataToCloud(
          userRef.current.id,
          updatedTxs,
          currentCats,
          updatedSummaries,
          DEFAULT_CATEGORIES
        );
        const mappedTxs = cloud.txs.map(normalizeHistoricTransactionCategory).map(sanitizeTransaction).map(fixInvoiceDueDate);
        setTxs(mappedTxs);
        setSummaries(cloud.summaries);
        setCategoriesList(filterActiveCategories(mergeCategories(DEFAULT_CATEGORIES, currentCats, cloud.customCategories), mappedTxs));
        setCloudStatus("Dados sincronizados com a nuvem");
      }
    } catch (e: any) {
      setError(e?.message || "Falha ao processar PDF.");
    } finally {
      setBusy(false);
    }
  }

  function handleClear() {
    setTxs([]);
    setSummaries({});
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SUMMARIES_KEY);

    if (user) {
      const confirmed = window.confirm("Você está conectado à nuvem. Deseja também limpar os dados na nuvem?");
      if (confirmed) {
        setBusy(true);
        clearAllCloudData(user.id)
          .then(() => {
            setCloudStatus("Nuvem limpa");
          })
          .catch((err: any) => {
            setError(err?.message || "Não foi possível limpar os dados na nuvem.");
          })
          .finally(() => {
            setBusy(false);
          });
      }
    }
  }

  function handleRemoveSource(source: string) {
    // Update local state immediately
    setTxs((prev) => prev.filter((t) => t.source !== source));
    setSummaries((prev) => {
      const next = { ...prev };
      delete next[source];
      return next;
    });
    // Also update refs right away so that any concurrent async (sync timer, reimport)
    // sees the removal immediately without waiting for the next render cycle
    txsRef.current = txsRef.current.filter((t) => t.source !== source);
    const nextSums = { ...summariesRef.current };
    delete nextSums[source];
    summariesRef.current = nextSums;

    if (userRef.current) {
      removeSourceFromCloud(userRef.current.id, source).catch((err: any) =>
        setError(err?.message || "Falha ao remover fonte na nuvem.")
      );
    }
  }

  function handleUpdateCategory(id: string, newCategory: string) {
    // Find the transaction before updating state (txsRef.current is still pre-update here)
    const changedTx = txsRef.current.find((t) => t.id === id);

    // 1. Apply the change to this transaction immediately
    setTxs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, category: newCategory, isManualCategory: true } : t))
    );
    if (user) {
      updateTransactionCategoryInCloud(user.id, id, newCategory).catch((err: any) =>
        setError(err?.message || "Falha ao atualizar categoria na nuvem.")
      );
    }

    if (!changedTx) return;

    // 2. Find similar transactions across all invoices (same merchant, different category)
    const key = descriptionKey(changedTx.description);
    if (!key || key.length < 2) return;

    const similar = txsRef.current.filter((t) => {
      if (t.id === id) return false;              // skip the one we just changed
      if (t.category === newCategory) return false; // already correct
      // Don't override another manual choice that was set to a *different* category
      if (t.isManualCategory && t.category !== changedTx.category) return false;
      return descriptionKey(t.description) === key;
    });

    if (similar.length > 0) {
      setConfirmPropagation({
        newCategory,
        merchantLabel: changedTx.description,
        similarTxs: similar,
      });
    }
  }

  function applyPropagation() {
    if (!confirmPropagation) return;
    const { newCategory, similarTxs } = confirmPropagation;
    const ids = similarTxs.map((t) => t.id);

    setTxs((prev) =>
      prev.map((t) =>
        ids.includes(t.id) ? { ...t, category: newCategory, isManualCategory: true } : t
      )
    );

    if (user) {
      bulkUpdateCategoryByIds(user.id, ids, newCategory).catch((err: any) =>
        setError(err?.message || "Falha ao propagar categoria na nuvem.")
      );
    }

    setConfirmPropagation(null);
  }

  function handleAddCategory(name: string) {
    const trimmed = name.trim();
    if (!trimmed || categoriesList.includes(trimmed)) return;
    setCategoriesList((prev) => [...prev, trimmed]);
    if (user) {
      addCategoryToCloud(user.id, trimmed).catch((err: any) => setError(err?.message || "Falha ao salvar categoria na nuvem."));
    }
  }

  function handleRenameCategory(oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName || categoriesList.includes(trimmed)) return;
    setCategoriesList((prev) => prev.map((c) => (c === oldName ? trimmed : c)));
    setTxs((prev) =>
      prev.map((t) => (t.category === oldName ? { ...t, category: trimmed, isManualCategory: true } : t))
    );
    if (user) {
      renameCategoryInCloud(user.id, oldName, trimmed).catch((err: any) => setError(err?.message || "Falha ao renomear categoria na nuvem."));
    }
  }

  async function handleSignOut() {
    if (!user) return;
    await supabase.auth.signOut();
    setUser(null);
    setCloudStatus("Local");
  }

  return (
    <div className="min-h-screen bg-background text-foreground grain">
      {/* Top navigation bar */}
      <nav className="sticky top-0 z-50 border-b border-border/60 bg-white/80 backdrop-blur-xl backdrop-saturate-150 no-print">
        <div className="max-w-7xl mx-auto px-6 md:px-12 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="size-7 rounded-lg bg-primary flex items-center justify-center shadow-sm shadow-primary/30">
              <ShieldCheck className="size-4 text-white" strokeWidth={2.5} />
            </div>
            <span className="font-display font-700 text-base tracking-tight text-foreground">
              Auditor<span className="text-primary">.</span>
            </span>
          </div>

          <div className="flex items-center gap-4">
            {/* Status de Sincronização Compacto na Barra de Navegação */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/40 border border-border/40 text-[11px] font-semibold text-muted-foreground shadow-sm">
              <span className={`size-1.5 rounded-full flex-shrink-0 ${
                cloudStatus.includes("Erro") 
                  ? "bg-destructive animate-pulse"
                  : cloudStatus.includes("Modo local") || cloudStatus.includes("Local")
                  ? "bg-amber-500"
                  : cloudStatus.includes("Sincronizando")
                  ? "bg-primary animate-pulse"
                  : "bg-emerald-500"
              }`} />
              
              <span className="max-w-[120px] sm:max-w-none truncate text-[10px] sm:text-xs">
                {cloudStatus.replace("Dados sincronizados com a nuvem", "Nuvem Sincronizada")}
              </span>
              
              {user && supabaseEnabled && (
                <button
                  onClick={() => synchronizeCloud(user.id)}
                  disabled={busy}
                  className="p-1 rounded-md hover:bg-white/80 active:scale-95 disabled:opacity-50 transition-all text-foreground/75 hover:text-foreground"
                  title="Sincronizar agora"
                >
                  <svg className={`size-3.5 ${busy ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                  </svg>
                </button>
              )}
            </div>

            <button
              onClick={() => setShowAuthModal(true)}
              className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground bg-white border border-border/60 hover:border-primary/30 px-3 py-2.5 rounded-lg transition-all duration-200 shadow-sm"
            >
              {user ? "Desconectar" : "Sincronizar com a nuvem"}
            </button>
            {user && (
              <button
                onClick={handleSignOut}
                className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground bg-white border border-border/60 hover:border-destructive/30 px-3 py-2.5 rounded-lg transition-all duration-200 shadow-sm"
              >
                Sair
              </button>
            )}
          </div>
        </div>
      </nav>

      <div className={`max-w-7xl mx-auto px-6 md:px-12 ${hasImportedData ? 'py-6 md:py-8' : 'py-12 md:py-16'}`}>
        {!hasImportedData ? (
          <>
            {/* Hero header */}
            <header className="mb-12">
              <div className="flex flex-wrap items-start justify-between gap-8">
                <div className="max-w-2xl">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="pill-accent pill text-[11px]">
                      <Cpu className="size-2.5" /> {user ? "Dados sincronizados com a nuvem" : "100% local · zero upload"}
                    </span>
                  </div>
                  <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-800 leading-[1.05] tracking-tight">
                    Auditoria inteligente{" "}
                    <span className="text-primary">das suas faturas</span>
                  </h1>
                  <p className="text-lg text-muted-foreground mt-4 leading-relaxed font-normal max-w-lg">
                    Importe seus PDFs de cartão de crédito e obtenha análises detalhadas de gastos, parcelas futuras e detecção automática de cobranças duplicadas.
                  </p>
                </div>
              </div>
            </header>

            {/* Upload section */}
            <section>
              <UploadDropzone onFiles={handleFiles} busy={busy} />
              
              {/* Aviso se não logado */}
              <div className="mt-4 space-y-3">
                
                {/* Aviso se não logado */}
                {!user && supabaseEnabled && hasImportedData && (
                  <div className="border border-amber-500/25 bg-amber-500/5 p-4 rounded-sm">
                    <p className="text-xs font-semibold text-amber-700 mb-2">⚠️ Dados locais apenas</p>
                    <p className="text-xs text-amber-700/80 mb-3">
                      Seus dados estão salvos apenas neste navegador. Faça login para sincronizar com sua conta e acessar em outros dispositivos.
                    </p>
                    <button
                      onClick={() => setShowAuthModal(true)}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded transition-colors"
                    >
                      Fazer Login para Sincronizar
                    </button>
                  </div>
                )}
              </div>

              {error && (
                <div className="mt-4 rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm flex gap-3">
                  <div className="size-5 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-destructive text-[10px] font-bold">!</span>
                  </div>
                  <div>
                    <p className="font-semibold text-destructive text-xs uppercase tracking-wide mb-1">Aviso de auditoria</p>
                    <p className="text-foreground/80">{error}</p>
                  </div>
                </div>
              )}
            </section>
          </>
        ) : (
          <section>
            
            {/* Aviso se não logado e tem dados */}
            {!user && supabaseEnabled && hasImportedData && (
              <div className="mb-6 border border-amber-500/25 bg-amber-500/5 p-4 rounded-sm no-print">
                <p className="text-xs font-semibold text-amber-700 mb-2">⚠️ Dados locais apenas</p>
                <p className="text-xs text-amber-700/80 mb-3">
                  Seus dados estão salvos apenas neste navegador. Faça login para sincronizar com sua conta e acessar em outros dispositivos.
                </p>
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded transition-colors"
                >
                  Fazer Login para Sincronizar
                </button>
              </div>
            )}

            {error && (
              <div className="mb-8 rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm flex gap-3">
                <div className="size-5 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-destructive text-[10px] font-bold">!</span>
                </div>
                <div>
                  <p className="font-semibold text-destructive text-xs uppercase tracking-wide mb-1">Aviso de auditoria</p>
                  <p className="text-foreground/80">{error}</p>
                </div>
              </div>
            )}
            <Dashboard
              txs={txs}
              onClear={handleClear}
              onUpdateCategory={handleUpdateCategory}
              categoriesList={categoriesList}
              onAddCategory={handleAddCategory}
              onRenameCategory={handleRenameCategory}
              summaries={summaries}
              onRemoveSource={handleRemoveSource}
              headerActions={<UploadDropzone onFiles={handleFiles} busy={busy} compact />}
            />
          </section>
        )}

        <footer className="mt-20 pt-6 border-t border-border/50 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground no-print">
          <span className="font-medium">Auditor · Auditoria Privada de Cartões</span>
        </footer>
      </div>

      {showAuthModal && <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} onSuccess={handleAuthSuccess} />}
      {confirmPropagation && (
        <PropagationModal
          data={confirmPropagation}
          summaries={summaries}
          txs={txs}
          onApplyAll={applyPropagation}
          onKeepOne={() => setConfirmPropagation(null)}
        />
      )}
    </div>
  );
}

/* ── Propagation Modal ── */
const MONTH_ABBR_PT = ["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"];

function formatInvoiceLabel(source: string, txs: RawTransaction[]): string {
  // Try to get the due date from a transaction in this source
  const sample = txs.find((t) => t.source === source && t.invoiceDueDate);
  const dateStr = sample?.invoiceDueDate || extractDateFromFilename(source);
  if (dateStr && /^\d{4}-\d{2}/.test(dateStr)) {
    const [y, m] = dateStr.split("-");
    const mIdx = parseInt(m, 10) - 1;
    const abbr = MONTH_ABBR_PT[mIdx] ?? m;
    return `${abbr}/${y.slice(2)}`;
  }
  // Fallback: strip extension
  return source.replace(/\.[^/.]+$/, "").slice(0, 30);
}

function PropagationModal({
  data,
  summaries: _summaries,
  txs,
  onApplyAll,
  onKeepOne,
}: {
  data: PropagationData;
  summaries: Record<string, import("@/lib/pdfExtract").InvoiceSummary>;
  txs: RawTransaction[];
  onApplyAll: () => void;
  onKeepOne: () => void;
}) {
  const { newCategory, merchantLabel, similarTxs } = data;

  // Group similar txs by invoice source
  const bySource = similarTxs.reduce<Record<string, RawTransaction[]>>((acc, t) => {
    if (!acc[t.source]) acc[t.source] = [];
    acc[t.source].push(t);
    return acc;
  }, {});

  const sources = Object.keys(bySource).sort();

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onKeepOne}
      />

      {/* Modal card */}
      <div
        className="relative bg-white rounded-2xl shadow-2xl border border-border/60 w-full max-w-md overflow-hidden"
        style={{ animation: "slideUp 0.22s cubic-bezier(0.34,1.26,0.64,1) both" }}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-start gap-3">
            <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <svg className="size-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h10M7 12h6m-6 5h10M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5z" />
              </svg>
            </div>
            <div>
              <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1">
                Propagar categoria
              </p>
              <h3 className="font-display text-base font-700 leading-snug text-foreground">
                Lançamentos similares encontrados
              </h3>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Encontramos <span className="font-semibold text-foreground">{similarTxs.length}</span> lançamento{similarTxs.length !== 1 ? "s" : ""} similares a{" "}
            <span className="font-semibold text-foreground">"{merchantLabel}"</span> em outras faturas.
          </p>

          {/* Category badge */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Nova categoria:</span>
            <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-primary/10 text-primary font-semibold text-xs">
              {newCategory}
            </span>
          </div>

          {/* Affected invoices */}
          <div className="rounded-xl border border-border/50 overflow-hidden bg-muted/20">
            <div className="px-4 py-2.5 border-b border-border/30 bg-muted/30">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                Faturas afetadas
              </p>
            </div>
            <div className="divide-y divide-border/20">
              {sources.map((src) => {
                const count = bySource[src].length;
                const label = formatInvoiceLabel(src, txs);
                return (
                  <div key={src} className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <svg className="size-3.5 text-muted-foreground flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-xs font-semibold text-foreground truncate">{label}</span>
                      <span className="text-[10px] text-muted-foreground font-medium flex-shrink-0">
                        ({src.replace(/\.[^/.]+$/, "").slice(0, 22)})
                      </span>
                    </div>
                    <span className="ml-3 flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-md bg-primary/10 text-primary">
                      {count} lanç.
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 flex flex-col sm:flex-row gap-2.5">
          <button
            onClick={onApplyAll}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary/90 active:scale-[0.98] transition-all duration-150 shadow-sm shadow-primary/25"
          >
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Aplicar a Todos
          </button>
          <button
            onClick={onKeepOne}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-border/60 text-sm font-semibold text-muted-foreground rounded-xl hover:text-foreground hover:border-foreground/30 active:scale-[0.98] transition-all duration-150 shadow-sm"
          >
            Manter Apenas Este
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(24px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)     scale(1); }
        }
      `}</style>
    </div>
  );
}
