let pdfjsLibPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function getPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = (async () => {
      const pdfjsLib = await import("pdfjs-dist");
      const pdfWorker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
      return pdfjsLib;
    })();
  }

  return pdfjsLibPromise;
}

export interface RawTransaction {
  id: string;
  date: string; // "DD/MM" format
  description: string;
  amount: number; // BRL
  installment?: { current: number; total: number };
  category: string;
  source: string;
  invoiceDueDate?: string; // ISO yyyy-mm-dd (due date of the invoice)
  isManualCategory?: boolean;
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
  { name: "Ifood / Restaurantes", keywords: /\bifd\s*\*|ifood|uber\s?eats|rappi|deliverydireto|delivery|loggi.*food/i },
  // Alimentação: restaurantes, lanchonetes, padarias — mas NÃO delivery
  { name: "Alimentação", keywords: /restaurant|padaria|lanchonete|burger|pizzar|cafe|café|mc\s?donald|\bbk\b|subway|outback/i },
  // Compras Online: plataformas de e-commerce (cidades detectadas via normalizeText)
  { name: "Compras Online", keywords: /amazon|mercado\s?livre|mercadoliv|ec\s*\*\s*mercadoli|mp\s*\*\s*mercadoliv|\bmp\s*\*|shopee|magalu|magazine|aliexpress|americanas|submarino|shein/i },
  // Mercado: apenas supermercados reais (sem "mercado" genérico para evitar falsos positivos)
  { name: "Mercados / Panificadoras", keywords: /supermerc|carrefour|\bextra\b|pao\s?de\s?acucar|assai|atacad|hortifr|sams\s?club|prezunic|mundial|gbarbosa|bistek|hipermercado|mercado\s+do\s+polaco|panificadora|kipao/i },
  // Transporte: Uber, 99, táxi, combustível, etc.
  { name: "Transporte", keywords: /\buber\s*\*|\buber\b(?!\s?eats)|99\s?app|99pop|cabify|taxi|metro|estacion|posto|shell|ipiranga|petrobr|combust|gasolina|\b99\b/i },
  // Assinaturas: Google, Netflix, etc.
  { name: "Assinaturas", keywords: /netflix|spotify|amazon\s?prime|disney|hbo|youtube|apple\.com|icloud|google|microsoft|adobe|chatgpt|openai|claude|anthropic|dl\s*\*?\s*google|google\s*play/i },
  { name: "Saúde", keywords: /farma|drogaria|drogasil|pacheco|raia|hospital|clinica|laborat|dentist|psico/i },
  { name: "Telefonia (Planos/Aparelhos)", keywords: /tim|vivo|claro|oi\s+br|net\b|sky|enel|cemig|sabesp|copasa|cpfl|telecom|telefon/i },
  { name: "Vestuário", keywords: /zara|renner|cea|c&a|riachuelo|nike|adidas|centauro|loja|fashion|hering/i },
  { name: "Lazer", keywords: /cinema|ingresso|show|teatro|park|\bbar\s|pub|cervej|steam|playstation|xbox|nintendo/i },
  { name: "Viagem", keywords: /hotel|airbnb|booking|decolar|latam|gol|azul|smiles|cvc|hertz|localiza/i },
  { name: "Educação", keywords: /udemy|coursera|alura|hotmart|curso|escola|faculdade|colegio/i },
  { name: "Serviços", keywords: /tim|vivo|claro|\boi\s|\bnet\b|sky|enel|cemig|sabesp|sanepar|copasa|cpfl|seguro|condominio|aluguel|saneam|agua\s*pota|fornec.*agua/i },
  { name: "Tarifas", keywords: /anuidade|tarifa|iof|juros|encargo|multa|seguro\s?cart/i },
  { name: "Pagamentos/Créditos", keywords: /pagamento|cr[eé]dito|estorno|reembolso|cashback|devolu/i },
];


function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

