import type { RawTransaction } from "./pdfExtract";

export const fmtBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const fmtMonth = (iso: string) => {
  if (iso === "Outros") return "Outros";
  const d = new Date(iso + "-10T00:00:00");
  return d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
};

export function getTransactionDate(t: RawTransaction): Date {
  if (t.date.includes("-")) {
    return new Date(t.date + "T00:00:00");
  }
  // Format is DD/MM
  const [dStr, mStr] = t.date.split("/");
  const d = parseInt(dStr, 10);
  const m = parseInt(mStr, 10);
  
  let y = new Date().getFullYear();
  if (t.invoiceDueDate) {
    const [invYStr, invMStr] = t.invoiceDueDate.split("-");
    const invY = parseInt(invYStr, 10);
    const invM = parseInt(invMStr, 10);
    y = invY;
    if (m > invM) {
      y = invY - 1; // Previous year
    }
  }
  return new Date(y, m - 1, d);
}

export function getSortValue(t: RawTransaction): number {
  if (t.date.includes("-")) {
    const [y, m, d] = t.date.split("-").map(Number);
    return y * 10000 + m * 100 + d;
  }
  if (t.date.includes("/")) {
    const [dStr, mStr] = t.date.split("/");
    const d = parseInt(dStr, 10);
    const m = parseInt(mStr, 10);
    let yearOffset = 0;
    if (t.invoiceDueDate) {
      const invoiceMonth = parseInt(t.invoiceDueDate.split("-")[1], 10);
      if (m > invoiceMonth) {
        yearOffset = -1; // Previous year
      }
    }
    return (yearOffset * 1200) + (m * 100) + d;
  }
  return 0;
}

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
    // Validate invoiceDueDate: must be YYYY-MM format with month 01-12
    const rawM = t.invoiceDueDate ? t.invoiceDueDate.slice(0, 7) : null;
    const isValidInvoice = rawM ? /^\d{4}-(0[1-9]|1[0-2])$/.test(rawM) : false;
    const m = isValidInvoice ? rawM! : "Outros";
    if (!map.has(m)) {
      const yearMonth = m === "Outros" ? new Date().toISOString().slice(0, 7) : m;
      const d = new Date(yearMonth + "-10T00:00:00");
      map.set(m, {
        month: m,
        label: m === "Outros" ? "Outros" : d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
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
    const baseDate = getTransactionDate(t);
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
    const d = getTransactionDate(t).getDay();
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

  // Duplicates (Same date, same amount, exact same description)
  const seen = new Map<string, RawTransaction[]>();
  for (const t of positives) {
    const k = `${t.date}|${t.description.toLowerCase().trim()}|${t.amount.toFixed(2)}`;
    seen.set(k, [...(seen.get(k) || []), t]);
  }
  const dups = Array.from(seen.values()).filter((arr) => arr.length > 1);
  if (dups.length) {
    const details = dups
      .map(
        (arr) =>
          `• “${arr[0].description}” (${fmtBRL(arr[0].amount)}) ocorrendo ${arr.length} vezes nas datas: ${arr
            .map((t) => t.date.includes("-") ? t.date.split("-").reverse().join("/") : t.date)
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
