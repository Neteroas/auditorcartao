import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { extractData, type RawTransaction, type InvoiceSummary } from "@/lib/pdfExtract";
import { UploadDropzone } from "@/components/audit/UploadDropzone";
import { Dashboard } from "@/components/audit/Dashboard";
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
});

const STORAGE_KEY = "atelier-audit-txs-v1";
const CATEGORIES_KEY = "atelier-audit-categories-v1";
const SUMMARIES_KEY = "atelier-audit-summaries-v1";

export const DEFAULT_CATEGORIES = [
  "Ifood / Restaurantes", "Alimentação", "Mercados / Panificadoras", "Transporte", "Assinaturas", "Compras Online",
  "Saúde", "Vestuário", "Lazer", "Viagem", "Educação", "Serviços", "Tarifas",
  "Pagamentos/Créditos", "Outros"
];

/** Chave única por transação: garante que a mesma transação nunca seja contada duas vezes */
function txKey(t: RawTransaction): string {
  return `${t.source}|${t.date}|${t.description.toLowerCase().slice(0, 40)}|${t.amount.toFixed(2)}`;
}

function Index() {
  const [txs, setTxs] = useState<RawTransaction[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categoriesList, setCategoriesList] = useState<string[]>(DEFAULT_CATEGORIES);
  const [summaries, setSummaries] = useState<Record<string, InvoiceSummary>>({});

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        let loadedTxs = JSON.parse(raw);
        loadedTxs = loadedTxs.map((t: any) => {
          if (t.category === "Mercado") {
            return { ...t, category: "Mercados / Panificadoras" };
          }
          return t;
        });
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
  }

  function handleRemoveSource(source: string) {
    setTxs((prev) => prev.filter((t) => t.source !== source));
    setSummaries((prev) => {
      const next = { ...prev };
      delete next[source];
      return next;
    });
  }

  function handleUpdateCategory(id: string, newCategory: string) {
    setTxs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, category: newCategory } : t))
    );
  }

  function handleAddCategory(name: string) {
    const trimmed = name.trim();
    if (!trimmed || categoriesList.includes(trimmed)) return;
    setCategoriesList((prev) => [...prev, trimmed]);
  }

  function handleRenameCategory(oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName || categoriesList.includes(trimmed)) return;
    setCategoriesList((prev) => prev.map((c) => (c === oldName ? trimmed : c)));
    setTxs((prev) =>
      prev.map((t) => (t.category === oldName ? { ...t, category: trimmed } : t))
    );
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
              Modo Local
            </div>

            {txs.length > 0 && (
              <span className="pill">
                <span className="tabular font-mono">{txs.length}</span> lançamentos
              </span>
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
                      <Cpu className="size-2.5" /> 100% local · zero upload
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
    </div>
  );
}
