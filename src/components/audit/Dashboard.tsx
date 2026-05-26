import { useMemo, useRef, useState } from "react";
import type { RawTransaction, InvoiceSummary } from "@/lib/pdfExtract";
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

type Tab = "panorama" | "revisar" | "categorias" | "mensal" | "ranking" | "parcelas" | "insights" | "ledger";

export function Dashboard({ txs, onClear, onUpdateCategory, categoriesList, onAddCategory, onRenameCategory, summaries, headerActions }: Props) {
  const [tab, setTab] = useState<Tab>("panorama");
  const [selectedMonth, setSelectedMonth] = useState<string>("");

  const positives = useMemo(() => txs.filter((t) => t.amount > 0), [txs]);
  const months = useMemo(() => {
    const rawMonths = aggregateByMonth(txs);
    return rawMonths.map(m => {
      // Find all sources (files) contributing to this month's transactions
      const sourcesForMonth = Array.from(new Set(
        txs.filter(t => (t.invoiceDueDate ? t.invoiceDueDate.slice(0, 7) : "Outros") === m.month)
           .map(t => t.source)
      ));
      
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

      const monthNegatives = txs.filter(t => t.amount < 0 && (t.invoiceDueDate ? t.invoiceDueDate.slice(0, 7) : "Outros") === m.month);
      const creditsTotal = monthNegatives.reduce((acc, t) => acc + t.amount, 0);

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
  const totalAlim  = positives.filter(t => t.category === "Alimentação" || t.category === "Mercado").reduce((s, t) => s + t.amount, 0);
  const totalTrans = positives.filter(t => t.category === "Transporte").reduce((s, t) => s + t.amount, 0);

  const monthDelta = (() => {
    if (months.length < 2) return null;
    const a = months[months.length - 2].total;
    const b = months[months.length - 1].total;
    return ((b - a) / a) * 100;
  })();

  const invoiceSources = useMemo(() => {
    const sources = new Set(txs.map((t) => t.source));
    return Array.from(sources).sort();
  }, [txs]);

  const [selectedSource, setSelectedSource] = useState<string>("");
  const activeSource = selectedSource || invoiceSources[0] || "";

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "panorama",   label: "Panorama",       icon: <BarChart2 className="size-3.5" /> },
    { id: "revisar",    label: "Revisar Fatura",  icon: <ListFilter className="size-3.5" /> },
    { id: "categorias", label: "Categorias",     icon: <Tag className="size-3.5" /> },
    { id: "mensal",     label: "Mensal",         icon: <Calendar className="size-3.5" /> },
    { id: "ranking",    label: "Ranking",        icon: <TrendingUp className="size-3.5" /> },
    { id: "parcelas",   label: "Parcelas",       icon: <CreditCard className="size-3.5" /> },
    { id: "insights",   label: "Insights",       icon: <Sparkles className="size-3.5" /> },
    { id: "ledger",     label: "Razão",          icon: <ChevronRight className="size-3.5" /> },
  ];

  return (
    <div className="mt-10">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-1">Relatório Consolidado</p>
          <h2 className="font-display text-2xl md:text-3xl font-700 tracking-tight">Parecer de Auditoria</h2>
        </div>
        <div className="flex items-center gap-3">
          {headerActions}
          <button
            onClick={onClear}
            className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-destructive bg-white border border-border/60 hover:border-destructive/30 px-3 py-2.5 rounded-lg transition-all duration-200 shadow-sm"
          >
            <Trash2 className="size-3.5" /> Limpar análise
          </button>
        </div>
      </div>

      {/* ── VISÃO GERAL (KPIs em Cards com Borda Superior) ── */}
      <div className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">Visão Geral · {months.length} Meses</p>
          <div className="h-px bg-border flex-1 ml-2 opacity-50" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <KpiTopBorder
            label="Total das faturas"
            value={fmtBRL(totalFaturasConsolidado)}
            sub={`${months.map(m => m.label.split(" ")[0]).join(" + ")}`}
            color="oklch(0.47 0.21 270)"
            valueColor="text-[#1e40af]"
          />
          <KpiTopBorder
            label="Total juros/encargos"
            value={fmtBRL(totalJuros)}
            sub={totalJuros > 0 ? "Atenção a taxas e multas" : "Nenhum juro cobrado"}
            color="oklch(0.60 0.20 25)"
            valueColor="text-[#dc2626]"
            alert={totalJuros > 0}
          />
          <KpiTopBorder
            label="Total alimentação"
            value={fmtBRL(totalAlim)}
            sub="Rest. + Mercado"
            color="oklch(0.55 0.16 155)"
            valueColor="text-[#0f766e]"
          />
          <KpiTopBorder
            label="Total transporte"
            value={fmtBRL(totalTrans)}
            sub="Uber, Gasolina, etc."
            color="oklch(0.35 0.05 250)"
            valueColor="text-[#334155]"
          />
          <KpiTopBorder
            label="Parcelas futuras"
            value={fmtBRL(futureTotal)}
            sub="Saldo restante em aberto"
            color="oklch(0.76 0.13 72)"
            valueColor="text-[#d97706]"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-white border border-border/60 rounded-xl shadow-sm mb-8 overflow-x-auto">
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
          />
        )}
        {tab === "mensal"     && <MonthlyView months={months} />}
        {tab === "ranking"    && <RankingView biggest={biggest} smallest={smallest} />}
        {tab === "parcelas"   && <FutureView future={future} />}
        {tab === "insights"   && <InsightsView insights={insights} />}
        {tab === "ledger"     && <LedgerView txs={txs} />}
      </div>
    </div>
  );
}

