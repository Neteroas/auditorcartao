import { useCallback, useRef, useState } from "react";
import { Upload, Loader2, FileText } from "lucide-react";

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
      className={`relative cursor-pointer border hairline border-rule bg-card transition-all ${
        hover ? "ring-2 ring-accent" : ""
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
      <div className="grid grid-cols-12 gap-0">
        <div className="col-span-12 md:col-span-3 border-r hairline border-rule p-8 bg-muted/40 flex flex-col justify-between">
          <span className="stamp">Doc · 01</span>
          <div className="mt-8">
            <p className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">Formato aceito</p>
            <p className="font-display text-2xl mt-1">PDF</p>
            <p className="font-mono text-[10px] text-muted-foreground mt-4">FATURAS · CARTÕES · MULTI-ARQUIVO</p>
          </div>
        </div>
        <div className="col-span-12 md:col-span-9 p-12 flex flex-col items-center justify-center text-center min-h-[260px]">
          {busy ? (
            <>
              <Loader2 className="size-10 animate-spin text-primary" />
              <p className="font-display text-2xl mt-4">Auditando documentos…</p>
              <p className="font-mono text-xs text-muted-foreground mt-2 tracking-wider">EXTRAINDO · CLASSIFICANDO · RECONCILIANDO</p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 text-muted-foreground">
                <FileText className="size-5" />
                <Upload className="size-5" />
              </div>
              <p className="font-display text-3xl md:text-4xl mt-6 leading-tight max-w-md">
                Arraste suas faturas <em className="text-accent not-italic">aqui</em>
              </p>
              <p className="text-sm text-muted-foreground mt-3 max-w-sm">
                Ou clique para selecionar PDFs. Os dados são processados localmente, no seu navegador.
              </p>
              <div className="mt-8 flex items-center gap-6 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
                <span>· Privado</span><span>· Offline</span><span>· Multi-banco</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
