import { useCallback, useRef, useState } from "react";
import { Upload, Loader2, FileText, ShieldCheck, Zap, Building2 } from "lucide-react";

interface Props {
  onFiles: (files: File[]) => Promise<void>;
  busy: boolean;
}

export function UploadDropzone({ onFiles, busy }: Props) {
  const [hover, setHover] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = useCallback(
    async (files: FileList | null) => {
      if (!files) return;
      const pdfs = Array.from(files).filter((f) => f.type === "application/pdf" || f.name.endsWith(".pdf"));
      if (pdfs.length) await onFiles(pdfs);
    },
    [onFiles],
  );

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setHover(true); }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => { e.preventDefault(); setHover(false); handle(e.dataTransfer.files); }}
      onClick={() => inputRef.current?.click()}
      className={`relative cursor-pointer glass-card card-accent-top overflow-hidden transition-all duration-300 ${
        hover
          ? "ring-2 ring-primary/30 border-primary/25 scale-[1.005] shadow-[0_8px_40px_oklch(0.47_0.21_270_/_0.12)]"
          : ""
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        multiple
        className="hidden"
        onChange={(e) => handle(e.target.files)}
      />

      {busy ? (
        /* ── Busy state ── */
        <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
          <div className="relative size-20 mb-6">
            <div className="absolute inset-0 rounded-full bg-primary/10 animate-pulse" />
            <div className="relative size-20 rounded-full bg-white border border-primary/20 flex items-center justify-center shadow-sm">
              <Loader2 className="size-8 text-primary animate-spin" />
            </div>
          </div>
          <h3 className="font-display text-xl font-700 text-foreground">Auditando faturas…</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-xs">
            Extraindo lançamentos, classificando categorias e calculando totais.
          </p>
          <div className="flex items-center gap-2 mt-5">
            {["Extraindo", "Analisando", "Reconciliando"].map((s, i) => (
              <span key={s} className="pill text-[10px]" style={{ animationDelay: `${i * 0.15}s` }}>{s}</span>
            ))}
          </div>
        </div>
      ) : (
        /* ── Idle state ── */
        <div className="flex flex-col md:flex-row">
          {/* Left panel */}
          <div className="md:w-64 flex-shrink-0 border-b md:border-b-0 md:border-r border-border/50 p-8 bg-gradient-to-br from-primary/5 to-accent/5 flex flex-col justify-between">
            <div>
              <div className="size-10 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center mb-4">
                <FileText className="size-5 text-primary" />
              </div>
              <h3 className="font-display text-sm font-700 text-foreground leading-snug">
                Análise de Faturas PDF
              </h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Nubank, Itaú, Bradesco, XP, C6 e outros.
              </p>
            </div>
            <div className="mt-8 space-y-3">
              {[
                { icon: ShieldCheck, label: "100% privado", sub: "Nada é enviado" },
                { icon: Zap, label: "Processamento local", sub: "Instant, offline" },
                { icon: Building2, label: "Multi-banco", sub: "Todos os formatos" },
              ].map(({ icon: Icon, label, sub }) => (
                <div key={label} className="flex items-start gap-2.5">
                  <div className="size-6 rounded-md bg-white border border-border/60 flex items-center justify-center flex-shrink-0 shadow-sm">
                    <Icon className="size-3.5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground leading-none">{label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right panel */}
          <div className="flex-1 flex flex-col items-center justify-center p-10 md:p-14 text-center min-h-[260px]">
            {/* Upload icon with animated ring */}
            <div className="relative mb-6">
              {hover && (
                <div className="absolute inset-0 -m-3 rounded-full border-2 border-dashed border-primary/40 animate-spin" style={{ animationDuration: "3s" }} />
              )}
              <div className={`size-16 rounded-2xl flex items-center justify-center transition-all duration-300 shadow-sm border ${
                hover
                  ? "bg-primary text-white border-primary scale-110 shadow-primary/25"
                  : "bg-white text-primary border-border/60"
              }`}>
                <Upload className="size-7" strokeWidth={1.75} />
              </div>
            </div>

            <h2 className="font-display text-2xl md:text-3xl font-700 leading-tight tracking-tight">
              Arraste seus PDFs{" "}
              <span className="text-primary">aqui</span>
            </h2>
            <p className="text-sm text-muted-foreground mt-3 max-w-xs leading-relaxed">
              Ou clique para selecionar os arquivos. Múltiplas faturas são suportadas ao mesmo tempo.
            </p>

            <button
              type="button"
              className="mt-7 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-primary/25 hover:bg-primary/90 transition-all duration-200 hover:shadow-primary/35 hover:shadow-md pointer-events-none"
            >
              <Upload className="size-4" />
              Selecionar faturas
            </button>

            <p className="text-[10px] text-muted-foreground/70 mt-4">
              Suporta PDF · Nubank, Itaú, Bradesco, XP, C6 e outros
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
