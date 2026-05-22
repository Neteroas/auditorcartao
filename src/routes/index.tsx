import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { extractTransactions, type RawTransaction } from "@/lib/pdfExtract";
import { UploadDropzone } from "@/components/audit/UploadDropzone";
import { Dashboard } from "@/components/audit/Dashboard";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Auditor · Auditoria de Faturas de Cartão" },
      { name: "description", content: "Sistema sênior de auditoria financeira: extraia, categorize e analise suas faturas de cartão de crédito em PDF com gráficos, projeção de parcelas e insights." },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400&family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" },
    ],
  }),
});

const STORAGE_KEY = "atelier-audit-txs-v1";

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
      for (const f of files) {
        const extracted = await extractTransactions(f);
        all.push(...extracted);
      }
      if (!all.length) {
        setError("Nenhum lançamento foi reconhecido no(s) PDF(s). O layout pode estar fora dos padrões suportados, ou o arquivo é uma imagem escaneada.");
      }
      setTxs((prev) => [...prev, ...all]);
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

  return (
    <div className="min-h-screen bg-background text-foreground grain">
      <div className="max-w-7xl mx-auto px-6 md:px-12 py-10 md:py-16">
        {/* Letterhead */}
        <header className="flex flex-wrap items-end justify-between gap-6 pb-6 border-b border-primary">
          <div>
            <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted-foreground">
              Est. MMXXV · Auditoria & Inteligência Financeira
            </p>
            <h1 className="font-display text-5xl md:text-7xl mt-2 leading-[0.95]">
              Auditor
            </h1>
            <p className="font-display italic text-lg text-muted-foreground mt-2">
              Um parecer sênior sobre cada lançamento da sua fatura.
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">Dossier №</p>
            <p className="font-display text-2xl tabular">
              {String(txs.length).padStart(4, "0")} <span className="text-muted-foreground">/ lançamentos</span>
            </p>
            <p className="font-mono text-[10px] text-muted-foreground mt-1">
              Processamento local · zero upload
            </p>
          </div>
        </header>

        {/* Intro / methodology */}
        <section className="mt-10">
          <UploadDropzone onFiles={handleFiles} busy={busy} />
          {error && (
            <div className="mt-4 border hairline border-destructive bg-destructive/5 p-4 text-sm">
              <p className="font-mono text-[10px] uppercase tracking-widest text-destructive">Aviso de auditoria</p>
              <p className="mt-1">{error}</p>
            </div>
          )}
        </section>

        {txs.length > 0 && <Dashboard txs={txs} onClear={handleClear} />}

        <footer className="mt-20 pt-6 border-t hairline border-rule flex flex-wrap items-center justify-between gap-3 font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
          <span>Auditor · Parecer Privado</span>
          <span>Processado no navegador · sem servidor</span>
        </footer>
      </div>
    </div>
  );
}
