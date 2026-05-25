import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { extractTransactions, type RawTransaction } from "@/lib/pdfExtract";
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

/** Chave única por transação: garante que a mesma transação nunca seja contada duas vezes,
 *  mesmo que o mesmo PDF seja reimportado acidentalmente. */
function txKey(t: RawTransaction): string {
  return `${t.source}|${t.date}|${t.description.toLowerCase().slice(0, 40)}|${t.amount.toFixed(2)}`;
}

function Index() {
  const [txs, setTxs] = useState<RawTransaction[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setTxs(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    if (txs.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(txs));
  }, [txs]);

  async function handleFiles(files: File[]) {
    setBusy(true);
    setError(null);
    try {
      const all: RawTransaction[] = [];
      const alreadyImported: string[] = [];

      for (const f of files) {
        // Verificar se este arquivo já foi importado anteriormente
        const alreadyExists = txs.some((t) => t.source === f.name);
        if (alreadyExists) {
          alreadyImported.push(f.name);
          continue; // Pular este arquivo
        }
        const extracted = await extractTransactions(f);
        all.push(...extracted);
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
        setTxs((prev) => {
          // Deduplicar pela chave composta: mesmo source+data+desc+valor nunca entra duas vezes
          const existingKeys = new Set(prev.map(txKey));
          const newUnique = all.filter((t) => !existingKeys.has(txKey(t)));
          return [...prev, ...newUnique];
        });
      }
    } catch (e: any) {
      setError(e?.message || "Falha ao processar PDF.");
    } finally {
      setBusy(false);
    }
  }

  function handleClear() {
    setTxs([]);
    localStorage.removeItem(STORAGE_KEY);
  }

  function handleUpdateCategory(id: string, newCategory: string) {
    setTxs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, category: newCategory } : t))
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
              Processamento local · privado
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
