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
  { name: "Serviços", keywords: /tim|vivo|claro|\boi\s|\bnet\b|sky|enel|cemig|sabesp|copasa|cpfl|seguro|condominio|aluguel/i },
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
const INSTALLMENT_RE = /(\d{1,2})\s?\/\s?(\d{1,2})/;
const TRANSACTION_BLOCK_BREAK_RE = /^(?:resumo\b|lan[çc]amentos?\b|data\b|descri[çc][aã]o\b|valor\b|saldo\s+(?:anterior|para)\b|pagamentos?\b|cr[eé]ditos?\b|compras?\s+(?:nacionais?|internacionais?)\b|tarifas?\b|encargos?\b|juros\b|total\b|limite\b)/i;
const IGNORED_DESCRIPTION_RE = /^(?:total\s+(?:da\s+)?fatura|saldo\s+para\s+pr[oó]xima|limite\s+(?:total|dispon[ií]vel|utilizado)|data\s+descri[çc][aã]o\s+valor|data\s+lan[çc]amento|descri[çc][aã]o\s+do\s+lan[çc]amento)$/i;

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
      if (yearMatch) {
        return `${yearMatch[1]}-${num}-10`;
      }

      const shortYearMatch = clean.match(/\b(\d{2})\b/);
      if (shortYearMatch) {
        const yearNum = Number(shortYearMatch[1]);
        if (yearNum >= 0 && yearNum <= 99) {
          const fullYear = yearNum < 50 ? 2000 + yearNum : 1900 + yearNum;
          return `${fullYear}-${num}-10`;
        }
      }

      return `${new Date().getFullYear()}-${num}-10`;
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
  const pdfjsLib = await getPdfJs();
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  let fullText = "";
  let page1Text = "";
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = content.items as any[];
    // Group by y position with ~3px tolerance to reconstruct lines.
    // Exact rounding splits items with sub-pixel baseline differences, breaking
    // the regex and causing some PDFs to extract zero transactions.
    const Y_TOL = 3;
    const buckets: { y: number; items: { x: number; str: string }[] }[] = [];
    for (const it of items) {
      const y = it.transform[5];
      const x = it.transform[4];
      const str = it.str;
      let bucket = buckets.find((b) => Math.abs(b.y - y) <= Y_TOL);
      if (!bucket) {
        bucket = { y, items: [] };
        buckets.push(bucket);
      }
      bucket.items.push({ x, str });
    }
    buckets.sort((a, b) => b.y - a.y);
    let pageText = "";
    for (const b of buckets) {
      const lineStr = b.items
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
  const rawLines = fullText.split("\n").map((l) => l.replace(/\s+/g, " ").trim());
  const seenKeys = new Set<string>();

  const pushCandidate = (candidate: RawTransaction | null) => {
    if (!candidate) return false;
    const key = `${candidate.date}|${candidate.description}|${candidate.amount.toFixed(2)}`;
    if (seenKeys.has(key)) return false;
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
      currentBlock = line;
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