const BRAZILIAN_CITIES = [
  "sao paulo", "rio de janeiro", "belo horizonte", "brasilia", "curitiba", "porto alegre",
  "salvador", "fortaleza", "recife", "manaus", "goiania", "campinas", "santos", "sorocaba",
  "guarulhos", "osasco", "diadema", "mogi cruzes", "atibaia", "ribeirao preto", "matao",
  "araraquara", "piracicaba", "presidente prudente", "aracatuba", "bauru", "jundiai", "franca",
  "botucatu", "jau", "blumenau", "itajai", "joinville", "florianopolis", "chapeco", "santa maria",
  "caxias do sul", "vicosa", "campina grande", "joao pessoa", "aracaju", "maceio", "teresina",
  "natal", "parnamirim", "petrolina", "juazeiro", "feira de santana", "ilheus", "belem",
  "santarem", "maraba", "castanhal", "ananindeua", "parauapebas", "novo repartimento", "altamira",
  "tucurui", "macapa", "boa vista", "itabuna", "jequie", "teixeira de freitas", "victoria da conquista",
  "pouso alegre", "uberaba", "divinopolis", "contagem", "betim", "sete lagoas", "ipatinga",
  "governador valadares", "montes claros", "ituiutaba", "muriae", "barbacena", "ouro preto",
  "mariana", "congonhas", "itabira", "tres coracoes", "varginha", "juiz de fora", "unaí",
  "patos de minas", "araguari", "uberlandia", "itumbiara", "catalao", "jatai", "rio verde",
  "morrinhos", "anapolis", "aparecida de goiania", "luziania", "formosa", "cristalina",
  "cidade ocidental", "planaltina", "aguas lindas de goias", "gama", "taguatinga", "ceilandia",
  "samambaia", "riacho fundo", "sobradinho", "guara", "nucleo bandeirante", "recanto das emas",
  "aguas claras", "sao sebastiao", "paranoa", "itapoa", "sao goncalo", "duque de caxias",
  "niteroi", "sao joao de meriti", "nova iguazu", "mesquita", "nilopolis", "marica",
  "sao pedro da aldeia", "araruama", "cabo frio", "buzios", "iguaba grande", "casimiro de abreu",
  "rio das flores", "silva jardim", "carmo", "conceicao de macabu", "macae", "campos dos goitacazes",
  "quissama", "carapebus", "cardoso moreira", "italva", "itaperuna", "bom jesus do itabapoana",
  "natividade", "miracema", "porciunciula", "santo antonio de padua", "sao fidelis",
  "sao jose do calcado", "barra de sao francisco", "coracaozinho", "coracao de jesus", "coracao de j",
  "indaiatuba", "cajamar", "uniao da vitoria", "sao jose", "unio da vitr",
  // Additional city patterns and abbreviations
  "sao sebastiao", "sao joao", "sao goncalo", "sao pedro", "sao paulo", "sao fidelis",
];

