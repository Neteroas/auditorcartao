import { useMemo, useState } from "react";
import type { RawTransaction } from "@/lib/pdfExtract";
import {
  aggregateByCategory,
  aggregateByMonth,
  fmtBRL,
  generateInsights,
  projectFutureInstallments,
} from "@/lib/analytics";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, PieChart, Pie, Cell, Area, AreaChart,
} from "recharts";
import {
  TrendingUp, TrendingDown, AlertTriangle, Sparkles,
  CheckCircle2, Calendar, Trash2, BarChart2, Tag, CreditCard,
  ChevronRight, ArrowUpRight, ArrowDownRight,
} from "lucide-react";

interface Props {
  txs: RawTransaction[];
  onClear: () => void;
}

/* ── Harmonious light-mode chart palette ── */
const CHART_COLORS = [
  "oklch(0.47 0.21 270)",   /* Royal Indigo */
  "oklch(0.54 0.18 295)",   /* Violet */
  "oklch(0.62 0.15 200)",   /* Ciano Soft */
  "oklch(0.76 0.13 72)",    /* Âmbar */
  "oklch(0.55 0.16 155)",   /* Esmeralda */
  "oklch(0.64 0.17 340)",   /* Rosa Soft */
  "oklch(0.60 0.14 30)",    /* Coral */
  "oklch(0.68 0.13 120)",   /* Lima */
];

type Tab = "panorama" | "categorias" | "mensal" | "ranking" | "parcelas" | "insights" | "ledger";

