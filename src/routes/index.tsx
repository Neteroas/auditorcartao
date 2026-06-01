import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { extractData, categorize, type RawTransaction, type InvoiceSummary } from "@/lib/pdfExtract";
import { UploadDropzone } from "@/components/audit/UploadDropzone";
import { Dashboard } from "@/components/audit/Dashboard";
import { AuthModal } from "@/components/audit/AuthModal";
import { supabase, supabaseEnabled } from "@/lib/supabase";
import {
  addCategoryToCloud,
  clearAllCloudData,
  fixHistoricLojasClaroFozCategory,
  fixOnlinePurchasesByCity,
  recategorizeAllTransactions,
  renameCategoryInCloud,
  removeSourceFromCloud,
  syncLocalDataToCloud,
  updateTransactionCategoryInCloud,
} from "@/lib/supabaseSync";
import { ShieldCheck, Cpu, Lock } from "lucide-react";

export const Route = createFileRoute("/")(
  {
    component: Index,
    head: () => ({
      meta: [
        { title: "Auditor · Inteligência e Auditoria de Cartão de Crédito" },
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
  "Ifood / Restaurantes", "Alimentação", "Mercados / Panificadoras", "Transporte", "Assinaturas", "Compras Online",
  "Saúde", "Vestuário", "Lazer", "Viagem", "Educação", "Serviços", "Telefonia (Planos/Aparelhos)", "Tarifas",
  "Pagamentos/Créditos", "Outros"
];

const LOJAS_CLARO_FOZ_PATTERN = /lojasc?larofoz.*foz\s+do\s+iguac|foz\s+do\s+iguac.*lojasc?larofoz/i;
const TELEFONIA_CATEGORY = "Telefonia (Planos/Aparelhos)";

function normalizeHistoricTransactionCategory(t: RawTransaction): RawTransaction {
  if (t.category === "Vestuário" && LOJAS_CLARO_FOZ_PATTERN.test(t.description)) {
    return { ...t, category: TELEFONIA_CATEGORY };
  }
  return t;
}

/** Fix transaction categories using the updated categorization logic */
function fixLocalTransactionCategories(txs: RawTransaction[]): RawTransaction[] {
  return txs.map((t) => {
    const recalculatedCategory = categorize(t.description, t.amount);
    // Only update if the recalculated category differs from current
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

function Index() {
  const [txs, setTxs] = useState<RawTransaction[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categoriesList, setCategoriesList] = useState<string[]>(DEFAULT_CATEGORIES);
  const [summaries, setSummaries] = useState<Record<string, InvoiceSummary>>({});
  const [user, setUser] = useState<User | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<string>("Local");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        let loadedTxs = JSON.parse(raw);
        loadedTxs = loadedTxs.map((t: any) => {
          let tx = t;
          if (tx.category === "Mercado") {
            tx = { ...tx, category: "Mercados / Panificadoras" };
          }
          if (tx.category === "Vestuário" && LOJAS_CLARO_FOZ_PATTERN.test(tx.description)) {
            tx = { ...tx, category: TELEFONIA_CATEGORY };
          }
          return tx;
        });
        // Apply the new categorization logic to fix categories
        loadedTxs = fixLocalTransactionCategories(loadedTxs);
        setTxs(loadedTxs);
      }
    } catch {
      setTxs([]);
    }

    try {
      const rawCats = localStorage.getItem(CATEGORIES_KEY);
      if (rawCats) {
        let loaded = JSON.parse(rawCats);
        loaded = loaded.map((c: string) => c === "Mercado" ? "Mercados / Panificadoras" : c);

        if (!loaded.includes("Pagamentos/Créditos")) {
          const idx = loaded.indexOf("Outros");
          if (idx !== -1) loaded.splice(idx, 0, "Pagamentos/Créditos");
          else loaded.push("Pagamentos/Créditos");
        }
        if (!loaded.includes("Ifood / Restaurantes")) {
          const idx = loaded.indexOf("Alimentação");
          if (idx !== -1) loaded.splice(idx, 0, "Ifood / Restaurantes");
          else loaded.unshift("Ifood / Restaurantes");
        }
        setCategoriesList(loaded);
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

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(txs));
  }, [txs]);

  useEffect(() => {
    localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categoriesList));
  }, [categoriesList]);

  useEffect(() => {
    localStorage.setItem(SUMMARIES_KEY, JSON.stringify(summaries));
  }, [summaries]);

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
      await fixHistoricLojasClaroFozCategory(userId);
      // DESABILITADO: fixOnlinePurchasesByCity estava recategorizando automaticamente 
      // transações com nomes de cidades para "Compras Online", apagando categorias customizadas
      // await fixOnlinePurchasesByCity(userId);
      await recategorizeAllTransactions(userId);
      
      console.log("Categorias locais ANTES de sincronizar:", categoriesList);
      
      const cloud = await syncLocalDataToCloud(userId, txs, categoriesList, summaries, DEFAULT_CATEGORIES);
      
      console.log("Categorias do Supabase após sincronizar:", cloud.customCategories);
      
      const normalizedTxs = cloud.txs.map(normalizeHistoricTransactionCategory);
      setTxs(normalizedTxs);
      setSummaries(cloud.summaries);
      
      const mergedCats = mergeCategories(DEFAULT_CATEGORIES, categoriesList, cloud.customCategories);
      console.log("Categorias FINAIS após merge:", mergedCats);
      
      setCategoriesList(mergedCats);
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
      const all: RawTransaction[] = [];
      const newSummaries: Record<string, InvoiceSummary> = {};
      const alreadyImported: string[] = [];

      for (const f of files) {
        const alreadyExists = txs.some((t) => t.source === f.name);

        const extracted = await extractData(f);
        if (extracted.summary) {
          newSummaries[f.name] = extracted.summary;
        }

        if (alreadyExists) {
          alreadyImported.push(f.name);
          continue;
        }

        all.push(...extracted.transactions);
      }

      if (alreadyImported.length > 0) {
        setError(
          `Arquivo(s) já importado(s) anteriormente e ignorado(s) para evitar duplicatas: ${alreadyImported.join(", ")}. ` +
          `Use "Limpar análise" se quiser reimportar do zero.`
        );
      }

      if (!all.length && alreadyImported.length === 0) {
        setError("Nenhum lançamento foi reconhecido no(s) PDF(s). O layout pode estar fora dos padrões suportados, ou o arquivo é uma imagem escaneada.");
      }

      if (all.length > 0) {
        const existingKeys = new Set(txs.map(txKey));
        const newUnique = all.filter((t) => !existingKeys.has(txKey(t)));
        if (newUnique.length > 0) {
          setTxs((prev) => [...prev, ...newUnique]);
        }
      }

      if (Object.keys(newSummaries).length > 0) {
        setSummaries((prev) => ({ ...prev, ...newSummaries }));
      }

      if (user) {
        const updatedTxs = [...txs, ...all.filter((t) => !new Set(txs.map(txKey)).has(txKey(t)))];
        const updatedSummaries = Object.keys(newSummaries).length > 0 ? { ...summaries, ...newSummaries } : summaries;
        const cloud = await syncLocalDataToCloud(user.id, updatedTxs, categoriesList, updatedSummaries, DEFAULT_CATEGORIES);
        setTxs(cloud.txs);
        setSummaries(cloud.summaries);
        setCategoriesList(mergeCategories(DEFAULT_CATEGORIES, categoriesList, cloud.customCategories));
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
    setTxs((prev) => prev.filter((t) => t.source !== source));
    setSummaries((prev) => {
      const next = { ...prev };
      delete next[source];
      return next;
    });
    if (user) {
      removeSourceFromCloud(user.id, source).catch((err: any) => setError(err?.message || "Falha ao remover fonte na nuvem."));
    }
  }

  function handleUpdateCategory(id: string, newCategory: string) {
    setTxs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, category: newCategory } : t))
    );
    if (user) {
      updateTransactionCategoryInCloud(user.id, id, newCategory).catch((err: any) => setError(err?.message || "Falha ao atualizar categoria na nuvem."));
    }
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
      prev.map((t) => (t.category === oldName ? { ...t, category: trimmed } : t))
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
      <nav className="sticky top-0 z-50 border-b border-border/60 bg-white/80 backdrop-blur-xl backdrop-saturate-150">
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
            <div className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Lock className="size-3" />
              {user ? "Modo Nuvem" : "Modo Local"}
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

      <div className="max-w-7xl mx-auto px-6 md:px-12 py-12 md:py-16">
        {txs.length === 0 ? (
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
              
              {/* Status de sincronização com botão */}
              <div className="mt-4 space-y-3">
                {cloudStatus && (
                  <div className={`border p-4 flex items-center justify-between gap-3 text-xs rounded-sm ${
                    cloudStatus.includes("Erro") 
                      ? "border-destructive/25 bg-destructive/5 text-destructive"
                      : cloudStatus.includes("Modo local")
                      ? "border-warning/25 bg-warning/5 text-warning"
                      : "border-primary/25 bg-primary/5 text-primary"
                  }`}>
                    <span className="font-semibold">{cloudStatus}</span>
                    {user && supabaseEnabled && (
                      <button
                        onClick={() => synchronizeCloud(user.id)}
                        disabled={busy}
                        className="px-3 py-1.5 rounded bg-current/20 hover:bg-current/30 disabled:opacity-50 text-xs font-semibold whitespace-nowrap transition-colors"
                      >
                        {busy ? "Sincronizando..." : "Sincronizar Agora"}
                      </button>
                    )}
                  </div>
                )}
                
                {/* Aviso se não logado */}
                {!user && supabaseEnabled && txs.length > 0 && (
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
            {cloudStatus && (
              <div className={`mb-6 border p-4 flex items-center justify-between gap-3 text-xs rounded-sm ${
                cloudStatus.includes("Erro") 
                  ? "border-destructive/25 bg-destructive/5 text-destructive"
                  : cloudStatus.includes("Modo local")
                  ? "border-warning/25 bg-warning/5 text-warning"
                  : "border-primary/25 bg-primary/5 text-primary"
              }`}>
                <span className="font-semibold">{cloudStatus}</span>
                {user && supabaseEnabled && (
                  <button
                    onClick={() => synchronizeCloud(user.id)}
                    disabled={busy}
                    className="px-3 py-1.5 rounded bg-current/20 hover:bg-current/30 disabled:opacity-50 text-xs font-semibold whitespace-nowrap transition-colors"
                  >
                    {busy ? "Sincronizando..." : "Sincronizar Agora"}
                  </button>
                )}
              </div>
            )}
            
            {/* Aviso se não logado e tem dados */}
            {!user && supabaseEnabled && txs.length > 0 && (
              <div className="mb-6 border border-amber-500/25 bg-amber-500/5 p-4 rounded-sm">
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

        <footer className="mt-20 pt-6 border-t border-border/50 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="font-medium">Auditor · Auditoria Privada de Cartões</span>
          <span className="flex items-center gap-1.5">
            <Lock className="size-3" />
            Processado no navegador · sem servidor · sem cookies
          </span>
        </footer>
      </div>

      {showAuthModal && <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} onSuccess={handleAuthSuccess} />}
    </div>
  );
}
