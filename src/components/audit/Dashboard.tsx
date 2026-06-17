import { useMemo, useRef, useState } from "react";
import { extractDateFromFilename, type RawTransaction, type InvoiceSummary } from "@/lib/pdfExtract";
import {
  aggregateByCategory,
  aggregateByMonth,
  fmtBRL,
  generateInsights,
  projectFutureInstallments,
  getSortValue,
  type MonthAgg,
} from "@/lib/analytics";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, PieChart, Pie, Cell, Area, AreaChart,
} from "recharts";
import {
  TrendingUp, TrendingDown, AlertTriangle, Sparkles,
  CheckCircle2, Calendar, Trash2, BarChart2, Tag, CreditCard,
  ChevronRight, ArrowUpRight, ArrowDownRight, Smartphone,
  Utensils, ShoppingCart, Car, Stethoscope, Tv, Ticket,
  GraduationCap, Briefcase, Zap, ShieldAlert, CarFront, ListFilter,
  Plus, Pencil, Check, X, Info, Download, FileText
} from "lucide-react";

interface Props {
  txs: RawTransaction[];
  onClear: () => void;
  onUpdateCategory?: (id: string, newCategory: string) => void;
  categoriesList: string[];
  onAddCategory: (name: string) => void;
  onRenameCategory: (oldName: string, newName: string) => void;
  summaries: Record<string, InvoiceSummary>;
  onRemoveSource?: (source: string) => void;
  headerActions?: React.ReactNode;
}

const CHART_COLORS = [
  "oklch(0.47 0.21 270)",
  "oklch(0.54 0.18 295)",
  "oklch(0.62 0.15 200)",
  "oklch(0.76 0.13 72)",
  "oklch(0.55 0.16 155)",
  "oklch(0.64 0.17 340)",
  "oklch(0.60 0.14 30)",
  "oklch(0.68 0.13 120)",
];

type Tab = "panorama" | "revisar" | "categorias" | "ranking" | "parcelas" | "insights" | "ledger" | "relatorios";

