import * as pdfjsLib from "pdfjs-dist";
// @ts-ignore
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export interface RawTransaction {
  id: string;
  date: string; // "DD/MM" format
  description: string;
  amount: number; // BRL
  installment?: { current: number; total: number };
  category: string;
  source: string;
  invoiceDueDate?: string; // ISO yyyy-mm-dd (due date of the invoice)
}

export interface InvoiceSummary {
  previousBalance: number;
  paymentsCredits: number;
  localPurchases: number;
  intlPurchases: number;
  feesAndCharges: number;
  totalAmount: number;
}

export interface ExtractedData {
  transactions: RawTransaction[];
  summary?: InvoiceSummary;
}

const CATEGORIES: { name: string; keywords: RegExp }[] = [
  // iFood / entrega — vem ANTES de Alimentação para capturar IFD* e congeners
  { name: "Ifood / Restaurantes", keywords: /\bifd\s*\*|ifood|uber\s?eats|rappi|deliverydireto|delivery/i },
  // Alimentação: restaurantes, lanchonetes, padarias — mas NÃO delivery
  { name: "Alimentação", keywords: /restaurant|padaria|lanchonete|burger|pizzar|cafe|café|mc\s?donald|\bbk\b|subway|outback/i },
  // Compras Online vem ANTES de Mercado para capturar MERCADOLIVRE, MP*, etc.
  { name: "Compras Online", keywords: /amazon|mercado\s?livre|mercadoliv|ec\s*\*\s*mercadoli|mp\s*\*\s*mercadoliv|\bmp\s*\*|shopee|magalu|magazine|aliexpress|americanas|submarino|shein/i },
  // Mercado: apenas supermercados reais (sem "mercado" genérico para evitar falsos positivos)
  { name: "Mercado", keywords: /supermerc|carrefour|\bextra\b|pao\s?de\s?acucar|assai|atacad|hortifr|sams\s?club|prezunic|mundial|gbarbosa|bistek|hipermercado/i },
  { name: "Transporte", keywords: /\buber\b(?!\s?eats)|99\s?app|99pop|cabify|taxi|metro|estacion|posto|shell|ipiranga|petrobr|combust|gasolina/i },
  { name: "Assinaturas", keywords: /netflix|spotify|amazon\s?prime|disney|hbo|youtube|apple\.com|icloud|google|microsoft|adobe|chatgpt|openai|claude|anthropic/i },
  { name: "Saúde", keywords: /farma|drogaria|drogasil|pacheco|raia|hospital|clinica|laborat|dentist|psico/i },
  { name: "Vestuário", keywords: /zara|renner|cea|c&a|riachuelo|nike|adidas|centauro|loja|fashion|hering/i },
  { name: "Lazer", keywords: /cinema|ingresso|show|teatro|park|\bbar\s|pub|cervej|steam|playstation|xbox|nintendo/i },
  { name: "Viagem", keywords: /hotel|airbnb|booking|decolar|latam|gol|azul|smiles|cvc|hertz|localiza/i },
  { name: "Educação", keywords: /udemy|coursera|alura|hotmart|curso|escola|faculdade|colegio/i },
  { name: "Serviços", keywords: /tim|vivo|claro|\boi\s|\bnet\b|sky|enel|cemig|sabesp|copasa|cpfl|seguro|condominio|aluguel/i },
  { name: "Tarifas", keywords: /anuidade|tarifa|iof|juros|encargo|multa|seguro\s?cart/i },
  { name: "Pagamentos/Créditos", keywords: /pagamento|cr[eé]dito|estorno|reembolso|cashback|devolu/i },
];