/* ── KPI Card com borda superior colorida ── */
function KpiTopBorder({ label, value, sub, color, valueColor, alert }: any) {
  return (
    <div 
      className="glass-card overflow-hidden flex flex-col justify-between"
      style={{ borderTop: `4px solid ${color}` }}
    >
      <div className="p-5">
        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-[0.15em] mb-3">{label}</p>
        <p className={`font-display text-2xl font-800 tabular tracking-tighter ${valueColor}`}>{value}</p>
      </div>
      <div className="px-5 py-3 bg-muted/20 border-t border-border/30 flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground font-medium">{sub}</p>
        {alert && <AlertTriangle className="size-3 text-destructive" />}
      </div>
    </div>
  );
}

/* ── Categorias Icons Helper ── */
const getCatIcon = (cat: string) => {
  switch (cat) {
    case "Alimentação": return <Utensils className="size-3.5" />;
    case "Mercado": return <ShoppingCart className="size-3.5" />;
    case "Transporte": return <CarFront className="size-3.5" />;
    case "Assinaturas": return <Tv className="size-3.5" />;
    case "Saúde": return <Stethoscope className="size-3.5" />;
    case "Lazer": return <Ticket className="size-3.5" />;
    case "Educação": return <GraduationCap className="size-3.5" />;
    case "Serviços": return <Zap className="size-3.5" />;
    case "Vestuário": return <Briefcase className="size-3.5" />;
    case "Tarifas": return <ShieldAlert className="size-3.5 text-destructive" />;
    case "Pagamentos/Créditos": return <CheckCircle2 className="size-3.5 text-emerald-600" />;
    default: return <CreditCard className="size-3.5" />;
  }
};

