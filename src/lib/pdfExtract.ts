import * as pdfjsLib from "pdfjs-dist";
// @ts-ignore
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export interface RawTransaction {
  id: string;
  date: string; // ISO yyyy-mm-dd
  description: string;
  amount: number; // BRL
  installment?: { current: number; total: number };
  category: string;
  source: string;
}

const CATEGORIES: { name: string; keywords: RegExp }[] = [
  { name: "Alimentação", keywords: /ifood|uber\s?eats|rappi|restaurant|padaria|lanchonete|burger|pizzar|cafe|café|mc\s?donald|bk|subway|outback|food/i },
  { name: "Mercado", keywords: /mercado|supermerc|carrefour|extra|pao\s?de\s?acucar|assai|atacad|hortifr|sams\s?club|big/i },
  { name: "Transporte", keywords: /uber|99\s?app|99pop|cabify|taxi|metro|estacion|posto|shell|ipiranga|petrobr|combust|gasolina/i },
  { name: "Assinaturas", keywords: /netflix|spotify|amazon\s?prime|disney|hbo|youtube|apple\.com|icloud|google|microsoft|adobe|chatgpt|openai|claude|anthropic/i },
  { name: "Compras Online", keywords: /amazon|mercado\s?livre|magalu|magazine|shopee|aliexpress|americanas|submarino|shein/i },
  { name: "Saúde", keywords: /farma|drogaria|drogasil|pacheco|raia|hospital|clinica|laborat|dentist|psico/i },
  { name: "Vestuário", keywords: /zara|renner|cea|c&a|riachuelo|nike|adidas|centauro|loja|fashion|hering/i },
  { name: "Lazer", keywords: /cinema|ingresso|show|teatro|park|bar\s|pub|cervej|steam|playstation|xbox|nintendo/i },
  { name: "Viagem", keywords: /hotel|airbnb|booking|decolar|latam|gol|azul|smiles|cvc|hertz|localiza/i },
  { name: "Educação", keywords: /udemy|coursera|alura|hotmart|curso|escola|faculdade|colegio/i },
  { name: "Serviços", keywords: /tim|vivo|claro|oi\s|net|sky|enel|cemig|sabesp|copasa|cpfl|seguro|condominio|aluguel/i },
  { name: "Tarifas", keywords: /anuidade|tarifa|iof|juros|encargo|multa|seguro\s?cart/i },
];

export function categorize(desc: string): string {
  for (const c of CATEGORIES) if (c.keywords.test(desc)) return c.name;
  return "Outros";
}

const MONTHS: Record<string, string> = {
  jan: "01", fev: "02", mar: "03", abr: "04", mai: "05", jun: "06",
  jul: "07", ago: "08", set: "09", out: "10", nov: "11", dez: "12",
};

function parseBRLNumber(s: string): number {
  const neg = /-$/.test(s) || /^-/.test(s) || /CR$/i.test(s);
  const cleaned = s.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(?:[,.]|$))/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  if (isNaN(n)) return NaN;
  return neg ? -Math.abs(n) : Math.abs(n);
}

function parseDate(token: string, fallbackYear: number): string | null {
  // 12/03, 12/03/2024, 12 MAR, 12 mar 24
  let m = token.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/);
  if (m) {
    const d = m[1].padStart(2, "0");
    const mo = m[2].padStart(2, "0");
    let y = m[3] ? parseInt(m[3]) : fallbackYear;
    if (y < 100) y += 2000;
    return `${y}-${mo}-${d}`;
  }
  m = token.match(/^(\d{1,2})\s+([a-z]{3})(?:\s+(\d{2,4}))?$/i);
  if (m) {
    const d = m[1].padStart(2, "0");
    const mo = MONTHS[m[2].toLowerCase()];
    if (!mo) return null;
    let y = m[3] ? parseInt(m[3]) : fallbackYear;
    if (y < 100) y += 2000;
    return `${y}-${mo}-${d}`;
  }
  return null;
}

export async function extractTransactions(file: File): Promise<RawTransaction[]> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = content.items as any[];
    // Group by y position to reconstruct lines
    const lines: Record<string, { x: number; str: string }[]> = {};
    for (const it of items) {
      const y = Math.round(it.transform[5]);
      const x = it.transform[4];
      lines[y] = lines[y] || [];
      lines[y].push({ x, str: it.str });
    }
    const sorted = Object.keys(lines).map(Number).sort((a, b) => b - a);
    for (const y of sorted) {
      // Sort items on the same line horizontally by X coordinate to guarantee correct left-to-right reading order
      const lineStr = lines[y]
        .sort((a, b) => a.x - b.x)
        .map((it) => it.str)
        .join(" ");
      fullText += lineStr + "\n";
    }
  }

  const year = new Date().getFullYear();
  const transactions: RawTransaction[] = [];
  // Use global matching (/gi) and increased digits capacity to support merged lines and extra columns (e.g. currency conversion columns)
  const lineRe = /(\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.]\d{2,4})?|\d{1,2}\s+[a-z]{3}(?:\s+\d{2,4})?)\s+(.+?)\s+(-?\s?(?:R\$\s?)?\d{1,9}(?:\.\d{3})*,\d{2}(?:\s?CR)?)\b/gi;
  const instRe = /(\d{1,2})\s?\/\s?(\d{1,2})/;

  for (const rawLine of fullText.split("\n")) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;
    
    // Reset regex match index for each line
    lineRe.lastIndex = 0;
    let match;
    while ((match = lineRe.exec(line)) !== null) {
      const date = parseDate(match[1].trim().replace(/\s+/g, " "), year);
      if (!date) continue;
      const amount = parseBRLNumber(match[3]);
      if (isNaN(amount) || amount === 0) continue;
      const description = match[2].trim().replace(/\s{2,}/g, " ");
      if (description.length < 2) continue;
      if (/saldo|total|pagamento\s?efetuado|fatura\s?anterior/i.test(description)) continue;

      let installment;
      const instMatch = description.match(instRe);
      if (instMatch) {
        const c = parseInt(instMatch[1]);
        const t = parseInt(instMatch[2]);
        if (t > 1 && t <= 48 && c <= t) installment = { current: c, total: t };
      }

      transactions.push({
        id: crypto.randomUUID(),
        date,
        description,
        amount,
        installment,
        category: categorize(description),
        source: file.name,
      });
    }
  }

  return transactions;
}