export function Dashboard({ txs, onClear }: Props) {
  const [tab, setTab] = useState<Tab>("panorama");

  const positives = useMemo(() => txs.filter((t) => t.amount > 0), [txs]);
  const months    = useMemo(() => aggregateByMonth(txs), [txs]);
  const categories = useMemo(() => aggregateByCategory(txs), [txs]);
  const future    = useMemo(() => projectFutureInstallments(txs), [txs]);
  const insights  = useMemo(() => generateInsights(txs), [txs]);

  const total      = positives.reduce((s, t) => s + t.amount, 0);
  const avg        = positives.length ? total / positives.length : 0;
  const biggest    = [...positives].sort((a, b) => b.amount - a.amount).slice(0, 10);
  const smallest   = [...positives].sort((a, b) => a.amount - b.amount).slice(0, 10);
  const futureTotal = future.reduce((s, f) => s + f.total, 0);

  const monthDelta = (() => {
    if (months.length < 2) return null;
    const a = months[months.length - 2].total;
    const b = months[months.length - 1].total;
    return ((b - a) / a) * 100;
  })();

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "panorama",   label: "Panorama",       icon: <BarChart2 className="size-3.5" /> },
    { id: "categorias", label: "Categorias",     icon: <Tag className="size-3.5" /> },
    { id: "mensal",     label: "Mensal",         icon: <Calendar className="size-3.5" /> },
    { id: "ranking",    label: "Ranking",        icon: <TrendingUp className="size-3.5" /> },
    { id: "parcelas",   label: "Parcelas",       icon: <CreditCard className="size-3.5" /> },
    { id: "insights",   label: "Insights",       icon: <Sparkles className="size-3.5" /> },
    { id: "ledger",     label: "Razão",          icon: <ChevronRight className="size-3.5" /> },
  ];

  return (
    <div className="mt-10">
      {/* Section header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-1">Relatório Consolidado</p>
          <h2 className="font-display text-2xl md:text-3xl font-700 tracking-tight">Parecer de Auditoria</h2>
        </div>
        <button
          onClick={onClear}
          className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-destructive bg-white border border-border/60 hover:border-destructive/30 px-3 py-2 rounded-lg transition-all duration-200 shadow-sm"
        >
          <Trash2 className="size-3.5" /> Limpar análise
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Kpi
          label="Total auditado"
          value={fmtBRL(total)}
          sub={`${positives.length} lançamentos`}
          accent="primary"
          icon={<CreditCard className="size-4" />}
        />
        <Kpi
          label="Ticket médio"
          value={fmtBRL(avg)}
          sub="por transação"
          accent="neutral"
          icon={<BarChart2 className="size-4" />}
        />
        <Kpi
          label="Variação mensal"
          value={monthDelta == null ? "—" : `${monthDelta > 0 ? "+" : ""}${monthDelta.toFixed(1)}%`}
          sub={monthDelta == null ? "necessita 2+ meses" : monthDelta > 0 ? "vs. mês anterior" : "vs. mês anterior"}
          accent={monthDelta != null && monthDelta > 0 ? "warning" : "positive"}
          icon={monthDelta != null && monthDelta > 0
            ? <ArrowUpRight className="size-4" />
            : <ArrowDownRight className="size-4" />}
        />
        <Kpi
          label="Compromisso futuro"
          value={fmtBRL(futureTotal)}
          sub={`${future.length} meses projetados`}
          accent="accent"
          icon={<Calendar className="size-4" />}
        />
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
        {tab === "panorama"   && <Panorama months={months} categories={categories} />}
        {tab === "categorias" && <CategoriesView categories={categories} total={total} />}
        {tab === "mensal"     && <MonthlyView months={months} />}
        {tab === "ranking"    && <RankingView biggest={biggest} smallest={smallest} />}
        {tab === "parcelas"   && <FutureView future={future} />}
        {tab === "insights"   && <InsightsView insights={insights} />}
        {tab === "ledger"     && <LedgerView txs={txs} />}
      </div>
    </div>
  );
}

/* ── KPI Card ── */
type KpiAccent = "primary" | "neutral" | "warning" | "positive" | "accent";

function Kpi({ label, value, sub, accent = "neutral", icon }: {
  label: string; value: string; sub: string; accent?: KpiAccent; icon?: React.ReactNode;
}) {
  const accentStyles: Record<KpiAccent, string> = {
    primary:  "text-primary",
    neutral:  "text-foreground",
    warning:  "text-warning",
    positive: "text-positive",
    accent:   "text-accent",
  };
  const iconBg: Record<KpiAccent, string> = {
    primary:  "bg-primary/10 text-primary border-primary/15",
    neutral:  "bg-muted/60 text-muted-foreground border-border/60",
    warning:  "bg-warning/10 text-warning border-warning/20",
    positive: "bg-positive/10 text-positive border-positive/20",
    accent:   "bg-accent/10 text-accent border-accent/15",
  };

  return (
    <div className="glass-card p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
        {icon && (
          <div className={`size-7 rounded-lg flex items-center justify-center border ${iconBg[accent]}`}>
            {icon}
          </div>
        )}
      </div>
      <div>
        <p className={`font-mono text-xl md:text-2xl font-700 tabular leading-none ${accentStyles[accent]}`}>{value}</p>
        <p className="text-[11px] text-muted-foreground mt-1.5 font-medium">{sub}</p>
      </div>
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

/* ── Panorama ── */
function Panorama({ months, categories }: {
  months: ReturnType<typeof aggregateByMonth>;
  categories: ReturnType<typeof aggregateByCategory>;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 glass-card p-6">
        <SectionTitle eyebrow="Fig. 01" title="Evolução de gastos por mês" />
        <div className="h-72 mt-5">
          <ResponsiveContainer>
            <AreaChart data={months}>
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="oklch(0.47 0.21 270)" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="oklch(0.47 0.21 270)" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="oklch(0.175 0.025 255 / 0.06)" strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="label" stroke="oklch(0.50 0.025 255)" tick={{ fontSize: 11, fontFamily: "var(--font-sans)", fontWeight: 500 }} />
              <YAxis stroke="oklch(0.50 0.025 255)" tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<ChartTip />} />
              <Area type="monotone" dataKey="total" stroke="oklch(0.47 0.21 270)" strokeWidth={2.5} fill="url(#areaGrad)" dot={{ fill: "oklch(0.47 0.21 270)", r: 4, strokeWidth: 2, stroke: "white" }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="glass-card p-6">
        <SectionTitle eyebrow="Fig. 02" title="Composição por categoria" />
        <div className="h-44 mt-4">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={categories.slice(0, 6)} dataKey="total" nameKey="category" innerRadius={48} outerRadius={80} paddingAngle={3}>
                {categories.slice(0, 6).map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={0} />
                ))}
              </Pie>
              <Tooltip content={<ChartTip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 space-y-2">
          {categories.slice(0, 5).map((c, i) => (
            <div key={c.category} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 min-w-0">
                <span className="size-2 rounded-full flex-shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                <span className="truncate font-medium text-foreground/80">{c.category}</span>
              </span>
              <span className="tabular text-muted-foreground ml-2 flex-shrink-0">{fmtBRL(c.total)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Categories ── */
function CategoriesView({ categories, total }: {
  categories: ReturnType<typeof aggregateByCategory>; total: number;
}) {
  const max = categories[0]?.total || 1;
  return (
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
              {months.map((m) => {
                const leader = Object.entries(m.byCategory).sort((a, b) => b[1] - a[1])[0];
                return (
                  <tr key={m.month} className="hover:bg-primary/[0.02] transition-colors duration-150">
                    <td className="px-6 py-4 font-semibold text-foreground">{m.label}</td>
                    <td className="px-6 py-4 text-right tabular text-muted-foreground">{m.count}</td>
                    <td className="px-6 py-4 text-right tabular font-semibold">{fmtBRL(m.total)}</td>
                    <td className="px-6 py-4 text-right tabular text-muted-foreground">{fmtBRL(m.total / m.count)}</td>
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
                {t.date.split("-").reverse().join("/")} · <span className="pill-accent pill text-[9px] px-1.5 py-0.5">{t.category}</span>
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
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="glass-card overflow-hidden">
      {/* Toolbar */}
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
                <td className="px-6 py-3.5 tabular text-muted-foreground text-xs font-medium">{t.date.split("-").reverse().join("/")}</td>
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
