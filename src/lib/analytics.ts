import type { RawTransaction } from "./pdfExtract";

export const fmtBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const fmtMonth = (iso: string) => {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
};

export interface MonthAgg {
  month: string; // yyyy-mm
  label: string;
  total: number;
  count: number;
  byCategory: Record<string, number>;
}

export function aggregateByMonth(txs: RawTransaction[]): MonthAgg[] {
  const map = new Map<string, MonthAgg>();
  for (const t of txs) {
    if (t.amount < 0) continue;
    const m = t.date.slice(0, 7);
    if (!map.has(m)) {
      const d = new Date(t.date + "T00:00:00");
      map.set(m, {
        month: m,
        label: d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
        total: 0, count: 0, byCategory: {},
      });
    }
    const agg = map.get(m)!;
    agg.total += t.amount;
    agg.count++;
    agg.byCategory[t.category] = (agg.byCategory[t.category] || 0) + t.amount;
  }
  return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
}

export function aggregateByCategory(txs: RawTransaction[]) {
  const map = new Map<string, { category: string; total: number; count: number }>();
  for (const t of txs) {
    if (t.amount < 0) continue;
    const prev = map.get(t.category) || { category: t.category, total: 0, count: 0 };
    prev.total += t.amount;
    prev.count++;
    map.set(t.category, prev);
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

export interface FutureInstallment {
  month: string;
  label: string;
  total: number;
  items: { description: string; amount: number; remaining: string }[];
}

export function projectFutureInstallments(txs: RawTransaction[]): FutureInstallment[] {
  const map = new Map<string, FutureInstallment>();
  for (const t of txs) {
    if (!t.installment) continue;
    const { current, total } = t.installment;
    const remaining = total - current;
    if (remaining <= 0) continue;
    const baseDate = new Date(t.date + "T00:00:00");
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(baseDate.getFullYear(), baseDate.getMonth() + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!map.has(key)) {
        map.set(key, {
          month: key,
          label: d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
          total: 0, items: [],
        });
      }
      const f = map.get(key)!;
      f.total += t.amount;
      f.items.push({
        description: t.description,
        amount: t.amount,
        remaining: `${current + i}/${total}`,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
}

export interface Insight {
  kind: "warning" | "info" | "positive" | "anomaly";
  title: string;
  detail: string;
}

export function generateInsights(txs: RawTransaction[]): Insight[] {
  const insights: Insight[] = [];
  if (!txs.length) return insights;

  const positives = txs.filter((t) => t.amount > 0);
  const total = positives.reduce((s, t) => s + t.amount, 0);
  const avg = total / positives.length;

  // Subscriptions
  const subs = positives.filter((t) => t.category === "Assinaturas");
  if (subs.length) {
    const s = subs.reduce((a, b) => a + b.amount, 0);
    insights.push({
      kind: "info",
      title: `${subs.length} assinaturas detectadas`,
      detail: `Você compromete ${fmtBRL(s)} (${((s / total) * 100).toFixed(1)}% da fatura) em serviços recorrentes.`,
    });
  }

  // Weekend spend
  const weekend = positives.filter((t) => {
    const d = new Date(t.date + "T00:00:00").getDay();
    return d === 0 || d === 6;
  });
  if (weekend.length > 3) {
    const ws = weekend.reduce((a, b) => a + b.amount, 0);
    const pct = (ws / total) * 100;
    if (pct > 35) {
      insights.push({
        kind: "warning",
        title: "Gasto concentrado em fins de semana",
        detail: `${pct.toFixed(0)}% dos seus gastos acontecem aos sábados e domingos.`,
      });
    }
  }

  // Anomalies (> 3x average)
  const outliers = positives.filter((t) => t.amount > avg * 3);
  if (outliers.length) {
    const top = outliers.sort((a, b) => b.amount - a.amount)[0];
    insights.push({
      kind: "anomaly",
      title: "Despesa atípica identificada",
      detail: `“${top.description}” de ${fmtBRL(top.amount)} é ${(top.amount / avg).toFixed(1)}× a sua média de ${fmtBRL(avg)}.`,
    });
  }

  // Duplicates
  const seen = new Map<string, RawTransaction[]>();
  for (const t of positives) {
    const k = `${t.description.toLowerCase().slice(0, 20)}|${t.amount.toFixed(2)}`;
    seen.set(k, [...(seen.get(k) || []), t]);
  }
  const dups = Array.from(seen.values()).filter((arr) => arr.length > 1);
  if (dups.length) {
    const details = dups
      .map(
        (arr) =>
          `• “${arr[0].description}” (${fmtBRL(arr[0].amount)}) ocorrendo ${arr.length} vezes nas datas: ${arr
            .map((t) => t.date.split("-").reverse().join("/"))
            .join(", ")}`
      )
      .join("\n");
    insights.push({
      kind: "warning",
      title: `${dups.length} possíveis cobranças duplicadas`,
      detail: `Identificamos os seguintes lançamentos repetidos com o mesmo valor e descrição:\n${details}`,
    });
  }

  // Installments load
  const installments = positives.filter((t) => t.installment);
  if (installments.length) {
    const totalRemaining = installments.reduce(
      (s, t) => s + t.amount * (t.installment!.total - t.installment!.current),
      0,
    );
    insights.push({
      kind: "info",
      title: `${installments.length} compras parceladas em aberto`,
      detail: `Compromisso futuro estimado de ${fmtBRL(totalRemaining)} nos próximos meses.`,
    });
  }

  // Top category
  const cats = aggregateByCategory(positives);
  if (cats[0]) {
    insights.push({
      kind: "info",
      title: `“${cats[0].category}” lidera seus gastos`,
      detail: `${fmtBRL(cats[0].total)} em ${cats[0].count} lançamentos — ${((cats[0].total / total) * 100).toFixed(1)}% da fatura analisada.`,
    });
  }

  // Healthy signal
  if (cats.find((c) => c.category === "Educação")) {
    insights.push({
      kind: "positive",
      title: "Investimento em educação",
      detail: `Gastos com educação aparecem na sua fatura — bom sinal de capital humano.`,
    });
  }

  return insights;
}