export function categorize(desc: string, amount?: number): string {
  // Negative amounts are always payments/credits
  if (amount !== undefined && amount < 0) return "Pagamentos/Créditos";

  // Check if it's a city (but exclude Foz do Iguaçu)
  const normalized = normalizeText(desc);
  const isFozDoIguacu = normalized.includes("FOZ") && normalized.includes("IGUAC");

  if (!isFozDoIguacu) {
    for (const city of BRAZILIAN_CITIES) {
      const normalizedCity = normalizeText(city);
      if (normalized.includes(normalizedCity)) {
        return "Compras Online";
      }
    }
    
    // Additional pattern: detect city-like patterns (e.g., "CORACAO DE J BR", "UNIO DA VITR BR")
    // These are typically city names in abbreviated form like "CORACAO DE JESUS" -> "CORACAO DE J"
    const cityPatterns = [
      /\b[A-Z]{3,}\s+(?:DE\s+)?[A-Z]{1,2}\b.*BR\b/, // City-like pattern with BR suffix
    ];
    for (const pattern of cityPatterns) {
      if (pattern.test(desc)) {
        return "Compras Online";
      }
    }
  }

  // Check standard categories
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

const DATE_TOKEN_PATTERN = String.raw`\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.]\d{2,4})?|\d{1,2}\s+[a-z]{3}(?:\s+\d{2,4})?`;
const AMOUNT_TOKEN_PATTERN = String.raw`-?\s?(?:R\$\s?)?\d{1,9}(?:\.\d{3})*,\d{2}(?:\s?CR)?`;
const TRANSACTION_LINE_RE = new RegExp(`(${DATE_TOKEN_PATTERN})\\s+(.+?)\\s+(${AMOUNT_TOKEN_PATTERN})(?=\\s|$)`, "gi");
const BLOCK_START_RE = new RegExp(`^\\s*(${DATE_TOKEN_PATTERN})(?:\\s+(${DATE_TOKEN_PATTERN}))?(?:\\s+|$)`, "i");
const AMOUNT_GLOBAL_RE = new RegExp(AMOUNT_TOKEN_PATTERN, "gi");
const INSTALLMENT_RE = /\bPARC[A-Z]*\.?\s*(\d{1,2})\s?\/\s?(\d{1,2})/i;
const TRANSACTION_BLOCK_BREAK_RE = /^(?:resumo\b|lan[\xE7c]amentos?\b|data\b|descri[\xE7c][\xE3a]o\b|valor\b|saldo\s+(?:anterior|para)\b|pagamentos?\b|cr[\xE9e]ditos?\b|compras?\s+(?:nacionais?|internacionais?)\b|tarifas?\b|encargos?\b|juros\b|total\b|limite\b|per[\xED]odo\b|refer[\xEA|e]ncia\b|fatura\s+de\b|compet[\xEA|e]ncia\b|m[\xEA|e]s\s+de\b)/i;
const IGNORED_DESCRIPTION_RE = /^(?:total\s+(?:da\s+)?fatura|saldo\s+para\s+pr[oó]xima|limite\s+(?:total|dispon[ií]vel|utilizado)|data\s+descri[çc][aã]o\s+valor|data\s+lan[çc]amento|descri[çc][aã]o\s+do\s+lan[çc]amento|pagamento\s+recebido|saldo\s+anterior|compras?\s+(?:nacionais?|internacionais?)|tarifas?\s+e\s+encargos?|total\s+a\s+pagar|fatura\s+atual|fatura\s+anterior|valor\s+da\s+fatura|encargos?\s+do\s+m[eê]s|encargos?\s+financeiros?)$/i;

function createTransactionCandidate(
  dateToken: string,
  descriptionToken: string,
  amountToken: string,
  source: string,
  invoiceDueDate?: string,
): RawTransaction | null {
  const date = parseDate(dateToken.trim().replace(/\s+/g, " "));
  if (!date) return null;

  const amount = parseBRLNumber(amountToken);
  if (isNaN(amount) || amount === 0) return null;

  let description = descriptionToken
    .trim()
    .replace(/\s{2,}/g, " ")
    .replace(/^[\-–—:;|]+\s*/, "")
    .replace(/\s+[\-–—:;|]+$/, "")
    // Strip a leading "DD/MM" or "DD/MM/YY(YY)" that some PDFs prepend when
    // the lançamento has two date columns (data compra + data lançamento).
    .replace(/^\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.]\d{2,4})?\s+/, "")
    .trim();

  if (!description || description.length < 2) return null;
  if (IGNORED_DESCRIPTION_RE.test(description)) return null;

  let installment;
  const instMatch = description.match(INSTALLMENT_RE);
  if (instMatch) {
    const c = parseInt(instMatch[1]);
    const t = parseInt(instMatch[2]);
    if (t > 1 && t <= 48 && c <= t) installment = { current: c, total: t };
  }

  return {
    id: crypto.randomUUID(),
    date,
    description,
    amount,
    installment,
    category: categorize(description, amount),
    source,
    invoiceDueDate,
  };
}