export function categorize(desc: string, amount?: number): string {
  // Negative amounts are always payments/credits
  if (amount !== undefined && amount < 0) return "Pagamentos/Créditos";
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

function parseDate(token: string): string | null {
  // 12/03, 12/03/2024, 12 MAR, 12 mar 24
  let m = token.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/);
  if (m) {
    const d = m[1].padStart(2, "0");
    const mo = m[2].padStart(2, "0");
    return `${d}/${mo}`;
  }
  m = token.match(/^(\d{1,2})\s+([a-z]{3})(?:\s+(\d{2,4}))?$/i);
  if (m) {
    const d = m[1].padStart(2, "0");
    const mo = MONTHS[m[2].toLowerCase()];
    if (!mo) return null;
    return `${d}/${mo}`;
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

  // Helper: validate month is in range, returns "YYYY-MM-DD" or null
  const makeDate = (dayStr: string | null, monthStr: string, yearInt: number): string | null => {
    const mo = parseInt(monthStr, 10);
    const y = yearInt < 100 ? yearInt + 2000 : yearInt;
    if (mo < 1 || mo > 12 || y < 2000 || y > 2100) return null;
    const d = dayStr ? parseInt(dayStr, 10) : 1;
    if (d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };

  // 1. Vencimento DD/MM/YYYY — strict: day must be ≤31, month must be ≤12, year ≥2000
  const r1 = /(?:vencimento|venc\.?|vto|pagamento\s+em|pagar\s+at[eé]|vence\s+em)[:\s-]*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/i;
  const m1 = clean.match(r1);
  if (m1) {
    const res = makeDate(m1[1], m1[2], parseInt(m1[3]));
    if (res) return res;
  }

  // 2. Vencimento MM/YYYY (no day — common in bank statements)
  const r2 = /(?:vencimento|venc\.?|vto|vence\s+em)[:\s-]*(\d{1,2})[\/\-](20\d{2})/i;
  const m2 = clean.match(r2);
  if (m2) {
    const res = makeDate(null, m2[1], parseInt(m2[2]));
    if (res) return res;
  }

  // 3. Vencimento DD de [Mês] de YYYY
  const r3 = /(?:vencimento|venc\.?|pagar\s+at[eé]|vence\s+em)[:\s-]*(\d{1,2})\s+de\s+([a-záéíóúçã]{3,10})\s+de\s+(\d{4})/i;
  const m3 = clean.match(r3);
  if (m3) {
    const monthWord = m3[2].toLowerCase().substring(0, 3);
    const mo = MONTHS[monthWord];
    if (mo) {
      const res = makeDate(m3[1], mo, parseInt(m3[3]));
      if (res) return res;
    }
  }

  // 4. Wider scan: 120 chars after the word "vencimento"
  const idx = clean.toLowerCase().indexOf("vencimento");
  if (idx !== -1) {
    const sub = clean.substring(idx, idx + 120);
    // Try MM/YYYY first (month+year without day)
    const mm = sub.match(/(\d{1,2})[\/\-](20\d{2})/);
    if (mm) {
      const res = makeDate(null, mm[1], parseInt(mm[2]));
      if (res) return res;
    }
    // Try DD/MM/YYYY
    const dd = sub.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (dd) {
      const res = makeDate(dd[1], dd[2], parseInt(dd[3]));
      if (res) return res;
    }
  }

  return null;
}

function extractInvoiceSummary(text: string): InvoiceSummary | undefined {
  const clean = text.replace(/\s+/g, " ");

  const findBRL = (patterns: RegExp[]): number => {
    for (const p of patterns) {
      const m = clean.match(p);
      if (m) {
        const raw = m[1] || m[0];
        const val = parseBRLNumber(raw);
        if (!isNaN(val)) return val;
      }
    }
    return 0;
  };

  const previousBalance = findBRL([
    /saldo\s+(?:de\s+)?(?:fatura\s+)?anterior[^R\d]{0,20}((?:-\s?)?R?\$?\s?[\d.]+,\d{2})/i,
    /saldo\s+anterior[:\s]+((?:-?\s?)(?:R\$\s?)?[\d.]+,\d{2})/i,
  ]);

  const paymentsCredits = findBRL([
    /pagamentos?\s*[/\\e]?\s*cr[eé]ditos?[^R\d]{0,20}((?:-\s?)?R?\$?\s?[\d.]+,\d{2})/i,
    /cr[eé]ditos?\s+(?:e\s+)?pagamentos?[:\s]+((?:-?\s?)(?:R\$\s?)?[\d.]+,\d{2})/i,
  ]);

  const localPurchases = findBRL([
    /compras?\s+nacionais?[^R\d]{0,20}(R?\$?\s?[\d.]+,\d{2})/i,
    /compras?\s+nacion[^R\d]{0,20}(R?\$?\s?[\d.]+,\d{2})/i,
  ]);

  const intlPurchases = findBRL([
    /compras?\s+internacionais?[^R\d]{0,20}(R?\$?\s?[\d.]+,\d{2})/i,
    /compras?\s+intern[^R\d]{0,20}(R?\$?\s?[\d.]+,\d{2})/i,
  ]);

  const feesAndCharges = findBRL([
    /tarifas?,?\s*(?:encargos?\s*(?:e\s*)?)?multas?[^R\d]{0,30}(R?\$?\s?[\d.]+,\d{2})/i,
    /encargos?\s*(?:e\s*)?multas?[^R\d]{0,30}(R?\$?\s?[\d.]+,\d{2})/i,
    /juros\s*(?:e\s*)?encargos?[^R\d]{0,30}(R?\$?\s?[\d.]+,\d{2})/i,
  ]);

  const totalAmount = findBRL([
    /total(?:\s+da\s+fatura)?[:\s]+(R?\$?\s?[\d.]+,\d{2})/i,
    /(?:valor\s+)?total\s+a\s+pagar[:\s]+(R?\$?\s?[\d.]+,\d{2})/i,
  ]);

  if (!totalAmount && !localPurchases && !previousBalance) return undefined;

  return { previousBalance, paymentsCredits, localPurchases, intlPurchases, feesAndCharges, totalAmount };
}

export async function extractData(file: File): Promise<ExtractedData> {
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

  if (!invoiceDueDate) {
    const now = new Date();
    invoiceDueDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-10`;
  }

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
      const date = parseDate(match[1].trim().replace(/\s+/g, " "));
      if (!date) continue;
      const amount = parseBRLNumber(match[3]);
      if (isNaN(amount) || amount === 0) continue;
      const description = match[2].trim().replace(/\s{2,}/g, " ");
      if (description.length < 2) continue;
      // Skip lines that are clearly summary/total headers (no real transaction content)
      // Allow pagamento, crédito, saldo anterior — they are real entries with negative amounts
      if (/^(total\s+(da\s+)?fatura|saldo\s+para\s+pr[oó]xima|limite\s+(total|disponível|utilizado))$/i.test(description)) continue;

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
        category: categorize(description, amount),
        source: file.name,
        invoiceDueDate,
      });
    }
  }

  const summary = extractInvoiceSummary(page1Text);
  return { transactions, summary };
}
