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
  invoiceDueDate?: string; // ISO yyyy-mm-dd (due date of the invoice)
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

function extractDateFromFilename(filename: string): string | null {
  const clean = filename.toLowerCase();
  const mY = clean.match(/(20\d{2})[-_](\d{1,2})/);
  if (mY) {
    return `${mY[1]}-${mY[2].padStart(2, "0")}-10`;
  }
  const mYRev = clean.match(/(\d{1,2})[-_](20\d{2})/);
  if (mYRev) {
    return `${mYRev[2]}-${mYRev[1].padStart(2, "0")}-10`;
  }
  const monthsBR: Record<string, string> = {
    jan: "01", fev: "02", mar: "03", abr: "04", mai: "05", jun: "06",
    jul: "07", ago: "08", set: "09", out: "10", nov: "11", dez: "12",
    janeiro: "01", fevereiro: "02", marco: "03", abril: "04", maio: "05", junho: "06",
    julho: "07", agosto: "08", setembro: "09", outubro: "10", novembro: "11", dezembro: "12"
  };
  for (const [name, num] of Object.entries(monthsBR)) {
    if (clean.includes(name)) {
      const yearMatch = clean.match(/(20\d{2})/);
      const y = yearMatch ? yearMatch[1] : new Date().getFullYear().toString();
      return `${y}-${num}-10`;
    }
  }
  return null;
}

function extractDueDateFromText(text: string, fallbackYear: number): string | null {
  const clean = text.replace(/\s+/g, " ");
  
  // 1. Regular expression for Vencimento/Venc followed by date
  const regex1 = /(?:vencimento|venc|pagamento\s+em|pagar\s+at[eé]|venc\s+em|vence\s+em|vto)[:\s-]*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/i;
  let match = clean.match(regex1);
  if (match) {
    const d = match[1].padStart(2, "0");
    const m = match[2].padStart(2, "0");
    let y = parseInt(match[3]);
    if (y < 100) y += 2000;
    return `${y}-${m}-${d}`;
  }

  // 2. Format: Vencimento DD de [Mês] de YYYY
  const regex2 = /(?:vencimento|venc|pagamento\s+em|pagar\s+at[eé]|vence\s+em)[:\s-]*(\d{1,2})\s+de\s+([a-z]{3,10})\s+de\s+(\d{4})/i;
  match = clean.match(regex2);
  if (match) {
    const d = match[1].padStart(2, "0");
    const monthWord = match[2].toLowerCase().substring(0, 3);
    const m = MONTHS[monthWord];
    if (m) {
      const y = parseInt(match[3]);
      return `${y}-${m}-${d}`;
    }
  }

  // 3. Just look for the word "vencimento" and look at next 80 characters for any date
  const idx = clean.toLowerCase().indexOf("vencimento");
  if (idx !== -1) {
    const sub = clean.substring(idx, idx + 80);
    const dateRegex = /(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/;
    const mDate = sub.match(dateRegex);
    if (mDate) {
      const d = mDate[1].padStart(2, "0");
      const m = mDate[2].padStart(2, "0");
      let y = mDate[3] ? parseInt(mDate[3]) : fallbackYear;
      if (y < 100) y += 2000;
      return `${y}-${m}-${d}`;
    }
  }

  // 4. Look around "vencimento" in wider context
  const vIdx = clean.toLowerCase().indexOf("vencimento");
  if (vIdx !== -1) {
    const sub = clean.substring(Math.max(0, vIdx - 40), Math.min(clean.length, vIdx + 120));
    const dateRegex = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/;
    const mDate = sub.match(dateRegex);
    if (mDate) {
      const d = mDate[1].padStart(2, "0");
      const m = mDate[2].padStart(2, "0");
      let y = parseInt(mDate[3]);
      if (y < 100) y += 2000;
      return `${y}-${m}-${d}`;
    }
  }

  return null;
}

export async function extractTransactions(file: File): Promise<RawTransaction[]> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  let fullText = "";
  let page1Text = "";
  
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
    let pageText = "";
    for (const y of sorted) {
      // Sort items on the same line horizontally by X coordinate to guarantee correct left-to-right reading order
      const lineStr = lines[y]
        .sort((a, b) => a.x - b.x)
        .map((it) => it.str)
        .join(" ");
      pageText += lineStr + "\n";
    }
    if (i === 1) {
      page1Text = pageText;
    }
    fullText += pageText;
  }

  const year = new Date().getFullYear();
  
  // Extract due date from page 1 or filename
  let invoiceDueDate = extractDueDateFromText(page1Text, year) || extractDateFromFilename(file.name) || undefined;

  const transactions: RawTransaction[] = [];
  // Use global matching (/gi) and increased digits capacity to support merged lines and extra columns
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
        invoiceDueDate,
      });
    }
  }

  return transactions;
}