export function extractDateFromFilename(filename: string): string | null {
  const clean = filename.toLowerCase();
  const mY = clean.match(/(20\d{2})[-_](\d{1,2})/);
  if (mY) {
    return `${mY[1]}-${mY[2].padStart(2, "0")}-11`;
  }
  const mYRev = clean.match(/(\d{1,2})[-_](20\d{2})/);
  if (mYRev) {
    return `${mYRev[2]}-${mYRev[1].padStart(2, "0")}-11`;
  }
  const monthsBR: Record<string, string> = {
    // Put long month names first to prevent partial matching (e.g., "jul" matching "julho")
    janeiro: "01", fevereiro: "02", marco: "03", abril: "04", maio: "05", junho: "06",
    julho: "07", agosto: "08", setembro: "09", outubro: "10", novembro: "11", dezembro: "12",
    jan: "01", fev: "02", mar: "03", abr: "04", mai: "05", jun: "06",
    jul: "07", ago: "08", set: "09", out: "10", nov: "11", dez: "12"
  };
  for (const [name, num] of Object.entries(monthsBR)) {
    if (clean.includes(name)) {
      const yearMatch = clean.match(/(20\d{2})/);
      if (yearMatch) {
        return `${yearMatch[1]}-${num}-11`;
      }

      // Try to find a 2-digit year right after the month name or separated by a separator
      const yearRegex = new RegExp(`${name}[-_\\s]?(\\d{2})\\b`);
      const match = clean.match(yearRegex);
      if (match) {
        const yearNum = Number(match[1]);
        const fullYear = yearNum < 50 ? 2000 + yearNum : 1900 + yearNum;
        return `${fullYear}-${num}-11`;
      }

      const shortYearMatch = clean.match(/\b(\d{2})\b/);
      if (shortYearMatch) {
        const yearNum = Number(shortYearMatch[1]);
        if (yearNum >= 0 && yearNum <= 99) {
          const fullYear = yearNum < 50 ? 2000 + yearNum : 1900 + yearNum;
          return `${fullYear}-${num}-11`;
        }
      }

      return `${new Date().getFullYear()}-${num}-11`;
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
    const d = dayStr ? parseInt(dayStr, 10) : 11; // default to day 11 when PDF only shows MM/YYYY
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
  const pdfjsLib = await getPdfJs();
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  let fullText = "";
  let page1Text = "";
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = content.items as any[];
    
    // Sort items by y-coordinate descending (top-to-bottom of the page)
    const sortedItems = [...items].sort((a, b) => b.transform[5] - a.transform[5]);
    const linesList: { y: number; items: { x: number; str: string }[] }[] = [];
    
    for (const it of sortedItems) {
      const y = it.transform[5];
      const x = it.transform[4];
      const str = typeof it.str === "string" ? it.str.trim() : "";
      if (!str) continue;

      // Group text using a slightly wider Y tolerance again. The parser used to
      // work with a 3px bucket and regressed after tightening this to 2px,
      // which split date / description / amount across separate pseudo-lines.
      const Y_TOL = 3.0;
      let line: { y: number; items: { x: number; str: string }[] } | undefined;
      let closestDiff = Number.POSITIVE_INFINITY;

      for (const existingLine of linesList) {
        const diff = Math.abs(existingLine.y - y);
        if (diff <= Y_TOL && diff < closestDiff) {
          line = existingLine;
          closestDiff = diff;
        }
      }

      if (!line) {
        line = { y, items: [] };
        linesList.push(line);
      } else {
        // Keep the cluster centered so later items with slight baseline drift
        // still join the same visual row.
        line.y = (line.y * line.items.length + y) / (line.items.length + 1);
      }

      line.items.push({ x, str });
    }
    
    // Re-sort lines from top to bottom
    linesList.sort((a, b) => b.y - a.y);
    
    let pageText = "";
    for (const line of linesList) {
      // Sort items within the same line from left to right (x ascending)
      const lineStr = line.items
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
    invoiceDueDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-11`;
  }

  const transactions: RawTransaction[] = [];
  const rawLines = fullText.split("\n").map((l) => l.replace(/\s+/g, " ").trim());
  const seenKeys = new Set<string>();

  /**
   * Fuzzy-dedup helper: returns true if two descriptions are near-identical
   * (one is a prefix/suffix of the other, or they share 90%+ characters).
   * Used to prevent the same Sanepar/utility charge from being recorded twice
   * when the PDF has both a transaction line and a confirmation/summary line
   * with slightly different wording.
   */
  function isSimilarDesc(a: string, b: string): boolean {
    if (a === b) return true;
    const shorter = a.length < b.length ? a : b;
    const longer  = a.length < b.length ? b : a;
    if (longer.startsWith(shorter.slice(0, Math.min(shorter.length, 15)))) return true;
    // Overlap ratio
    const overlap = shorter.split(' ').filter(w => w.length > 2 && longer.includes(w)).length;
    const words = shorter.split(' ').filter(w => w.length > 2).length;
    return words > 0 && overlap / words >= 0.85;
  }

  const pushCandidate = (candidate: RawTransaction | null) => {
    if (!candidate) return false;
    const key = `${candidate.date}|${candidate.description}|${candidate.amount.toFixed(2)}`;
    if (seenKeys.has(key)) return false;
    // Fuzzy dedup: block near-identical transactions. We allow the date to
    // differ by a few days because some statements expose both "data compra"
    // and "data lançamento" and the parser may pick either one for the same
    // underlying charge (e.g. Sanepar shows up twice with 29/04 and 03/05).
    const parseDM = (s: string) => {
      const [d, m] = s.split("/").map((x) => parseInt(x, 10));
      return isNaN(d) || isNaN(m) ? null : { d, m };
    };
    const candDM = parseDM(candidate.date);
    const hasFuzzyDup = transactions.some((t) => {
      if (Math.abs(t.amount - candidate.amount) >= 0.01) return false;
      if (!isSimilarDesc(t.description.toLowerCase().slice(0, 40), candidate.description.toLowerCase().slice(0, 40))) return false;
      if (t.date === candidate.date) return true;
      const tDM = parseDM(t.date);
      if (!tDM || !candDM) return false;
      // Same month, within 7 days → treat as the same launch
      return tDM.m === candDM.m && Math.abs(tDM.d - candDM.d) <= 7;
    });
    if (hasFuzzyDup) return false;
    
    seenKeys.add(key);
    transactions.push(candidate);
    return true;
  };

  const tryMatchLine = (line: string) => {
    if (!line) return;
    TRANSACTION_LINE_RE.lastIndex = 0;
    let match;
    while ((match = TRANSACTION_LINE_RE.exec(line)) !== null) {
      pushCandidate(createTransactionCandidate(match[1], match[2], match[3], file.name, invoiceDueDate));
    }
  };

  // Pass 1: match within each reconstructed line
  for (const line of rawLines) tryMatchLine(line);

  // Pass 2: fallback — some PDFs split a transaction across 2-3 consecutive lines
  // (date, description e valor acabam quebrados em partes separadas). Join windows
  // and re-run; dedup via seenKeys prevents double-counting.
  for (let i = 0; i < rawLines.length - 1; i++) {
    if (!rawLines[i] || !rawLines[i + 1]) continue;
    tryMatchLine(`${rawLines[i]} ${rawLines[i + 1]}`);

    if (i < rawLines.length - 2 && rawLines[i + 2]) {
      tryMatchLine(`${rawLines[i]} ${rawLines[i + 1]} ${rawLines[i + 2]}`);
    }
  }

  // Pass 3: parse transaction blocks that start with a date and span arbitrary
  // wrapped lines. This covers newer statement layouts where launch date,
  // description and BRL amount are split across 4+ lines or include a second
  // date / foreign-currency amount before the final BRL charge.
  const blocks: string[] = [];
  let currentBlock = "";

  const flushBlock = () => {
    if (currentBlock.trim()) blocks.push(currentBlock.trim());
    currentBlock = "";
  };

  for (const line of rawLines) {
    if (!line) continue;

    if (TRANSACTION_BLOCK_BREAK_RE.test(line)) {
      flushBlock();
      continue;
    }

    const startsWithDate = BLOCK_START_RE.test(line);
    if (startsWithDate) {
      flushBlock();
      // If the line already has a date and a valid BRL amount, it is complete.
      // We push it as a block directly and don't let subsequent lines append to it.
      AMOUNT_GLOBAL_RE.lastIndex = 0;
      if (AMOUNT_GLOBAL_RE.test(line)) {
        blocks.push(line);
        currentBlock = "";
      } else {
        currentBlock = line;
      }
      continue;
    }

    if (currentBlock) {
      currentBlock += ` ${line}`;
    }
  }
  flushBlock();

  for (const block of blocks) {
    const startMatch = block.match(BLOCK_START_RE);
    if (!startMatch) continue;

    const remainder = block.slice(startMatch[0].length).trim();
    if (!remainder) continue;

    AMOUNT_GLOBAL_RE.lastIndex = 0;
    const amounts = Array.from(remainder.matchAll(AMOUNT_GLOBAL_RE));
    if (!amounts.length) continue;

    const lastAmount = amounts[amounts.length - 1];
    const amountIndex = lastAmount.index ?? -1;
    if (amountIndex < 0) continue;

    const description = remainder.slice(0, amountIndex).trim();
    pushCandidate(createTransactionCandidate(startMatch[1], description, lastAmount[0], file.name, invoiceDueDate));
  }

  const summary = extractInvoiceSummary(page1Text);

  if (transactions.length === 0 && summary) {
    console.warn("PDF importou só o resumo sem transações", {
      file: file.name,
      sampleLines: rawLines.filter(Boolean).slice(0, 25),
    });
  }

  return { transactions, summary };
}

export function sanitizeTransaction(t: RawTransaction): RawTransaction {
  const desc = t.description.trim();
  // 1. Try to find "R$ XX,XX" anywhere in the description
  let match = desc.match(/R\$\s*(\d+(?:\.\d{3})*,\d{2})/i);
  // 2. Fallback to matching any "XX,XX" at the very end of the description
  if (!match) {
    match = desc.match(/(\d+(?:\.\d{3})*,\d{2})$/i);
  }
  
  if (match) {
    const rawVal = match[1];
    const cleanVal = rawVal.replace(/\./g, "").replace(",", ".");
    const parsedAmount = parseFloat(cleanVal);
    if (!isNaN(parsedAmount) && parsedAmount > 0 && parsedAmount !== t.amount) {
      const idx = desc.indexOf(match[0]);
      const cleanDesc = desc.substring(0, idx).trim();
      return {
        ...t,
        description: cleanDesc || t.description,
        amount: parsedAmount
      };
    }
  }
  return t;
}