export function Dashboard({ txs, onClear, onUpdateCategory, categoriesList, onAddCategory, onRenameCategory, summaries, onRemoveSource, headerActions }: Props) {
  const [tab, setTab] = useState<Tab>("panorama");
  const [selectedMonth, setSelectedMonth] = useState<string>("");


  const positives = useMemo(() => txs.filter((t) => t.amount > 0 && t.category !== "Pagamentos/Créditos"), [txs]);
  const months = useMemo(() => {
    const rawMonths = aggregateByMonth(txs);
    
    // 1. Gather all unique months that have summaries
    const summaryMonths = new Set<string>();
    for (const src of Object.keys(summaries)) {
      const tx = txs.find((t) => t.source === src && t.invoiceDueDate);
      const dueDate = tx?.invoiceDueDate || extractDateFromFilename(src);
      if (dueDate) {
        summaryMonths.add(dueDate.slice(0, 7));
      }
    }
    
    // 2. Build a map of MonthAgg entries, initializing any summary-only months that don't have transactions
    const monthMap = new Map<string, EnrichedMonth>();
    for (const m of rawMonths) {
      monthMap.set(m.month, { ...m });
    }
    
    const MONTH_ABBR = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
    for (const mKey of summaryMonths) {
      const isValidMonthKey = /^\d{4}-(0[1-9]|1[0-2])$/.test(mKey);
      if (!isValidMonthKey) continue;
      
      if (!monthMap.has(mKey)) {
        const [yStr, mStr] = mKey.split("-");
        const mIdx = parseInt(mStr, 10) - 1;
        const label = `${MONTH_ABBR[mIdx]?.toLowerCase()}/${yStr.slice(2)}`;
        monthMap.set(mKey, {
          month: mKey,
          label,
          total: 0,
          count: 0,
          byCategory: {},
        });
      }
    }
    
    // 3. Map entries to merge summary details
    const mergedMonths = Array.from(monthMap.values()).map(m => {
      // Find all sources contributing to this month
      const sourcesForMonth = Array.from(new Set([
        ...txs.filter(t => (t.invoiceDueDate ? t.invoiceDueDate.slice(0, 7) : "Outros") === m.month)
           .map(t => t.source),
        ...Object.keys(summaries).filter(src => {
          const tx = txs.find((t) => t.source === src && t.invoiceDueDate);
          const dueDate = tx?.invoiceDueDate || extractDateFromFilename(src);
          return dueDate ? dueDate.slice(0, 7) === m.month : false;
        })
      ]));
      
      let previousBalance = 0;
      let totalAmount = 0;
      let hasSummary = false;

      for (const src of sourcesForMonth) {
        const summ = summaries[src];
        if (summ) {
          previousBalance += summ.previousBalance;
          totalAmount += summ.totalAmount;
          hasSummary = true;
        }
      }

      const monthNegatives = txs.filter(t => 
        (t.amount < 0 || t.category === "Pagamentos/Créditos") && 
        (t.invoiceDueDate ? t.invoiceDueDate.slice(0, 7) : "Outros") === m.month
      );
      const creditsTotal = monthNegatives.reduce((acc, t) => {
        const val = t.amount < 0 ? t.amount : -t.amount;
        return acc + val;
      }, 0);

      const finalTotalAmount = hasSummary ? totalAmount : (m.total + creditsTotal);

      return {
        ...m,
        previousBalance,
        totalAmount: finalTotalAmount,
        creditsTotal,
        hasSummary,
        originalTotal: m.total,
        total: finalTotalAmount
      };
    });
    
    return mergedMonths.sort((a, b) => a.month.localeCompare(b.month));
  }, [txs, summaries]);
  const totalFaturasConsolidado = useMemo(() => months.reduce((acc, m) => acc + m.total, 0), [months]);
  const categories = useMemo(() => aggregateByCategory(txs), [txs]);
  const future    = useMemo(() => projectFutureInstallments(txs), [txs]);
  const insights  = useMemo(() => generateInsights(txs), [txs]);

  const total      = positives.reduce((s, t) => s + t.amount, 0);
  const biggest    = [...positives].sort((a, b) => b.amount - a.amount).slice(0, 10);
  const smallest   = [...positives].sort((a, b) => a.amount - b.amount).slice(0, 10);
  const futureTotal = future.reduce((s, f) => s + f.total, 0);

  // Visão Geral metrics
  const totalJuros = positives.filter(t => t.category === "Tarifas").reduce((s, t) => s + t.amount, 0);
  const totalAlim  = positives.filter(t => t.category === "Ifood").reduce((s, t) => s + t.amount, 0);
  const totalTrans = positives.filter(t => t.category === "Transporte").reduce((s, t) => s + t.amount, 0);
  const totalAssinaturas   = positives.filter(t => t.category === "Assinaturas").reduce((s, t) => s + t.amount, 0);
  const totalComprasOnline = positives.filter(t => t.category === "Compras Online").reduce((s, t) => s + t.amount, 0);
  const totalTim           = positives.filter(t => /tim\b|tim\*/i.test(t.description)).reduce((s, t) => s + t.amount, 0);


  const monthDelta = (() => {
    if (months.length < 2) return null;
    const a = months[months.length - 2].total;
    const b = months[months.length - 1].total;
    return ((b - a) / a) * 100;
  })();

  const invoiceSources = useMemo(() => {
    const sources = Array.from(new Set([
      ...txs.map((t) => t.source),
      ...Object.keys(summaries),
    ]));
    return sources.sort((a, b) => {
      const getDueDate = (source: string) => {
        const tx = txs.find((t) => t.source === source && t.invoiceDueDate);
        if (tx?.invoiceDueDate) return tx.invoiceDueDate;

        const extracted = extractDateFromFilename(source);
        if (extracted) return extracted;

        return "9999-12-31";
      };

      const dateA = getDueDate(a);
      const dateB = getDueDate(b);
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    });
  }, [txs, summaries]);

  const [selectedSource, setSelectedSource] = useState<string>("");
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);

  const activeSource = selectedSource || invoiceSources[0] || "";

  const { minMaxMonths, totalAmountAll } = useMemo(() => {
    let total = 0;
    const dates: string[] = [];
    
    for (const src of invoiceSources) {
      const sum = summaries[src];
      if (sum) total += sum.totalAmount;
      
      const tx = txs.find((t) => t.source === src && t.invoiceDueDate);
      const dueDate = tx?.invoiceDueDate || extractDateFromFilename(src);
      if (dueDate && /^\d{4}-\d{2}/.test(dueDate)) {
        dates.push(dueDate.slice(0, 7));
      }
    }
    
    dates.sort();
    
    const MONTH_ABBR_PT = ["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"];
    const formatMonthKey = (mKey: string) => {
      if (!mKey) return "";
      const [y, m] = mKey.split("-");
      const idx = parseInt(m, 10) - 1;
      return `${MONTH_ABBR_PT[idx] ?? m}/${y.slice(2)}`;
    };
    
    return {
      totalAmountAll: total,
      minMaxMonths: {
        minLabel: dates.length > 0 ? formatMonthKey(dates[0]) : "",
        maxLabel: dates.length > 0 ? formatMonthKey(dates[dates.length - 1]) : "",
      }
    };
  }, [invoiceSources, summaries, txs]);


  // Navigate from Ranking to the corresponding transaction in Revisar tab
  const handleTransactionSelect = (tx: RawTransaction) => {
    setSelectedSource(tx.source);
    setTab("revisar");
    setTimeout(() => {
      const el = document.getElementById(`tx-${tx.id}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "panorama",   label: "Panorama",       icon: <BarChart2 className="size-3.5" /> },
    { id: "revisar",    label: "Revisar Fatura",  icon: <ListFilter className="size-3.5" /> },
    { id: "categorias", label: "Categorias",     icon: <Tag className="size-3.5" /> },
    { id: "ranking",    label: "Ranking",        icon: <TrendingUp className="size-3.5" /> },
    { id: "parcelas",   label: "Parcelas",       icon: <CreditCard className="size-3.5" /> },
    { id: "insights",   label: "Insights",       icon: <Sparkles className="size-3.5" /> },
    { id: "ledger",     label: "Razão",          icon: <ChevronRight className="size-3.5" /> },
    { id: "relatorios", label: "Relatórios",     icon: <FileText className="size-3.5" /> },
  ];

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6 no-print">
        <div>
          <h2 className="font-display text-2xl md:text-3xl font-700 tracking-tight text-foreground">Parecer da Auditoria</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {invoiceSources.length > 0 && (
            <button
              onClick={() => setIsDrawerOpen(true)}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 bg-muted/40 border border-border/60 hover:border-primary/30 hover:bg-muted/80 text-xs font-semibold text-foreground rounded-xl transition-all duration-200 shadow-sm"
              title={`Período: ${minMaxMonths.minLabel} a ${minMaxMonths.maxLabel} • Total: ${fmtBRL(totalAmountAll)}`}
            >
              <FileText className="size-4 text-primary" />
              <span>{invoiceSources.length} Fatura{invoiceSources.length !== 1 ? 's' : ''}</span>
              <span className="opacity-40">•</span>
              <span className="font-bold text-primary">{fmtBRL(totalAmountAll)}</span>
            </button>
          )}
          {headerActions}
          <button
            onClick={onClear}
            className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-destructive bg-white border border-border/60 hover:border-destructive/30 px-3.5 py-2.5 rounded-xl transition-all duration-200 shadow-sm"
          >
            <Trash2 className="size-3.5" /> Limpar análise
          </button>
        </div>
      </div>




      {/* ── VISÃO GERAL (KPIs em Cards com Borda Superior) ── */}
      <div className="mb-8 no-print">
        <div className="flex items-center gap-2 mb-3.5">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">Visão Geral · {months.length} Meses</p>
          <div className="h-px bg-border flex-1 ml-2 opacity-50" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <KpiTopBorder
            label="Juros & Tarifas"
            value={fmtBRL(totalJuros)}
            sub={totalJuros > 0 ? "Fique atento a multas" : "Nenhum encargo"}
            color="oklch(0.60 0.20 25)"
            valueColor="text-red-600"
            alert={totalJuros > 0}
            icon={ShieldAlert}
          />
          <KpiTopBorder
            label="Ifood"
            value={fmtBRL(totalAlim)}
            sub="Ifood"
            color="oklch(0.55 0.16 155)"
            valueColor="text-teal-600"
            icon={Utensils}
          />
          <KpiTopBorder
            label="Transporte"
            value={fmtBRL(totalTrans)}
            sub="Uber, 99app."
            color="oklch(0.35 0.05 250)"
            valueColor="text-slate-700"
            icon={Car}
          />
          <KpiTopBorder
            label="Assinaturas"
            value={fmtBRL(totalAssinaturas)}
            sub="Google, Netflix, GPT"
            color="oklch(0.54 0.18 295)"
            valueColor="text-purple-600"
            icon={Tv}
          />
          <KpiTopBorder
            label="Compras Online"
            value={fmtBRL(totalComprasOnline)}
            sub="Amazon, M.Livre, etc."
            color="oklch(0.62 0.15 200)"
            valueColor="text-blue-600"
            icon={ShoppingCart}
          />
          <KpiTopBorder
            label="Recargas Tim"
            value={fmtBRL(totalTim)}
            sub="Telefonia e recargas"
            color="oklch(0.47 0.21 270)"
            valueColor="text-pink-600"
            icon={Smartphone}
          />
          <KpiTopBorder
            label="Parcelas futuras"
            value={fmtBRL(futureTotal)}
            sub="A vencer em aberto"
            color="oklch(0.76 0.13 72)"
            valueColor="text-amber-600"
            icon={Calendar}
          />
        </div>
      </div>



      {/* ── DRAWER DE GERENCIAMENTO DE FATURAS ── */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-[200] overflow-hidden">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300"
            onClick={() => setIsDrawerOpen(false)}
          />
          {/* Drawer container */}
          <div 
            className="absolute inset-y-0 right-0 w-full max-w-md bg-white border-l border-border/80 shadow-2xl flex flex-col z-10"
            style={{ animation: "slideLeft 0.22s cubic-bezier(0.16, 1, 0.3, 1) both" }}
          >
            {/* Header */}
            <div className="p-6 border-b border-border/40 flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold text-foreground">Faturas Importadas</h3>
                <p className="text-xs text-muted-foreground">{invoiceSources.length} arquivo{invoiceSources.length !== 1 ? 's' : ''} carregado{invoiceSources.length !== 1 ? 's' : ''}</p>
              </div>
              <button 
                onClick={() => setIsDrawerOpen(false)}
                className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="size-5" />
              </button>
            </div>
            
            {/* Quick stats banner inside drawer */}
            {invoiceSources.length > 0 && (
              <div className="px-6 py-4 bg-muted/20 border-b border-border/20 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Valor Consolidado</p>
                  <p className="text-sm font-bold text-primary mt-0.5">{fmtBRL(totalAmountAll)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Período Ativo</p>
                  <p className="text-sm font-bold text-foreground mt-0.5">{minMaxMonths.minLabel} a {minMaxMonths.maxLabel}</p>
                </div>
              </div>
            )}
            
            {/* Scrollable list */}
            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {invoiceSources.map((src) => {
                const count = txs.filter(t => t.source === src).length;
                const summary = summaries[src];
                const dueDateTx = txs.find(t => t.source === src && t.invoiceDueDate);
                const dueDate = dueDateTx?.invoiceDueDate
                  ? (() => { const [y, m, d] = dueDateTx.invoiceDueDate!.split('-'); return `${d}/${m}/${y}`; })()
                  : null;
                const isActive = src === activeSource;
                
                return (
                  <div 
                    key={src}
                    className={`group relative flex flex-col p-4 rounded-xl border transition-all duration-200 ${
                      isActive 
                        ? 'border-primary bg-primary/[0.02] shadow-sm shadow-primary/5' 
                        : 'border-border/60 hover:border-border-hover hover:bg-muted/10'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5 min-w-0 cursor-pointer flex-1" onClick={() => { setSelectedSource(src); setTab('revisar'); setIsDrawerOpen(false); }}>
                        <div className={`size-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                        }`}>
                          <FileText className="size-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-foreground truncate group-hover:text-primary transition-colors" title={src}>
                            {src.replace(/\.[^/.]+$/, '')}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[10px] text-muted-foreground">
                            <span>{count} lançamentos</span>
                            {dueDate && (
                              <>
                                <span className="opacity-40">•</span>
                                <span className="flex items-center gap-0.5"><Calendar className="size-2.5" /> Venc. {dueDate}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      {onRemoveSource && (
                        <button
                          onClick={() => {
                            if (confirm(`Remover fatura "${src.replace(/\.[^/.]+$/, '')}" e seus ${count} lançamentos?`)) {
                              onRemoveSource(src);
                            }
                          }}
                          className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                          title="Remover esta fatura"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                    
                    {summary && (
                      <div className="mt-3 pt-3 border-t border-border/20 flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">Valor Total:</span>
                        <span className="font-bold text-foreground">{fmtBRL(summary.totalAmount)}</span>
                      </div>
                    )}
                  </div>
                );
              })}
              
              {invoiceSources.length === 0 && (
                <div className="text-center py-12">
                  <div className="size-12 rounded-full bg-muted flex items-center justify-center mx-auto text-muted-foreground mb-3">
                    <FileText className="size-6" />
                  </div>
                  <p className="text-xs font-bold text-foreground">Nenhuma fatura ativa</p>
                  <p className="text-[11px] text-muted-foreground mt-1 max-w-[200px] mx-auto">Importe novos arquivos PDF para visualizar e auditar lançamentos.</p>
                </div>
              )}
            </div>
            
            {/* Footer */}
            <div className="p-6 border-t border-border/40 bg-muted/10">
              <button 
                onClick={() => setIsDrawerOpen(false)}
                className="w-full inline-flex items-center justify-center px-4 py-2.5 bg-primary text-white text-xs font-bold rounded-xl hover:bg-primary/95 transition-all shadow-sm"
              >
                Voltar ao Dashboard
              </button>
            </div>
          </div>
          
          <style>{`
            @keyframes slideLeft {
              from { transform: translateX(100%); }
              to { transform: translateX(0); }
            }
            @keyframes scaleUp {
              from { transform: scale(0.96); opacity: 0; }
              to { transform: scale(1); opacity: 1; }
            }
            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            .animate-fade-in {
              animation: fadeIn 0.2s ease-out both;
            }
          `}</style>
        </div>
      )}



      <div className="flex items-center gap-1 p-1 bg-white border border-border/60 rounded-xl shadow-sm mb-8 overflow-x-auto no-print">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-all duration-200 whitespace-nowrap ${
              tab === t.id
                ? "bg-primary text-white shadow-sm shadow-primary/25"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {tab === "panorama"   && <Panorama months={months} categories={categories} txs={positives} />}
        {tab === "revisar"    && (
          <RevisarView 
            txs={txs} 
            onUpdateCategory={onUpdateCategory} 
            invoiceSources={invoiceSources} 
            activeSource={activeSource} 
            setActiveSource={setSelectedSource}
            categoriesList={categoriesList}
            summaries={summaries}
          />
        )}
        {tab === "categorias" && (
          <CategoriesView
            categories={categories}
            total={total}
            categoriesList={categoriesList}
            onAddCategory={onAddCategory}
            onRenameCategory={onRenameCategory}
            txs={txs}
            onUpdateCategory={onUpdateCategory}
          />
        )}
        {tab === "ranking"    && <RankingView biggest={biggest} smallest={smallest} onTransactionSelect={handleTransactionSelect} />}
        {tab === "parcelas"   && <FutureView future={future} />}
        {tab === "insights"   && <InsightsView insights={insights} />}
        {tab === "ledger"     && <LedgerView txs={txs} />}
        {tab === "relatorios" && <ReportsView txs={txs} categoriesList={categoriesList} />}
      </div>
    </div>
  );
}

/* ── KPI Card com borda superior colorida ── */
function KpiTopBorder({ label, value, sub, color, valueColor, alert, icon: Icon }: any) {
  return (
    <div 
      className="glass-card overflow-hidden flex flex-col justify-between shadow-sm border border-border/40 rounded-2xl bg-white/70 backdrop-blur-md transition-all hover:shadow-md hover:translate-y-[-1px] duration-200"
      style={{ borderTop: `3px solid ${color}` }}
    >
      <div className="p-4 flex-1">
        <div className="flex items-center justify-between gap-1 mb-2">
          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider truncate">{label}</p>
          {Icon && <Icon className="size-3.5 text-muted-foreground/60 flex-shrink-0" />}
        </div>
        <p className={`font-display text-lg sm:text-xl font-800 tabular tracking-tighter ${valueColor}`}>{value}</p>
      </div>
      <div className="px-4 py-2 bg-muted/10 border-t border-border/20 flex items-center justify-between">
        <p className="text-[9px] text-muted-foreground font-semibold truncate leading-tight" title={sub}>{sub}</p>
        {alert && <AlertTriangle className="size-3 text-destructive animate-pulse" />}
      </div>
    </div>
  );
}

/* ── Categorias Icons Helper ── */
const getCatIcon = (cat: string) => {
  switch (cat) {
    case "Ifood": return <Utensils className="size-3.5" />;
    case "Alimentação": return <Utensils className="size-3.5" />;
    case "Restaurantes locais": return <Utensils className="size-3.5" />;
    case "Mercados / Panificadoras": return <ShoppingCart className="size-3.5" />;
    case "Transporte": return <CarFront className="size-3.5" />;
    case "Assinaturas": return <Tv className="size-3.5" />;
    case "Saúde": return <Stethoscope className="size-3.5" />;
    case "Saúde (Farmácias)": return <Stethoscope className="size-3.5" />;
    case "Lazer": return <Ticket className="size-3.5" />;
    case "Educação": return <GraduationCap className="size-3.5" />;
    case "Serviços": return <Zap className="size-3.5" />;
    case "Copel / Sanepar / Gás": return <Zap className="size-3.5" />;
    case "Telefonia (Planos/Aparelhos)": return <Smartphone className="size-3.5" />;
    case "Recargas TIM": return <Smartphone className="size-3.5" />;
    case "Vestuário": return <Briefcase className="size-3.5" />;
    case "Compras Lojas Locais": return <Tag className="size-3.5" />;
    case "Boletos Div Pagos": return <FileText className="size-3.5" />;
    case "Tarifas": return <ShieldAlert className="size-3.5 text-destructive" />;
    case "Pagamentos/Créditos": return <CheckCircle2 className="size-3.5 text-emerald-600" />;
    default: return <CreditCard className="size-3.5" />;
  }
};

/* ── Panorama ── */
type EnrichedMonth = MonthAgg & { originalTotal?: number; previousBalance?: number; hasSummary?: boolean; totalAmount?: number; creditsTotal?: number };
function Panorama({ months, categories, txs }: {
  months: EnrichedMonth[]; categories: ReturnType<typeof aggregateByCategory>; txs: RawTransaction[];
}) {
  const maxMonth = Math.max(...months.map((m) => m.total));

  // Preparar os dados de assinaturas
  const subs = txs.filter((t) => t.category === "Assinaturas");
  const subMap = new Map<string, { desc: string, amount: number, occurrences: number }>();
  
  // Agrupar assinaturas por "raiz" de nome para ver recorrência
  subs.forEach(t => {
    // Normalizar nomes como "Netflix.Com", "SpotifyBR"
    const name = t.description.toLowerCase()
      .replace(/\.com|br|\*|\s/g, "")
      .slice(0, 12); 
    const prev = subMap.get(name) || { desc: t.description.split("*").pop() || t.description, amount: 0, occurrences: 0 };
    if (t.amount > prev.amount) prev.amount = t.amount; // Pega a maior cobrança para a estimativa mensal
    prev.occurrences++;
    subMap.set(name, prev);
  });
  
  const subList = Array.from(subMap.values()).sort((a, b) => b.amount - a.amount);
  const totalSubs = subList.reduce((s, x) => s + x.amount, 0);

  const cardThemes = [
    { bg: "bg-sky-50/50", border: "border-sky-100", title: "text-sky-700", badge: "bg-sky-200/50 text-sky-800", hl: "text-sky-900" },
    { bg: "bg-amber-50/50", border: "border-amber-100", title: "text-amber-700", badge: "bg-amber-200/50 text-amber-800", hl: "text-amber-900" },
    { bg: "bg-emerald-50/50", border: "border-emerald-100", title: "text-emerald-700", badge: "bg-emerald-200/50 text-emerald-800", hl: "text-emerald-900" },
    { bg: "bg-purple-50/50", border: "border-purple-100", title: "text-purple-700", badge: "bg-purple-200/50 text-purple-800", hl: "text-purple-900" },
    { bg: "bg-rose-50/50", border: "border-rose-100", title: "text-rose-700", badge: "bg-rose-200/50 text-rose-800", hl: "text-rose-900" },
  ];

  return (
    <div className="space-y-10">
      {/* ── 1. Detalhamento por Mês ── */}
      <div>
        <div className="flex items-center gap-2 mb-5">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">Detalhamento por Mês</p>
          <div className="h-px bg-border flex-1 ml-2 opacity-50" />
        </div>
        <div className="flex overflow-x-auto gap-5 pb-4 hide-scrollbar snap-x">
          {months.map((m, i) => {
            const theme = cardThemes[i % cardThemes.length];
            const isMax = m.total === maxMonth && months.length > 1;
            const juros = m.byCategory["Tarifas"] || 0;
            const originalTotal = m.originalTotal ?? m.total;
            const compras = originalTotal - juros;
            
            // Ordenar categorias do mês (Tarifas sempre por último)
            const sortedCats = Object.entries(m.byCategory).sort((a, b) => {
              if (a[0] === "Tarifas") return 1;
              if (b[0] === "Tarifas") return -1;
              return b[1] - a[1];
            });

            // Derive month name safely from m.month (YYYY-MM), not from m.label which can be "Invalid Date"
            const MONTH_ABBR = ["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"];
            const [mYear, mMo] = m.month.split("-");
            const monthName = MONTH_ABBR[parseInt(mMo) - 1] || m.month;
            const yearShort = mYear.slice(2);

            return (
              <div key={m.month} className={`min-w-[300px] w-[340px] rounded-2xl border ${theme.border} ${theme.bg} shadow-sm flex-shrink-0 snap-start flex flex-col`}>
                <div className="p-6 border-b border-black/5">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h3 className={`font-display text-2xl font-800 uppercase tracking-wide ${theme.title}`}>
                        {monthName} {yearShort}
                      </h3>
                    </div>
                    {isMax ? (
                      <span className="flex items-center gap-1 bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border border-amber-200">
                        <AlertTriangle className="size-2.5" /> Maior Fatura
                      </span>
                    ) : (
                      <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${theme.badge}`}>
                        Fatura Fechada
                      </span>
                    )}
                  </div>
                  <p className={`font-display text-xl font-700 ${theme.title}`}>{fmtBRL(m.total)}</p>
                </div>
                
                <div className="p-6 flex-1 flex flex-col gap-3">
                  {sortedCats.slice(0, 8).map(([cat, val]) => {
                    const isTarifa = cat === "Tarifas";
                    return (
                      <div key={cat} className={`flex items-center justify-between text-xs ${isTarifa ? "text-destructive font-semibold" : "text-foreground/80"}`}>
                        <div className="flex items-center gap-2.5">
                          <span className={isTarifa ? "text-destructive" : "text-muted-foreground"}>{getCatIcon(cat)}</span>
                          <span>{cat}</span>
                        </div>
                        <span className="tabular font-mono">{fmtBRL(val)}</span>
                      </div>
                    );
                  })}
                </div>
                
                {/* Footer: Compras + Tarifas breakdown */}
                <div className="px-6 pt-4 pb-5 border-t border-black/5 flex flex-col gap-2">
                  {m.previousBalance !== undefined && m.previousBalance > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Saldo Anterior</span>
                      <span className="font-display text-sm font-700 text-foreground/80">{fmtBRL(m.previousBalance)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Compras</span>
                    <span className={`font-display text-sm font-700 ${theme.hl}`}>{fmtBRL(compras)}</span>
                  </div>
                  {juros > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-destructive/70 uppercase tracking-wider">Tarifas / Encargos</span>
                      <span className="font-display text-sm font-700 text-destructive">{fmtBRL(juros)}</span>
                    </div>
                  )}
                  {m.creditsTotal !== undefined && m.creditsTotal < 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-emerald-600/80 uppercase tracking-wider">Créditos / Pagos</span>
                      <span className="font-display text-sm font-700 text-emerald-600">{fmtBRL(m.creditsTotal)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-1.5 border-t border-black/8 mt-0.5">
                    <span className="text-[10px] font-bold text-foreground uppercase tracking-wider">
                      {m.previousBalance !== undefined && m.previousBalance > 0 ? "Total a Pagar" : "Total Fatura"}
                    </span>
                    <span className={`font-display text-sm font-800 ${theme.title}`}>{fmtBRL(m.total)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>


      {/* ── 3. Gráficos removidos ── */}
    </div>
  );
}

/* ── Section Title ── */
function SectionTitle({ eyebrow, title, className = "" }: { eyebrow: string; title: string; className?: string }) {
  return (
    <div className={className}>
      <p className="text-[10px] font-bold text-primary uppercase tracking-[0.15em]">{eyebrow}</p>
      <h3 className="font-display text-lg md:text-xl font-700 mt-1 tracking-tight">{title}</h3>
    </div>
  );
}

/* ── Chart Tooltip ── */
function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white rounded-xl border border-border/60 px-3.5 py-3 shadow-lg shadow-foreground/8">
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="tabular text-sm font-semibold text-foreground">
          {p.name === "count" ? `${p.value} lançamentos` : fmtBRL(p.value)}
        </p>
      ))}
    </div>
  );
}

/* ── Categories ── */
function CategoriesView({
  categories,
  total,
  categoriesList,
  onAddCategory,
  onRenameCategory,
  txs,
  onUpdateCategory,
}: {
  categories: ReturnType<typeof aggregateByCategory>;
  total: number;
  categoriesList: string[];
  onAddCategory: (name: string) => void;
  onRenameCategory: (oldName: string, newName: string) => void;
  txs: RawTransaction[];
  onUpdateCategory?: (id: string, newCategory: string) => void;
}) {
  const max = categories[0]?.total || 1;
  const [newCatName, setNewCatName] = useState("");
  const [editingCat, setEditingCat] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const editRef = useRef<HTMLInputElement>(null);

  // Modal State
  const [selectedCategoryTxs, setSelectedCategoryTxs] = useState<string | null>(null);
  const [openedTxIds, setOpenedTxIds] = useState<string[]>([]);

  const handleOpenCategory = (categoryName: string) => {
    const ids = txs
      .filter((t) => t.category === categoryName && t.amount > 0 && t.category !== "Pagamentos/Créditos")
      .map((t) => t.id);
    setOpenedTxIds(ids);
    setSelectedCategoryTxs(categoryName);
  };

  const handleCloseCategory = () => {
    setSelectedCategoryTxs(null);
    setOpenedTxIds([]);
  };

  const modalTxs = useMemo(() => {
    return txs.filter((t) => openedTxIds.includes(t.id));
  }, [txs, openedTxIds]);

  const modalTotal = useMemo(() => {
    return modalTxs.reduce((sum, t) => sum + t.amount, 0);
  }, [modalTxs]);

  function startEdit(name: string) {
    setEditingCat(name);
    setEditingValue(name);
    setTimeout(() => editRef.current?.focus(), 50);
  }

  function confirmEdit() {
    if (editingCat) onRenameCategory(editingCat, editingValue);
    setEditingCat(null);
  }

  return (
    <div className="space-y-5">
      {/* Stats table */}
      <div className="glass-card overflow-hidden">
        <div className="p-6 border-b border-border/40">
          <SectionTitle eyebrow="II" title="Categorização integral de gastos" />
        </div>
        <div className="divide-y divide-border/30">
          {categories.map((c, i) => (
            <div 
              key={c.category} 
              onClick={() => handleOpenCategory(c.category)}
              className="grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-muted/30 transition-colors duration-150 cursor-pointer group/row"
            >
              <div className="col-span-1 text-center">
                <span className="text-[10px] font-mono font-bold text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
              </div>
              <div className="col-span-4">
                <div className="flex items-center gap-2.5">
                  <span className="size-2.5 rounded-full flex-shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                  <span className="font-semibold text-sm text-foreground group-hover/row:text-primary transition-colors">{c.category}</span>
                </div>
              </div>
              <div className="col-span-4">
                <div className="h-1.5 bg-muted/60 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${(c.total / max) * 100}%`, background: CHART_COLORS[i % CHART_COLORS.length] }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">{((c.total / total) * 100).toFixed(1)}% da fatura</p>
              </div>
              <div className="col-span-1 text-center text-sm text-muted-foreground font-mono">{c.count}</div>
              <div className="col-span-2 text-right font-mono font-semibold text-sm">{fmtBRL(c.total)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Category manager */}
      <div className="glass-card overflow-hidden">
        <div className="p-6 border-b border-border/40 flex items-center justify-between gap-4">
          <SectionTitle eyebrow="II·B" title="Gerenciar categorias" />
          <div className="flex items-center gap-2">
            <input
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { onAddCategory(newCatName); setNewCatName(""); } }}
              placeholder="Nova categoria…"
              className="text-sm font-medium bg-white border border-border/60 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/40 transition-all duration-200 placeholder:text-muted-foreground/50 shadow-sm w-48"
            />
            <button
              onClick={() => { onAddCategory(newCatName); setNewCatName(""); }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 transition-all duration-200 shadow-sm"
            >
              <Plus className="size-3.5" /> Adicionar
            </button>
          </div>
        </div>
        <div className="p-4 flex flex-wrap gap-2">
          {categoriesList.map((cat) => (
            <div key={cat} className="flex items-center gap-1.5 bg-white border border-border/50 rounded-lg px-3 py-1.5 shadow-sm group">
              {editingCat === cat ? (
                <>
                  <input
                    ref={editRef}
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") confirmEdit(); if (e.key === "Escape") setEditingCat(null); }}
                    className="text-xs font-medium border-b border-primary/50 outline-none bg-transparent w-28"
                  />
                  <button onClick={confirmEdit} className="text-green-600 hover:text-green-700"><Check className="size-3" /></button>
                  <button onClick={() => setEditingCat(null)} className="text-muted-foreground hover:text-destructive"><X className="size-3" /></button>
                </>
              ) : (
                <>
                  <span className="text-xs font-semibold text-foreground">{cat}</span>
                  <button
                    onClick={() => startEdit(cat)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary"
                  >
                    <Pencil className="size-3" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="px-4 pb-4">
          <div className="flex items-start gap-2 text-[11px] text-muted-foreground bg-muted/30 rounded-lg p-3 border border-border/30">
            <Info className="size-3.5 flex-shrink-0 mt-0.5" />
            <span>Para <strong>renomear</strong> uma categoria, passe o mouse sobre ela e clique no lápis. Ao renomear, todos os lançamentos com essa categoria serão atualizados automaticamente.</span>
          </div>
        </div>
      </div>

      {/* ── CATEGORY TRANSACTIONS MODAL ── */}
      {selectedCategoryTxs && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 overflow-hidden">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/45 backdrop-blur-sm transition-opacity duration-300 animate-fade-in"
            onClick={handleCloseCategory}
          />
          {/* Modal Container */}
          <div 
            className="relative bg-white rounded-2xl border border-border/80 shadow-2xl flex flex-col w-full max-w-3xl max-h-[85vh] z-10 overflow-hidden"
            style={{ animation: "scaleUp 0.22s cubic-bezier(0.16, 1, 0.3, 1) both" }}
          >
            {/* Header */}
            <div className="p-6 border-b border-border/40 flex items-center justify-between bg-muted/5">
              <div>
                <h3 className="font-display text-base font-bold text-foreground flex items-center gap-2">
                  <Tag className="size-4 text-primary" />
                  Lançamentos em: {selectedCategoryTxs}
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  {modalTxs.length} lançamento{modalTxs.length !== 1 ? 's' : ''} · Total de <span className="font-semibold text-foreground">{fmtBRL(modalTotal)}</span>
                </p>
              </div>
              <button 
                onClick={handleCloseCategory}
                className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Fechar"
              >
                <X className="size-5" />
              </button>
            </div>
            
            {/* Scrollable list */}
            <div className="flex-1 overflow-y-auto min-h-[200px]">
              <table className="w-full text-sm text-left border-collapse">
                <thead className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-border/40">
                  <tr className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    <th className="px-5 py-3 text-left">Data</th>
                    <th className="px-5 py-3 text-left">Descrição</th>
                    <th className="px-5 py-3 text-left">Fatura</th>
                    <th className="px-5 py-3 text-left">Categoria</th>
                    <th className="px-5 py-3 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {modalTxs.map((t) => (
                    <tr key={t.id} className="hover:bg-primary/[0.015] transition-colors duration-100">
                      <td className="px-5 py-3.5 tabular text-muted-foreground text-xs font-mono font-medium">
                        {t.date}
                      </td>
                      <td className="px-5 py-3.5 font-semibold text-foreground max-w-[220px] truncate" title={t.description}>
                        {t.description}
                        {t.installment && (
                          <span className="ml-2 pill text-[9px] px-1.5 py-0.5 align-middle">
                            {t.installment.current}/{t.installment.total}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-muted-foreground truncate max-w-[140px]" title={t.source}>
                        {t.source.replace(/\.[^/.]+$/, "")}
                      </td>
                      <td className="px-5 py-3.5">
                        <select
                          value={t.category}
                          onChange={(e) => onUpdateCategory?.(t.id, e.target.value)}
                          className="w-full max-w-[160px] text-xs font-medium bg-white border border-border/50 hover:border-primary/45 rounded-lg px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-150 cursor-pointer shadow-sm text-foreground/80 hover:text-foreground font-sans appearance-none"
                          style={{
                            backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b' stroke-width='2.5'><path stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/></svg>")`,
                            backgroundRepeat: "no-repeat",
                            backgroundPosition: "right 8px center",
                            backgroundSize: "8px",
                            paddingRight: "24px",
                          }}
                        >
                          {categoriesList.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-5 py-3.5 text-right tabular font-700 font-mono text-foreground text-sm">
                        {fmtBRL(t.amount)}
                      </td>
                    </tr>
                  ))}
                  {modalTxs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-12 text-muted-foreground text-xs">
                        Nenhum lançamento nesta categoria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-border/40 bg-muted/5 flex justify-end">
              <button 
                onClick={handleCloseCategory}
                className="px-4 py-2.5 bg-primary text-white text-xs font-bold rounded-xl hover:bg-primary/95 transition-all shadow-sm"
              >
                Concluir Ajustes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


/* ── Ranking ── */
function RankingView({ biggest, smallest, onTransactionSelect }: { biggest: RawTransaction[]; smallest: RawTransaction[]; onTransactionSelect: (tx: RawTransaction) => void }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <RankCard title="Maiores despesas" icon={<TrendingUp className="size-4 text-destructive" />} items={biggest} eyebrow="IV·A" onTransactionSelect={onTransactionSelect} />
      <RankCard title="Menores despesas" icon={<TrendingDown className="size-4 text-positive" />} items={smallest} eyebrow="IV·B" muted onTransactionSelect={onTransactionSelect} />
    </div>
  );
}

function RankCard({ title, icon, items, eyebrow, muted, onTransactionSelect }: {
  title: string; icon: React.ReactNode; items: RawTransaction[]; eyebrow: string; muted?: boolean; onTransactionSelect: (tx: RawTransaction) => void;
}) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="p-6 border-b border-border/40 flex items-center gap-2.5">
        {icon}
        <SectionTitle eyebrow={eyebrow} title={title} />
      </div>
      <div className="divide-y divide-border/25">
        {items.map((t, i) => (
          <div
            key={t.id}
            id={`tx-${t.id}`}
            className="flex items-center gap-4 px-6 py-3.5 hover:bg-muted/30 transition-colors duration-150 cursor-pointer"
            onClick={() => onTransactionSelect(t)}
          >
            <span className="font-mono text-[11px] font-bold text-muted-foreground w-6 flex-shrink-0">{String(i + 1).padStart(2, "0")}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{t.description}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 font-medium">
                {t.date.includes("-") ? t.date.split("-").reverse().join("/") : t.date} · <span className="pill-accent pill text-[9px] px-1.5 py-0.5">{t.category}</span>
              </p>
            </div>
            <span className="tabular font-mono font-700 text-sm text-foreground flex-shrink-0">{fmtBRL(t.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Future ── */
function FutureView({ future }: { future: ReturnType<typeof projectFutureInstallments> }) {
  if (!future.length) {
    return (
      <div className="glass-card p-14 text-center">
        <div className="size-14 rounded-2xl bg-muted/60 border border-border/50 flex items-center justify-center mx-auto mb-4">
          <Calendar className="size-6 text-muted-foreground" />
        </div>
        <p className="font-display text-xl font-700">Nenhuma parcela futura detectada</p>
        <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto">As faturas analisadas não contêm compras parceladas em aberto.</p>
      </div>
    );
  }
  const max = Math.max(...future.map((f) => f.total));
  return (
    <div className="space-y-5">
      <div className="glass-card p-6">
        <SectionTitle eyebrow="V" title="Projeção de compromissos — próximos meses" />
        <div className="h-64 mt-5">
          <ResponsiveContainer>
            <BarChart data={future} barSize={36}>
              <CartesianGrid stroke="oklch(0.175 0.025 255 / 0.06)" strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="label" stroke="oklch(0.50 0.025 255)" tick={{ fontSize: 10, fontFamily: "var(--font-sans)", fontWeight: 500 }} />
              <YAxis stroke="oklch(0.50 0.025 255)" tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }} tickFormatter={(v) => `R$${(v / 1000).toFixed(1)}k`} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="total" fill="oklch(0.54 0.18 295)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {future.map((f) => (
        <div key={f.month} className="glass-card overflow-hidden">
          <div className="flex items-center justify-between p-6 border-b border-border/40">
            <p className="font-display text-base font-700 capitalize">{f.label}</p>
            <span className="tabular font-mono font-700 text-primary">{fmtBRL(f.total)}</span>
          </div>
          <div className="px-6 pt-3 pb-1">
            <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden mb-4">
              <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${(f.total / max) * 100}%` }} />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-border/25 border-t border-border/30">
            {f.items.map((it, i) => (
              <div key={i} className="flex items-center justify-between px-6 py-3 hover:bg-muted/20 transition-colors">
                <span className="text-xs text-foreground/80 truncate pr-4">
                  {it.description}
                </span>
                <span className="tabular text-xs font-semibold text-muted-foreground flex-shrink-0">{fmtBRL(it.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Insights ── */
function InsightsView({ insights }: { insights: ReturnType<typeof generateInsights> }) {
  const config: Record<string, { icon: React.ReactNode; pillClass: string; label: string }> = {
    warning:  { icon: <AlertTriangle className="size-4" />, pillClass: "pill-warning", label: "Atenção" },
    info:     { icon: <Sparkles className="size-4" />,      pillClass: "pill",          label: "Info" },
    positive: { icon: <CheckCircle2 className="size-4" />,  pillClass: "pill-positive", label: "Positivo" },
    anomaly:  { icon: <AlertTriangle className="size-4" />, pillClass: "pill-danger",   label: "Anomalia" },
  };
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {insights.map((ins, i) => {
        const c = config[ins.kind] ?? config.info;
        return (
          <div key={i} className="glass-card p-6 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className={`size-8 rounded-lg flex items-center justify-center flex-shrink-0 ${c.pillClass} pill`}>
                  {c.icon}
                </div>
                <div className="flex-1">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">
                    Observação {String(i + 1).padStart(2, "0")}
                  </p>
                  <p className="font-display text-base font-700 leading-snug tracking-tight">{ins.title}</p>
                </div>
              </div>
              <span className={`pill ${c.pillClass} flex-shrink-0 text-[10px]`}>{c.label}</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line pl-11">{ins.detail}</p>
          </div>
        );
      })}
    </div>
  );
}

/* ── Ledger ── */
function LedgerView({ txs }: { txs: RawTransaction[] }) {
  const [q, setQ] = useState("");
  const filtered = txs
    .filter((t) => !q || t.description.toLowerCase().includes(q.toLowerCase()) || t.category.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => getSortValue(b) - getSortValue(a));

  return (
    <div className="glass-card overflow-hidden">
      <div className="p-5 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between border-b border-border/40 bg-muted/20">
        <SectionTitle eyebrow="VII" title="Livro Razão" />
        <div className="relative w-full sm:w-64">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar lançamento…"
            className="w-full pl-4 pr-4 py-2.5 text-sm font-medium bg-white border border-border/60 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/40 transition-all duration-200 placeholder:text-muted-foreground/50 shadow-sm"
          />
        </div>
      </div>

      <div className="max-h-[620px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-white/90 backdrop-blur-md border-b border-border/40">
            <tr className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <th className="text-left px-6 py-3.5">Data</th>
              <th className="text-left px-6 py-3.5">Descrição</th>
              <th className="text-left px-6 py-3.5">Categoria</th>
              <th className="text-left px-6 py-3.5">Parcela</th>
              <th className="text-right px-6 py-3.5">Valor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {filtered.map((t) => (
              <tr key={t.id} className="hover:bg-primary/[0.02] transition-colors duration-100 group">
                <td className="px-6 py-3.5 tabular text-muted-foreground text-xs font-medium">{t.date.includes("-") ? t.date.split("-").reverse().join("/") : t.date}</td>
                <td className="px-6 py-3.5 font-semibold text-foreground max-w-[220px] truncate">{t.description}</td>
                <td className="px-6 py-3.5">
                  <span className="pill-accent pill text-[10px]">{t.category}</span>
                </td>
                <td className="px-6 py-3.5">
                  {t.installment ? (
                    <span className="pill text-[10px]">{t.installment.current}/{t.installment.total}</span>
                  ) : (
                    <span className="text-muted-foreground/50 text-xs">—</span>
                  )}
                </td>
                <td className="px-6 py-3.5 text-right tabular font-700 text-foreground">{fmtBRL(t.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            Nenhum lançamento encontrado para "<span className="font-semibold">{q}</span>"
          </div>
        )}
      </div>

      <div className="px-6 py-3 border-t border-border/30 bg-muted/20 text-[11px] text-muted-foreground font-medium">
        {filtered.length} de {txs.length} lançamentos
      </div>
    </div>
  );
}

/* ── Invoice Summary Panel ── */
function InvoiceSummaryPanel({ summary }: { summary: InvoiceSummary }) {
  const rows = [
    { label: "Saldo anterior",       value: summary.previousBalance,  color: summary.previousBalance > 0 ? "text-destructive" : "text-foreground" },
    { label: "Pagamentos / Créditos",value: summary.paymentsCredits,  color: "text-emerald-600" },
    { label: "Compras nacionais",     value: summary.localPurchases,   color: "text-foreground" },
    { label: "Compras internacionais",value: summary.intlPurchases,    color: "text-foreground" },
    { label: "Tarifas / Encargos / Multas", value: summary.feesAndCharges, color: summary.feesAndCharges > 0 ? "text-destructive" : "text-foreground" },
  ].filter((r) => r.value !== 0);

  return (
    <div className="mx-5 mb-5 border border-primary/20 rounded-xl overflow-hidden shadow-sm">
      <div className="px-5 py-3 bg-primary/5 border-b border-primary/15 flex items-center gap-2">
        <CreditCard className="size-4 text-primary" />
        <p className="text-xs font-bold text-primary uppercase tracking-widest">Resumo da Fatura (extraído do PDF)</p>
      </div>
      <div className="divide-y divide-border/20 bg-white">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between px-5 py-2.5">
            <span className="text-xs font-medium text-muted-foreground">{r.label}</span>
            <span className={`tabular text-sm font-700 font-mono ${r.color}`}>{fmtBRL(r.value)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between px-5 py-3 bg-muted/10">
          <span className="text-xs font-bold uppercase tracking-widest text-foreground">Total a pagar</span>
          <span className="tabular text-base font-800 font-mono text-primary">{fmtBRL(summary.totalAmount)}</span>
        </div>
      </div>
    </div>
  );
}

/* ── CSV Export helper ── */
function exportCSV(txs: RawTransaction[], filename: string) {
  const header = "Data;Descrição;Categoria;Parcela;Valor (R$)";
  const rows = txs.map((t) => {
    const inst = t.installment ? `${t.installment.current}/${t.installment.total}` : "";
    const val = t.amount.toFixed(2).replace(".", ",");
    const desc = t.description.replace(/;/g, ",");
    return `${t.date};${desc};${t.category};${inst};${val}`;
  });
  const csv = [header, ...rows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/\.[^/.]+$/, "") + "_auditoria.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Sort transactions by dd/mm numerically ── */
function sortByDate(txs: RawTransaction[]): RawTransaction[] {
  return [...txs].sort((a, b) => {
    // Build a sortable timestamp using invoiceDueDate year + DD/MM day/month.
    // Transactions store date as "DD/MM" without year; invoiceDueDate (YYYY-MM-DD)
    // gives us the correct year even when a statement spans a year boundary.
    const toSortKey = (t: RawTransaction): number => {
      const [d, m] = (t.date || "").split("/").map(Number);
      if (!d || !m) return 0;

      let year = new Date().getFullYear(); // fallback
      const ref = t.invoiceDueDate || extractDateFromFilename(t.source);
      if (ref) {
        const dueYear = Number(ref.slice(0, 4));
        const dueMon = Number(ref.slice(5, 7));
        // If the transaction month is AFTER the due month it belongs to the
        // previous calendar year (e.g. Dec purchases on a Jan invoice).
        year = m > dueMon ? dueYear - 1 : dueYear;
      }
      return year * 10000 + m * 100 + d;
    };
    const keyA = toSortKey(a);
    const keyB = toSortKey(b);
    if (keyA !== keyB) return keyA - keyB;
    return (a.description || "").localeCompare(b.description || "");
  });
}

/* ── Revisar Fatura ── */
function RevisarView({
  txs,
  onUpdateCategory,
  invoiceSources,
  activeSource,
  setActiveSource,
  categoriesList,
  summaries,
}: {
  txs: RawTransaction[];
  onUpdateCategory?: (id: string, newCategory: string) => void;
  invoiceSources: string[];
  activeSource: string;
  setActiveSource: (s: string) => void;
  categoriesList: string[];
  summaries: Record<string, InvoiceSummary>;
}) {
  const filtered = useMemo(() => {
    if (!activeSource) return [];
    return sortByDate(txs.filter((t) => t.source === activeSource));
  }, [txs, activeSource]);

  const activeSummary = summaries ? summaries[activeSource] : undefined;

  const totalFatura = useMemo(() => {
    if (activeSummary?.totalAmount && activeSummary.totalAmount > 0) {
      return activeSummary.totalAmount;
    }
    const prevBal = activeSummary?.previousBalance || 0;
    return prevBal + filtered.reduce((s, t) => {
      const val = t.category === "Pagamentos/Créditos" ? (t.amount > 0 ? -t.amount : t.amount) : t.amount;
      return s + val;
    }, 0);
  }, [filtered, activeSummary]);

  const totalJurosFat = useMemo(() => {
    return filtered.filter((t) => t.amount > 0 && t.category === "Tarifas").reduce((s, t) => s + t.amount, 0);
  }, [filtered]);

  const totalCreditosFat = useMemo(() => {
    return filtered.filter((t) => t.amount < 0 || t.category === "Pagamentos/Créditos").reduce((s, t) => {
      const val = t.amount < 0 ? t.amount : -t.amount;
      return s + val;
    }, 0);
  }, [filtered]);

  const totalComprasFat = useMemo(() => {
    return filtered.filter((t) => t.amount > 0 && t.category !== "Tarifas" && t.category !== "Pagamentos/Créditos").reduce((s, t) => s + t.amount, 0);
  }, [filtered]);

  // Get invoice due date for display
  const invoiceDueDate = useMemo(() => {
    const sample = filtered.find((t) => t.invoiceDueDate);
    if (!sample?.invoiceDueDate) return null;
    const [y, m, d] = sample.invoiceDueDate.split("-");
    return `${d}/${m}/${y}`;
  }, [filtered]);

  const invoiceCategories = useMemo(() => {
    const cats = new Set(filtered.map((t) => t.category));
    const list = categoriesList.filter((c) => cats.has(c));
    for (const c of cats) {
      if (!list.includes(c)) {
        list.push(c);
      }
    }
    return list;
  }, [filtered, categoriesList]);

  return (
    <div className="glass-card overflow-hidden">
      <div className="p-5 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between border-b border-border/40 bg-muted/20">
        <div>
          <SectionTitle eyebrow="Filtro de Fatura" title="Revisão de Lançamentos" />
          <p className="text-xs text-muted-foreground mt-1">
            Selecione a fatura e revise/reclassifique os lançamentos por categoria.
          </p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-muted-foreground whitespace-nowrap">Fatura:</label>
            <select
              value={activeSource}
              onChange={(e) => setActiveSource(e.target.value)}
              className="w-full sm:w-64 text-sm font-semibold bg-white border border-border/60 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/40 transition-all duration-200 shadow-sm text-foreground/80"
            >
              {invoiceSources.map((src) => (
                <option key={src} value={src}>
                  {src.replace(/\.[^/.]+$/, "")}
                </option>
              ))}
            </select>
          </div>
          {filtered.length > 0 && (
            <button
              onClick={() => exportCSV(filtered, activeSource)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-white border border-border/60 hover:border-primary/40 hover:text-primary rounded-lg transition-all duration-200 shadow-sm text-muted-foreground"
              title="Exportar lançamentos desta fatura em CSV"
            >
              <Download className="size-3.5" />
              Exportar CSV
            </button>
          )}
        </div>
      </div>

      {activeSource ? (
        <>
          {/* Summary Banner */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 p-5 border-b border-border/30 bg-muted/5">
            <div className="bg-white border border-border/50 rounded-xl p-4 shadow-sm">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Total da Fatura</p>
              <p className="font-display text-2xl font-800 text-primary tabular-nums">{fmtBRL(totalFatura)}</p>
            </div>
            <div className="bg-white border border-border/50 rounded-xl p-4 shadow-sm">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Compras</p>
              <p className="font-display text-2xl font-800 text-foreground tabular-nums">{fmtBRL(totalComprasFat)}</p>
            </div>
            <div className="bg-white border border-border/50 rounded-xl p-4 shadow-sm">
              <p className="text-[10px] font-bold text-emerald-600/80 uppercase tracking-widest mb-1">Créditos / Pagos</p>
              <p className="font-display text-2xl font-800 text-emerald-600 tabular-nums">{fmtBRL(totalCreditosFat)}</p>
            </div>
            <div className="bg-white border border-border/50 rounded-xl p-4 shadow-sm">
              <p className="text-[10px] font-bold text-destructive/70 uppercase tracking-widest mb-1">Tarifas / Encargos</p>
              <p className="font-display text-2xl font-800 text-destructive tabular-nums">{fmtBRL(totalJurosFat)}</p>
            </div>
            <div className="col-span-2 md:col-span-1 bg-white border border-border/50 rounded-xl p-4 shadow-sm">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Lançamentos</p>
              <p className="font-display text-2xl font-800 text-foreground/80">{filtered.length}</p>
              {invoiceDueDate && (
                <p className="text-[9px] text-muted-foreground mt-1 flex items-center gap-1">
                  <Calendar className="size-2.5" /> Venc. {invoiceDueDate}
                </p>
              )}
            </div>
          </div>

          {/* Invoice Summary extracted from PDF — shown BEFORE transactions */}
          {activeSummary && (
            <div className="px-5 pt-5">
              <InvoiceSummaryPanel summary={activeSummary} />
            </div>
          )}

          {/* Grouped by Category View */}
          <div className="p-5 flex flex-col gap-6">
            {invoiceCategories.length === 0 && (
              <div className="text-center py-10 text-muted-foreground text-sm">
                <FileText className="size-8 mx-auto mb-3 opacity-30" />
                Nenhum lançamento encontrado nesta fatura.
              </div>
            )}
            {invoiceCategories.map((cat) => {
              const catTxs = sortByDate(filtered.filter((t) => t.category === cat));
              const catTotal = catTxs.reduce((s, t) => s + t.amount, 0);
              const isTarifa = cat === "Tarifas";
              
              return (
                <div key={cat} className={`border rounded-xl overflow-hidden shadow-sm bg-white ${
                  isTarifa ? "border-destructive/30" : "border-border/40"
                }`}>
                  {/* Category Header */}
                  <div className={`px-5 py-3 border-b flex items-center justify-between ${
                    isTarifa
                      ? "bg-destructive/5 border-destructive/20"
                      : "bg-muted/30 border-border/30"
                  }`}>
                    <div className="flex items-center gap-2">
                      <span className={`p-1.5 rounded-lg flex items-center justify-center ${
                        isTarifa ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
                      }`}>
                        {getCatIcon(cat)}
                      </span>
                      <h4 className={`font-display font-700 text-sm ${
                        isTarifa ? "text-destructive" : "text-foreground"
                      }`}>{cat}</h4>
                      <span className="text-[11px] text-muted-foreground font-medium">
                        ({catTxs.length} {catTxs.length === 1 ? "lançamento" : "lançamentos"})
                      </span>
                    </div>
                    <div className={`font-display font-700 text-sm tabular-nums ${
                      isTarifa ? "text-destructive" : "text-primary"
                    }`}>
                      Subtotal: {fmtBRL(catTotal)}
                    </div>
                  </div>

                  {/* Transactions Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/10 text-[9px] font-bold uppercase tracking-widest text-muted-foreground border-b border-border/20">
                          <th className="text-left px-5 py-2.5 w-[90px]">Data</th>
                          <th className="text-left px-5 py-2.5">Descrição</th>
                          <th className="text-left px-5 py-2.5 w-[160px]">Reclassificar</th>
                          <th className="text-right px-5 py-2.5 w-[110px]">Valor</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/10">
                        {catTxs.map((t) => (
                          <tr id={`tx-${t.id}`} key={t.id} className="hover:bg-primary/[0.015] transition-colors duration-100">
                            <td className="px-5 py-2.5 tabular text-muted-foreground text-xs font-mono font-medium">
                              {t.date}
                            </td>
                            <td className="px-5 py-2.5 font-semibold text-foreground max-w-[320px] truncate" title={t.description}>
                              {t.description}
                              {t.installment && (
                                <span className="ml-2 pill text-[9px] px-1.5 py-0.5 align-middle">
                                  {t.installment.current}/{t.installment.total}
                                </span>
                              )}
                            </td>
                            <td className="px-5 py-2.5">
                              <select
                                value={t.category}
                                onChange={(e) => onUpdateCategory?.(t.id, e.target.value)}
                                className="w-full max-w-[150px] text-xs font-medium bg-white/60 hover:bg-white border border-border/50 hover:border-primary/40 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-150 cursor-pointer shadow-sm text-foreground/80 hover:text-foreground font-sans appearance-none"
                                style={{
                                  backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b' stroke-width='2.5'><path stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/></svg>")`,
                                  backgroundRepeat: "no-repeat",
                                  backgroundPosition: "right 8px center",
                                  backgroundSize: "8px",
                                  paddingRight: "24px",
                                }}
                              >
                                {categoriesList.map((c) => (
                                  <option key={c} value={c}>{c}</option>
                                ))}
                              </select>
                            </td>
                            <td className={`px-5 py-2.5 text-right tabular font-700 font-mono ${
                              t.amount < 0 || t.category === "Pagamentos/Créditos" ? "text-emerald-600" : isTarifa ? "text-destructive" : "text-foreground"
                            }`}>
                              {fmtBRL(t.category === "Pagamentos/Créditos" && t.amount > 0 ? -t.amount : t.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Subtotal footer */}
                  <div className={`px-5 py-2.5 border-t flex items-center justify-between ${
                    isTarifa
                      ? "bg-destructive/5 border-destructive/15"
                      : "bg-muted/10 border-border/20"
                  }`}>
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                      Total {cat}
                    </span>
                    <span className={`font-display font-800 text-sm tabular-nums ${
                      isTarifa ? "text-destructive" : "text-foreground"
                    }`}>{fmtBRL(catTotal)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Grand total footer */}
          {invoiceCategories.length > 0 && (
            <div className="mx-5 mb-5 border border-primary/25 rounded-xl bg-primary/5 px-6 py-4 flex items-center justify-between shadow-sm">
              <div>
                <p className="text-[10px] font-bold text-primary uppercase tracking-widest">Total geral desta fatura</p>
                <p className="text-xs text-muted-foreground mt-0.5">{filtered.length} lançamentos · {invoiceCategories.length} categorias</p>
              </div>
              <p className="font-display text-3xl font-800 text-primary tabular-nums">{fmtBRL(totalFatura)}</p>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-16 text-muted-foreground text-sm">
          Nenhuma fatura disponível para revisão.
        </div>
      )}
    </div>
  );
}

/* ── Relatórios: Filtros + Impressão ── */
function ReportsView({ txs, categoriesList }: { txs: RawTransaction[]; categoriesList: string[] }) {
  const availableCats = useMemo(() => {
    const present = new Set(txs.map((t) => t.category));
    return categoriesList.filter((c) => present.has(c));
  }, [txs, categoriesList]);

  const months = useMemo(() => {
    const set = new Set<string>();
    txs.forEach((t) => {
      const ref = t.invoiceDueDate || extractDateFromFilename(t.source);
      if (ref && /^\d{4}-\d{2}/.test(ref)) {
        set.add(ref.slice(0, 7));
      }
    });
    return Array.from(set).sort();
  }, [txs]);

  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());
  const [startMonth, setStartMonth] = useState<string>("all");
  const [endMonth, setEndMonth] = useState<string>("all");
  const [mode, setMode] = useState<"resumido" | "detalhado">("resumido");
  const [includeFuture, setIncludeFuture] = useState(false);
  const [generated, setGenerated] = useState(false);

  const futureInstallments = useMemo(() => {
    const projected = projectFutureInstallments(txs);
    return projected.filter((f) => {
      if (startMonth !== "all" && f.month < startMonth) return false;
      if (endMonth !== "all" && f.month > endMonth) return false;
      return true;
    });
  }, [txs, startMonth, endMonth]);

  const toggleCat = (c: string) => {
    setSelectedCats((prev) => {
      const n = new Set(prev);
      if (n.has(c)) n.delete(c); else n.add(c);
      return n;
    });
  };
  const selectAll = () => setSelectedCats(new Set(availableCats));
  const clearAll = () => setSelectedCats(new Set());

  const filtered = useMemo(() => {
    return txs.filter((t) => {
      if (selectedCats.size > 0 && !selectedCats.has(t.category)) return false;
      if (startMonth !== "all" || endMonth !== "all") {
        const ref = t.invoiceDueDate || extractDateFromFilename(t.source);
        const m = ref?.slice(0, 7);
        if (!m) return false;
        if (startMonth !== "all" && m < startMonth) return false;
        if (endMonth !== "all" && m > endMonth) return false;
      }
      // Reports focus on actual spending (positive amounts, exclude payments/credits)
      if (t.category === "Pagamentos/Créditos") return false;
      if (t.amount <= 0) return false;
      return true;
    });
  }, [txs, selectedCats, startMonth, endMonth]);

  const grouped = useMemo(() => {
    const map = new Map<string, RawTransaction[]>();
    filtered.forEach((t) => {
      if (!map.has(t.category)) map.set(t.category, []);
      map.get(t.category)!.push(t);
    });
    return Array.from(map.entries())
      .map(([cat, list]) => ({
        category: cat,
        // Sort by invoice month (YYYY-MM) chronologically, then by day within the month
        items: [...list].sort((a, b) => {
          const refA = a.invoiceDueDate || extractDateFromFilename(a.source) || "";
          const refB = b.invoiceDueDate || extractDateFromFilename(b.source) || "";
          const monthA = refA.slice(0, 7); // YYYY-MM
          const monthB = refB.slice(0, 7);
          if (monthA !== monthB) return monthA.localeCompare(monthB);
          // Same invoice month: sort by transaction day
          const [dA, mA] = (a.date || "").split("/").map(Number);
          const [dB, mB] = (b.date || "").split("/").map(Number);
          const dayKeyA = (mA || 0) * 100 + (dA || 0);
          const dayKeyB = (mB || 0) * 100 + (dB || 0);
          if (dayKeyA !== dayKeyB) return dayKeyA - dayKeyB;
          return (a.description || "").localeCompare(b.description || "");
        }),
        total: list.reduce((s, t) => s + t.amount, 0),
      }))
      .sort((a, b) => b.total - a.total);
  }, [filtered]);

  const grandTotal = grouped.reduce((s, g) => s + g.total, 0);
  const itemCount = filtered.length;

  const periodLabel = (() => {
    if (startMonth === "all" && endMonth === "all") return "Todos os períodos";
    const fmt = (m: string) => {
      if (m === "all") return "—";
      const [y, mm] = m.split("-");
      return `${mm}/${y}`;
    };
    return `${fmt(startMonth)} até ${fmt(endMonth)}`;
  })();

  const todayLabel = new Date().toLocaleDateString("pt-BR");

  return (
    <div className="space-y-6">
      {/* Filtros (no-print) */}
      <div className="glass-card card-accent-top p-6 no-print">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display text-xl font-700 text-foreground">Relatórios</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Gere relatórios filtrados e imprima.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setGenerated(true)}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
            >
              Gerar Relatório
            </button>
            <button
              onClick={() => window.print()}
              disabled={!generated}
              className="px-4 py-2 text-xs font-semibold rounded-lg border border-border bg-white hover:bg-muted/60 transition-colors disabled:opacity-50"
            >
              Imprimir
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-foreground">Categorias</label>
              <div className="flex gap-2 text-xs">
                <button onClick={selectAll} className="text-primary hover:underline">Todas</button>
                <button onClick={clearAll} className="text-muted-foreground hover:underline">Limpar</button>
              </div>
            </div>
            <div className="max-h-56 overflow-auto border border-border/60 rounded-lg p-2 bg-white space-y-1">
              {availableCats.map((c) => (
                <label key={c} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={selectedCats.has(c)}
                    onChange={() => toggleCat(c)}
                    className="accent-primary"
                  />
                  {c}
                </label>
              ))}
              {availableCats.length === 0 && (
                <div className="text-xs text-muted-foreground p-2">Nenhuma categoria disponível.</div>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {selectedCats.size === 0 ? "Nenhuma selecionada = todas." : `${selectedCats.size} selecionada(s)`}
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-foreground block mb-2">Período</label>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={startMonth}
                  onChange={(e) => setStartMonth(e.target.value)}
                  className="text-sm border border-border rounded-lg px-3 py-2 bg-white"
                >
                  <option value="all">Início (todos)</option>
                  {months.map((m) => {
                    const [y, mm] = m.split("-");
                    return <option key={m} value={m}>{mm}/{y}</option>;
                  })}
                </select>
                <select
                  value={endMonth}
                  onChange={(e) => setEndMonth(e.target.value)}
                  className="text-sm border border-border rounded-lg px-3 py-2 bg-white"
                >
                  <option value="all">Fim (todos)</option>
                  {months.map((m) => {
                    const [y, mm] = m.split("-");
                    return <option key={m} value={m}>{mm}/{y}</option>;
                  })}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-foreground block mb-2">Modo</label>
              <div className="inline-flex border border-border rounded-lg overflow-hidden">
                <button
                  onClick={() => setMode("resumido")}
                  className={`px-4 py-2 text-xs font-semibold transition-colors ${mode === "resumido" ? "bg-primary text-white" : "bg-white text-foreground hover:bg-muted/60"}`}
                >
                  Resumido
                </button>
                <button
                  onClick={() => setMode("detalhado")}
                  className={`px-4 py-2 text-xs font-semibold transition-colors ${mode === "detalhado" ? "bg-primary text-white" : "bg-white text-foreground hover:bg-muted/60"}`}
                >
                  Detalhado
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-foreground block mb-2">Parcelas futuras</label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeFuture}
                  onChange={(e) => setIncludeFuture(e.target.checked)}
                  className="accent-primary w-4 h-4"
                />
                <span className="text-sm text-foreground/80">Incluir no relatório</span>
              </label>
              {includeFuture && futureInstallments.length === 0 && (
                <p className="text-[11px] text-muted-foreground mt-1">Nenhuma parcela futura detectada.</p>
              )}
              {includeFuture && futureInstallments.length > 0 && (
                <p className="text-[11px] text-primary mt-1">{futureInstallments.reduce((s, f) => s + f.items.length, 0)} parcela(s) em {futureInstallments.length} mês(es)</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Relatório (printable) */}
      {generated && (
        <div id="report-output" className="glass-card p-8 print-area">
          <header className="border-b-2 border-foreground pb-4 mb-6">
            <h1 className="font-display text-2xl font-700 text-foreground">Relatório de Gastos</h1>
            <div className="flex justify-between text-sm text-muted-foreground mt-2">
              <span>Período: {periodLabel}</span>
              <span>Emitido em: {todayLabel}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Modo: {mode === "resumido" ? "Resumido" : "Detalhado"}
              {selectedCats.size > 0 && ` · ${selectedCats.size} categoria(s) selecionada(s)`}
            </div>
          </header>

          {grouped.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Nenhum lançamento encontrado para os filtros aplicados.
            </div>
          ) : mode === "resumido" ? (
            <table className="w-full text-sm report-table">
              <thead>
                <tr className="border-b border-foreground/30">
                  <th className="text-left py-2 px-3 font-semibold">Categoria</th>
                  <th className="text-right py-2 px-3 font-semibold">Total</th>
                  <th className="text-right py-2 px-3 font-semibold">Itens</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map((g) => (
                  <tr key={g.category} className="border-b border-foreground/10">
                    <td className="py-2 px-3">{g.category}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{fmtBRL(g.total)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{g.items.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="space-y-6">
              {grouped.map((g) => (
                <section key={g.category} className="category-block">
                  <h3 className="font-display text-base font-700 text-foreground border-b border-foreground/40 pb-1 mb-2">
                    {g.category}
                  </h3>
                  <table className="w-full text-sm report-table">
                    <thead>
                      <tr className="border-b border-foreground/20">
                        <th className="text-left py-1 px-2 font-semibold w-20">Data</th>
                        <th className="text-left py-1 px-2 font-semibold w-24">Fatura</th>
                        <th className="text-left py-1 px-2 font-semibold">Descrição</th>
                        <th className="text-right py-1 px-2 font-semibold w-28">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.items.map((t) => {
                        const ref = t.invoiceDueDate || extractDateFromFilename(t.source) || "";
                        const MES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
                        const [yy, mm] = ref ? ref.split("-") : ["", ""];
                        const faturaLabel = yy && mm ? `${MES[Number(mm) - 1] ?? mm}/${yy}` : "—";
                        return (
                          <tr key={t.id} className="border-b border-foreground/5">
                            <td className="py-1 px-2 tabular-nums">{t.date}</td>
                            <td className="py-1 px-2 tabular-nums whitespace-nowrap">{faturaLabel}</td>
                            <td className="py-1 px-2">{t.description}</td>
                            <td className="py-1 px-2 text-right tabular-nums">{fmtBRL(t.amount)}</td>
                          </tr>
                        );
                      })}
                      <tr className="border-t border-foreground/30 font-semibold">
                        <td className="py-1 px-2" colSpan={3}>Subtotal · {g.items.length} item(s)</td>
                        <td className="py-1 px-2 text-right tabular-nums">{fmtBRL(g.total)}</td>
                      </tr>
                    </tbody>

                  </table>
                </section>
              ))}
            </div>
          )}

          <footer className="border-t-2 border-foreground mt-6 pt-3 flex justify-between text-sm font-semibold">
            <span>Total de lançamentos: {itemCount}</span>
            <span>Total geral: {fmtBRL(grandTotal)}</span>
          </footer>

          {/* Parcelas futuras — seção imprimível */}
          {includeFuture && futureInstallments.length > 0 && (
            <section className="mt-8 pt-6 border-t-2 border-foreground">
              <h2 className="font-display text-lg font-700 text-foreground mb-4">Parcelas Futuras Projetadas</h2>
              {futureInstallments.map((f) => (
                <div key={f.month} className="mb-6 category-block">
                  <h3 className="font-display text-base font-700 text-foreground border-b border-foreground/40 pb-1 mb-2 capitalize">
                    {f.label} — {fmtBRL(f.total)}
                  </h3>
                  <table className="w-full text-sm report-table">
                    <thead>
                      <tr className="border-b border-foreground/20">
                        <th className="text-left py-1 px-2 font-semibold">Descrição</th>
                        <th className="text-center py-1 px-2 font-semibold w-20">Parcela</th>
                        <th className="text-right py-1 px-2 font-semibold w-28">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {f.items.map((it, i) => (
                        <tr key={i} className="border-b border-foreground/5">
                          <td className="py-1 px-2">{it.description}</td>
                          <td className="py-1 px-2 text-center tabular-nums">{it.remaining}</td>
                          <td className="py-1 px-2 text-right tabular-nums">{fmtBRL(it.amount)}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-foreground/30 font-semibold">
                        <td className="py-1 px-2" colSpan={2}>Subtotal · {f.items.length} parcela(s)</td>
                        <td className="py-1 px-2 text-right tabular-nums">{fmtBRL(f.total)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ))}
              <div className="border-t-2 border-foreground pt-3 flex justify-between text-sm font-semibold">
                <span>Total parcelas futuras ({futureInstallments.reduce((s, f) => s + f.items.length, 0)} parcelas)</span>
                <span>{fmtBRL(futureInstallments.reduce((s, f) => s + f.total, 0))}</span>
              </div>
            </section>
          )}
        </div>
      )}

      <style>{`
        @media print {
          @page { margin: 1.5cm; size: A4; }

          /* Esconde header, KPIs, barra de abas e painel de filtros
             (todos marcados com .no-print no JSX).
             O #report-output fica no fluxo normal = paginação correta. */
          .no-print { display: none !important; }

          /* Limpa fundo e sombras do tema */
          html, body { background: white !important; color: black !important; }

          #report-output {
            background: white !important;
            color: black !important;
            box-shadow: none !important;
            border: none !important;
            backdrop-filter: none !important;
            padding: 0 !important;
            margin: 0 !important;
            width: 100% !important;
          }
          #report-output * {
            color: black !important;
            background: transparent !important;
            box-shadow: none !important;
            border-color: #555 !important;
          }

          /* Evita corte de categorias e linhas no meio da página */
          .category-block { page-break-inside: avoid; break-inside: avoid; }
          .report-table thead tr { page-break-inside: avoid; }
          .report-table tr { page-break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}