/* ── Panorama ── */
function Panorama({ months, categories, txs }: {
  months: MonthAgg[]; categories: ReturnType<typeof aggregateByCategory>; txs: RawTransaction[];
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
                        {monthName}
                      </h3>
                      <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest mt-0.5">{yearShort}</p>
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

      {/* ── 2. Assinaturas e Recorrências ── */}
      {subList.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-5">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">Plataformas, IAs & Streamings</p>
            <div className="h-px bg-border flex-1 ml-2 opacity-50" />
          </div>
          <div className="glass-card p-6 border-t-4 border-t-[#8b5cf6]">
            <div className="flex flex-col md:flex-row gap-8">
              <div className="md:w-64 border-b md:border-b-0 md:border-r border-border/40 pb-6 md:pb-0 md:pr-6 flex flex-col justify-center">
                <div className="size-10 rounded-xl bg-purple-100 flex items-center justify-center mb-4 border border-purple-200">
                  <Tv className="size-5 text-purple-600" />
                </div>
                <h3 className="font-display text-lg font-700">Levantamento de Assinaturas</h3>
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                  Custo recorrente estimado baseado nos serviços digitais identificados na fatura.
                </p>
                <div className="mt-6">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Custo Mensal</p>
                  <p className="font-display text-3xl font-800 text-purple-700">{fmtBRL(totalSubs)}</p>
                </div>
              </div>
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {subList.map((sub, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-xl border border-border/40 bg-muted/10 hover:bg-muted/30 transition-colors">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate max-w-[120px]" title={sub.desc}>{sub.desc}</p>
                      <p className="text-[9px] text-muted-foreground uppercase tracking-widest mt-0.5">{sub.occurrences} cobranças</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs font-bold font-mono">{fmtBRL(sub.amount)}</p>
                      <p className="text-[9px] text-muted-foreground uppercase tracking-widest mt-0.5">/mês</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

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
function CategoriesView({ categories, total, categoriesList, onAddCategory, onRenameCategory }: {
  categories: ReturnType<typeof aggregateByCategory>;
  total: number;
  categoriesList: string[];
  onAddCategory: (name: string) => void;
  onRenameCategory: (oldName: string, newName: string) => void;
}) {
  const max = categories[0]?.total || 1;
  const [newCatName, setNewCatName] = useState("");
  const [editingCat, setEditingCat] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const editRef = useRef<HTMLInputElement>(null);

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
            <div key={c.category} className="grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-muted/30 transition-colors duration-150">
              <div className="col-span-1 text-center">
                <span className="text-[10px] font-mono font-bold text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
              </div>
              <div className="col-span-4">
                <div className="flex items-center gap-2.5">
                  <span className="size-2.5 rounded-full flex-shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                  <span className="font-semibold text-sm text-foreground">{c.category}</span>
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
    </div>
  );
}

/* ── Monthly ── */
function MonthlyView({ months }: { months: ReturnType<typeof aggregateByMonth> }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div className="glass-card p-6">
        <SectionTitle eyebrow="III·A" title="Volume por mês" />
        <div className="h-72 mt-5">
          <ResponsiveContainer>
            <BarChart data={months} barSize={32}>
              <CartesianGrid stroke="oklch(0.175 0.025 255 / 0.06)" strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="label" stroke="oklch(0.50 0.025 255)" tick={{ fontSize: 11, fontFamily: "var(--font-sans)", fontWeight: 500 }} />
              <YAxis stroke="oklch(0.50 0.025 255)" tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="total" fill="oklch(0.47 0.21 270)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="glass-card p-6">
        <SectionTitle eyebrow="III·B" title="Transações por mês" />
        <div className="h-72 mt-5">
          <ResponsiveContainer>
            <BarChart data={months} barSize={32}>
              <CartesianGrid stroke="oklch(0.175 0.025 255 / 0.06)" strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="label" stroke="oklch(0.50 0.025 255)" tick={{ fontSize: 11, fontFamily: "var(--font-sans)", fontWeight: 500 }} />
              <YAxis stroke="oklch(0.50 0.025 255)" tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="count" fill="oklch(0.54 0.18 295)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="lg:col-span-2 glass-card overflow-hidden">
        <div className="p-6 border-b border-border/40">
          <SectionTitle eyebrow="III·C" title="Tabela analítica mensal" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-b border-border/30">
                <th className="text-left px-6 py-3">Mês</th>
                <th className="text-right px-6 py-3">Lançamentos</th>
                <th className="text-right px-6 py-3">Total</th>
                <th className="text-right px-6 py-3">Ticket médio</th>
                <th className="text-left px-6 py-3">Categoria líder</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/25">
              {months.map((m: EnrichedMonth) => {
                const leader = Object.entries(m.byCategory).sort((a, b) => b[1] - a[1])[0];
                return (
                  <tr key={m.month} className="hover:bg-primary/[0.02] transition-colors duration-150">
                    <td className="px-6 py-4 font-semibold text-foreground">{m.label}</td>
                    <td className="px-6 py-4 text-right tabular text-muted-foreground">{m.count}</td>
                    <td className="px-6 py-4 text-right tabular font-semibold">{fmtBRL(m.total)}</td>
                    <td className="px-6 py-4 text-right tabular text-muted-foreground">{fmtBRL((m.originalTotal ?? m.total) / m.count)}</td>
                    <td className="px-6 py-4">
                      <span className="pill pill text-[10px]">{leader?.[0]}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── Ranking ── */
function RankingView({ biggest, smallest }: { biggest: RawTransaction[]; smallest: RawTransaction[] }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <RankCard title="Maiores despesas" icon={<TrendingUp className="size-4 text-destructive" />} items={biggest} eyebrow="IV·A" />
      <RankCard title="Menores despesas" icon={<TrendingDown className="size-4 text-positive" />} items={smallest} eyebrow="IV·B" muted />
    </div>
  );
}

function RankCard({ title, icon, items, eyebrow, muted }: {
  title: string; icon: React.ReactNode; items: RawTransaction[]; eyebrow: string; muted?: boolean;
}) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="p-6 border-b border-border/40 flex items-center gap-2.5">
        {icon}
        <SectionTitle eyebrow={eyebrow} title={title} />
      </div>
      <div className="divide-y divide-border/25">
        {items.map((t, i) => (
          <div key={t.id} className="flex items-center gap-4 px-6 py-3.5 hover:bg-muted/30 transition-colors duration-150">
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
                  <span className="ml-2 pill text-[9px] px-1.5 py-0.5">{it.remaining}</span>
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
    const parseDD = (date: string) => {
      const [d, m] = date.split("/").map(Number);
      return (m || 0) * 100 + (d || 0);
    };
    return parseDD(a.date) - parseDD(b.date);
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
    const prevBal = activeSummary?.previousBalance || 0;
    return prevBal + filtered.reduce((s, t) => s + t.amount, 0);
  }, [filtered, activeSummary]);

  const totalJurosFat = useMemo(() => {
    return filtered.filter((t) => t.amount > 0 && t.category === "Tarifas").reduce((s, t) => s + t.amount, 0);
  }, [filtered]);

  const totalCreditosFat = useMemo(() => {
    return filtered.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
  }, [filtered]);

  const totalComprasFat = useMemo(() => {
    return filtered.filter((t) => t.amount > 0 && t.category !== "Tarifas").reduce((s, t) => s + t.amount, 0);
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
                          <tr key={t.id} className="hover:bg-primary/[0.015] transition-colors duration-100">
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
                              t.amount < 0 ? "text-emerald-600" : isTarifa ? "text-destructive" : "text-foreground"
                            }`}>
                              {fmtBRL(t.amount)}
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
