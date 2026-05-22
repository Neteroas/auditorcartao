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
  LineChart, Line, CartesianGrid, PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  TrendingUp, TrendingDown, AlertTriangle, Sparkles,
  CheckCircle2, Calendar, Trash2,
} from "lucide-react";

interface Props {
  txs: RawTransaction[];
  onClear: () => void;
}

const CHART_COLORS = [
  "oklch(0.32 0.06 30)",
  "oklch(0.62 0.13 65)",
  "oklch(0.48 0.09 200)",
  "oklch(0.55 0.12 155)",
  "oklch(0.52 0.16 350)",
  "oklch(0.45 0.1 290)",
  "oklch(0.6 0.14 25)",
  "oklch(0.5 0.08 100)",
];

type Tab = "panorama" | "categorias" | "mensal" | "ranking" | "parcelas" | "insights" | "ledger";

export function Dashboard({ txs, onClear }: Props) {
  const [tab, setTab] = useState<Tab>("panorama");

  const positives = useMemo(() => txs.filter((t) => t.amount > 0), [txs]);
  const months = useMemo(() => aggregateByMonth(txs), [txs]);
  const categories = useMemo(() => aggregateByCategory(txs), [txs]);
  const future = useMemo(() => projectFutureInstallments(txs), [txs]);
  const insights = useMemo(() => generateInsights(txs), [txs]);

  const total = positives.reduce((s, t) => s + t.amount, 0);
  const avg = positives.length ? total / positives.length : 0;
  const biggest = [...positives].sort((a, b) => b.amount - a.amount).slice(0, 10);
  const smallest = [...positives].sort((a, b) => a.amount - b.amount).slice(0, 10);
  const futureTotal = future.reduce((s, f) => s + f.total, 0);

  const monthDelta = (() => {
    if (months.length < 2) return null;
    const a = months[months.length - 2].total;
    const b = months[months.length - 1].total;
    return ((b - a) / a) * 100;
  })();

  const tabs: { id: Tab; label: string; n: string }[] = [
    { id: "panorama", label: "Panorama", n: "I" },
    { id: "categorias", label: "Categorias", n: "II" },
    { id: "mensal", label: "Mensal", n: "III" },
    { id: "ranking", label: "Ranking", n: "IV" },
    { id: "parcelas", label: "Parcelas Futuras", n: "V" },
    { id: "insights", label: "Insights", n: "VI" },
    { id: "ledger", label: "Razão", n: "VII" },
  ];

  return (
    <div>
      {/* Header bar */}
      <div className="rule pt-6 mt-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] tracking-[0.25em] text-muted-foreground uppercase">Parecer de Auditoria</p>
          <h2 className="font-display text-3xl md:text-4xl mt-1">Relatório consolidado</h2>
        </div>
        <button
          onClick={onClear}
          className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground hover:text-destructive flex items-center gap-2"
        >
          <Trash2 className="size-3" /> Limpar análise
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 mt-6 border hairline border-rule bg-card">
        <Kpi label="Total auditado" value={fmtBRL(total)} sub={`${positives.length} lançamentos`} />
        <Kpi label="Ticket médio" value={fmtBRL(avg)} sub="por transação" />
        <Kpi
          label="Variação mensal"
          value={monthDelta == null ? "—" : `${monthDelta > 0 ? "+" : ""}${monthDelta.toFixed(1)}%`}
          sub={monthDelta == null ? "necessita 2+ meses" : monthDelta > 0 ? "vs. mês anterior ↑" : "vs. mês anterior ↓"}
          accent={monthDelta != null && monthDelta < 0}
        />
        <Kpi label="Compromisso futuro" value={fmtBRL(futureTotal)} sub={`${future.length} meses projetados`} />
      </div>

      {/* Tabs */}
      <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 border-b hairline border-rule pb-3">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`group flex items-baseline gap-2 font-mono text-[11px] tracking-widest uppercase transition-colors ${
              tab === t.id ? "text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="text-accent">{t.n}.</span>
            <span className={tab === t.id ? "underline underline-offset-4 decoration-accent" : ""}>{t.label}</span>
          </button>
        ))}
      </div>

      <div className="mt-8">
        {tab === "panorama" && <Panorama months={months} categories={categories} />}
        {tab === "categorias" && <CategoriesView categories={categories} total={total} />}
        {tab === "mensal" && <MonthlyView months={months} />}
        {tab === "ranking" && <RankingView biggest={biggest} smallest={smallest} />}
        {tab === "parcelas" && <FutureView future={future} />}
        {tab === "insights" && <InsightsView insights={insights} />}
        {tab === "ledger" && <LedgerView txs={txs} />}
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className="p-5 border-r last:border-r-0 hairline border-rule">
      <p className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">{label}</p>
      <p className={`font-display text-2xl md:text-3xl mt-2 tabular ${accent ? "text-positive" : ""}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}

function Panorama({ months, categories }: { months: ReturnType<typeof aggregateByMonth>; categories: ReturnType<typeof aggregateByCategory> }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 border hairline border-rule bg-card p-6">
        <SectionTitle eyebrow="Fig. 01" title="Evolução mensal" />
        <div className="h-72 mt-4">
          <ResponsiveContainer>
            <LineChart data={months}>
              <CartesianGrid stroke="var(--color-rule)" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="label" stroke="var(--color-muted-foreground)" tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }} />
              <YAxis stroke="var(--color-muted-foreground)" tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<ChartTip />} />
              <Line type="monotone" dataKey="total" stroke="var(--color-primary)" strokeWidth={2} dot={{ fill: "var(--color-accent)", r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="border hairline border-rule bg-card p-6">
        <SectionTitle eyebrow="Fig. 02" title="Composição" />
        <div className="h-72 mt-4">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={categories.slice(0, 6)} dataKey="total" nameKey="category" innerRadius={50} outerRadius={90} paddingAngle={2}>
                {categories.slice(0, 6).map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip content={<ChartTip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 space-y-1">
          {categories.slice(0, 6).map((c, i) => (
            <div key={c.category} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2">
                <span className="size-2" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                {c.category}
              </span>
              <span className="tabular text-muted-foreground">{fmtBRL(c.total)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CategoriesView({ categories, total }: { categories: ReturnType<typeof aggregateByCategory>; total: number }) {
  const max = categories[0]?.total || 1;
  return (
    <div className="border hairline border-rule bg-card">
      <SectionTitle eyebrow="II" title="Categorização integral" className="p-6 pb-2" />
      <div className="px-6 pb-6">
        <div className="grid grid-cols-12 gap-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground border-b hairline border-rule pb-2">
          <div className="col-span-4">Categoria</div>
          <div className="col-span-5">Distribuição</div>
          <div className="col-span-1 text-right">Itens</div>
          <div className="col-span-2 text-right">Total</div>
        </div>
        {categories.map((c, i) => (
          <div key={c.category} className="grid grid-cols-12 gap-4 items-center py-3 border-b hairline border-rule last:border-b-0">
            <div className="col-span-4 flex items-baseline gap-3">
              <span className="font-mono text-[10px] text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
              <span className="font-medium">{c.category}</span>
            </div>
            <div className="col-span-5">
              <div className="h-2 bg-muted relative overflow-hidden">
                <div className="absolute inset-y-0 left-0" style={{ width: `${(c.total / max) * 100}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
              </div>
              <p className="font-mono text-[10px] text-muted-foreground mt-1">{((c.total / total) * 100).toFixed(1)}% da fatura</p>
            </div>
            <div className="col-span-1 text-right tabular text-sm">{c.count}</div>
            <div className="col-span-2 text-right tabular font-medium">{fmtBRL(c.total)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthlyView({ months }: { months: ReturnType<typeof aggregateByMonth> }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="border hairline border-rule bg-card p-6">
        <SectionTitle eyebrow="III·A" title="Volume por mês" />
        <div className="h-80 mt-4">
          <ResponsiveContainer>
            <BarChart data={months}>
              <CartesianGrid stroke="var(--color-rule)" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="label" stroke="var(--color-muted-foreground)" tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }} />
              <YAxis stroke="var(--color-muted-foreground)" tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="total" fill="var(--color-primary)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="border hairline border-rule bg-card p-6">
        <SectionTitle eyebrow="III·B" title="Comparativo · transações" />
        <div className="h-80 mt-4">
          <ResponsiveContainer>
            <BarChart data={months}>
              <CartesianGrid stroke="var(--color-rule)" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="label" stroke="var(--color-muted-foreground)" tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }} />
              <YAxis stroke="var(--color-muted-foreground)" tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="count" fill="var(--color-accent)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="lg:col-span-2 border hairline border-rule bg-card overflow-x-auto">
        <SectionTitle eyebrow="III·C" title="Tabela analítica" className="p-6 pb-2" />
        <table className="w-full text-sm">
          <thead>
            <tr className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <th className="text-left px-6 py-2 border-b hairline border-rule">Mês</th>
              <th className="text-right px-6 py-2 border-b hairline border-rule">Lançamentos</th>
              <th className="text-right px-6 py-2 border-b hairline border-rule">Total</th>
              <th className="text-right px-6 py-2 border-b hairline border-rule">Ticket médio</th>
              <th className="text-left px-6 py-2 border-b hairline border-rule">Categoria líder</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => {
              const leader = Object.entries(m.byCategory).sort((a, b) => b[1] - a[1])[0];
              return (
                <tr key={m.month} className="border-b hairline border-rule last:border-b-0">
                  <td className="px-6 py-3 font-medium">{m.label}</td>
                  <td className="px-6 py-3 text-right tabular">{m.count}</td>
                  <td className="px-6 py-3 text-right tabular">{fmtBRL(m.total)}</td>
                  <td className="px-6 py-3 text-right tabular">{fmtBRL(m.total / m.count)}</td>
                  <td className="px-6 py-3 text-muted-foreground">{leader?.[0]} · <span className="tabular">{fmtBRL(leader?.[1] || 0)}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RankingView({ biggest, smallest }: { biggest: RawTransaction[]; smallest: RawTransaction[] }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <RankCard title="Maiores despesas" icon={<TrendingUp className="size-4" />} items={biggest} />
      <RankCard title="Menores despesas" icon={<TrendingDown className="size-4" />} items={smallest} muted />
    </div>
  );
}

function RankCard({ title, icon, items, muted }: { title: string; icon: React.ReactNode; items: RawTransaction[]; muted?: boolean }) {
  return (
    <div className="border hairline border-rule bg-card">
      <div className="flex items-center gap-2 p-6 pb-3">
        {icon}
        <SectionTitle eyebrow={muted ? "IV·B" : "IV·A"} title={title} />
      </div>
      <div>
        {items.map((t, i) => (
          <div key={t.id} className="grid grid-cols-12 gap-3 px-6 py-3 border-t hairline border-rule items-baseline">
            <span className="col-span-1 font-mono text-[10px] text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
            <div className="col-span-7">
              <p className="text-sm font-medium truncate">{t.description}</p>
              <p className="font-mono text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wider">
                {t.date} · {t.category}
              </p>
            </div>
            <span className="col-span-4 text-right tabular font-medium">{fmtBRL(t.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FutureView({ future }: { future: ReturnType<typeof projectFutureInstallments> }) {
  if (!future.length) {
    return (
      <div className="border hairline border-rule bg-card p-12 text-center">
        <Calendar className="size-8 mx-auto text-muted-foreground" />
        <p className="font-display text-xl mt-3">Nenhuma parcela futura detectada</p>
        <p className="text-sm text-muted-foreground mt-1">As faturas analisadas não contêm compras parceladas em aberto.</p>
      </div>
    );
  }
  const max = Math.max(...future.map((f) => f.total));
  return (
    <div className="space-y-4">
      <div className="border hairline border-rule bg-card p-6">
        <SectionTitle eyebrow="V" title="Projeção de parcelas — próximos meses" />
        <div className="h-72 mt-4">
          <ResponsiveContainer>
            <BarChart data={future}>
              <CartesianGrid stroke="var(--color-rule)" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="label" stroke="var(--color-muted-foreground)" tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }} />
              <YAxis stroke="var(--color-muted-foreground)" tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }} tickFormatter={(v) => `R$${(v / 1000).toFixed(1)}k`} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="total" fill="var(--color-accent)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      {future.map((f) => (
        <div key={f.month} className="border hairline border-rule bg-card p-5">
          <div className="flex items-baseline justify-between border-b hairline border-rule pb-3">
            <p className="font-display text-lg capitalize">{f.label}</p>
            <p className="tabular font-medium">{fmtBRL(f.total)}</p>
          </div>
          <div className="h-1 bg-muted mt-3 mb-4">
            <div className="h-full bg-primary" style={{ width: `${(f.total / max) * 100}%` }} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
            {f.items.map((it, i) => (
              <div key={i} className="flex justify-between text-xs py-1 border-b border-dashed border-rule">
                <span className="truncate">{it.description} <span className="font-mono text-muted-foreground">· {it.remaining}</span></span>
                <span className="tabular text-muted-foreground">{fmtBRL(it.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function InsightsView({ insights }: { insights: ReturnType<typeof generateInsights> }) {
  const icons = {
    warning: <AlertTriangle className="size-4 text-warning" />,
    info: <Sparkles className="size-4 text-accent" />,
    positive: <CheckCircle2 className="size-4 text-positive" />,
    anomaly: <AlertTriangle className="size-4 text-destructive" />,
  };
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {insights.map((ins, i) => (
        <div key={i} className="border hairline border-rule bg-card p-5">
          <div className="flex items-start gap-3">
            <div className="mt-1">{icons[ins.kind]}</div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Observação {String(i + 1).padStart(2, "0")}</p>
                <span className="font-mono text-[10px] uppercase tracking-widest text-accent">{ins.kind}</span>
              </div>
              <p className="font-display text-lg mt-1 leading-snug">{ins.title}</p>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{ins.detail}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function LedgerView({ txs }: { txs: RawTransaction[] }) {
  const [q, setQ] = useState("");
  const filtered = txs.filter((t) =>
    !q || t.description.toLowerCase().includes(q.toLowerCase()) || t.category.toLowerCase().includes(q.toLowerCase()),
  ).sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div className="border hairline border-rule bg-card">
      <div className="p-6 flex items-center justify-between border-b hairline border-rule">
        <SectionTitle eyebrow="VII" title="Livro razão" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar lançamento…"
          className="border hairline border-rule bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
      <div className="max-h-[600px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card">
            <tr className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <th className="text-left px-6 py-2 border-b hairline border-rule">Data</th>
              <th className="text-left px-6 py-2 border-b hairline border-rule">Descrição</th>
              <th className="text-left px-6 py-2 border-b hairline border-rule">Categoria</th>
              <th className="text-left px-6 py-2 border-b hairline border-rule">Parcela</th>
              <th className="text-right px-6 py-2 border-b hairline border-rule">Valor</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.id} className="border-b hairline border-rule hover:bg-muted/40">
                <td className="px-6 py-2 tabular text-muted-foreground">{t.date}</td>
                <td className="px-6 py-2">{t.description}</td>
                <td className="px-6 py-2"><span className="font-mono text-[10px] uppercase tracking-widest text-accent">{t.category}</span></td>
                <td className="px-6 py-2 tabular text-muted-foreground">{t.installment ? `${t.installment.current}/${t.installment.total}` : "—"}</td>
                <td className="px-6 py-2 text-right tabular font-medium">{fmtBRL(t.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SectionTitle({ eyebrow, title, className = "" }: { eyebrow: string; title: string; className?: string }) {
  return (
    <div className={className}>
      <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-accent">§ {eyebrow}</p>
      <h3 className="font-display text-xl mt-1">{title}</h3>
    </div>
  );
}

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border hairline border-primary px-3 py-2 shadow-sm">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="tabular text-sm">
          {p.name === "count" ? `${p.value} lançamentos` : fmtBRL(p.value)}
        </p>
      ))}
    </div>
  );
}
