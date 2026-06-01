# 🏗️ Arquitetura de Sincronização - Auditor Cartão

## Status Atual (Junho 2026)

### Stack Confirmado
- **Frontend**: Vercel (TanStack Start + Vite + React)
- **Backend API**: Cloudflare Workers (wrangler.jsonc)
- **Banco de Dados**: Supabase PostgreSQL ✅ (PRINCIPAL)
- **Auth**: Supabase Auth ✅
- **Storage Local**: localStorage (navegador)

---

## 🔄 Fluxo de Sincronização

### Como funciona:

```
1. Usuário abre o app
   ↓
2. App verifica .env.local para VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
   ↓
3. Se configurado, tenta conectar ao Supabase
   ↓
4. Carrega dados locais do localStorage
   ↓
5. Se logado, sincroniza com Supabase (fetchCloudData + syncLocalDataToCloud)
   ↓
6. Cada ação (PDF upload, categorização) salva:
   - localStorage (imediato)
   - Supabase (após login)
```

### Sincronização automática ocorre em:
- ✅ Login (em `restoreSession()` → `synchronizeCloud()`)
- ✅ Upload de PDF (em `handleFiles()`)
- ✅ Atualização de categoria
- ✅ Qualquer mudança nos dados locais

---

## ⚙️ Configuração Necessária

### 1. Variáveis de Ambiente (Local)
**Arquivo: `.env.local`** ✅ Já configurado!

```env
VITE_SUPABASE_URL=https://bodmtjbzyypwasepvvvp.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc... [sua chave]
```

### 2. Variáveis de Ambiente (Vercel - ⚠️ CRÍTICO)
Precisa configurar no Vercel Dashboard:

```
VITE_SUPABASE_URL=https://bodmtjbzyypwasepvvvp.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc... [sua chave]
```

**Como fazer no Vercel:**
1. Acesse: https://vercel.com/dashboard
2. Selecione o projeto `auditorcartao`
3. Settings → Environment Variables
4. Adicione as 2 variáveis acima
5. Redeploy o projeto

### 3. Supabase (Banco de Dados)
**Tabelas já criadas:**
- `card_transactions` - Transações importadas dos PDFs
- `card_categories` - Categorias personalizadas
- `card_summaries` - Resumo das faturas
- `auth.users` - Usuários (gerenciado por Supabase Auth)

**Schema já implementado em:** `supabase_schema.sql`

---

## 🔍 Como Testar Sincronização

### Teste 1: Verificar Configuração (Dev Local)
```
1. Abra o navegador (console DevTools F12)
2. Vá para a home do app
3. No console, execute:
   localStorage.getItem('audit_txs')  // deve mostrar transações
4. Se você estiver logado, tente fazer upload de um PDF
5. Verifique em Supabase Dashboard → SQL Editor:
   SELECT * FROM card_transactions WHERE user_id = 'seu_user_id' LIMIT 5;
```

### Teste 2: Sincronização Multi-dispositivo
```
1. Faça login em um navegador (Chrome no PC)
2. Importe um PDF e categorize
3. Em outro navegador (Firefox no celular):
   - Vá para o mesmo app
   - Faça login com o mesmo usuário
   - Os dados devem aparecer automaticamente
4. Se não aparecerem:
   - Recarregue a página
   - Verifique console para erros
```

### Teste 3: Verificar Status de Sincronização
Na parte inferior da dashboard, há um badge que mostra:
- "Modo local (Supabase não configurado)" → ENV vars faltando
- "Sincronizando com a nuvem..." → Enviando dados
- "Dados sincronizados com a nuvem" → Sucesso ✅
- "Erro de sincronização" → Problema na conexão ⚠️

---

## 🐛 Problemas e Soluções

### Problema 1: "Modo local (Supabase não configurado)"
**Causa:** ENV vars não configuradas
**Solução:**
1. Verificar `.env.local` tem as 2 variáveis
2. Se em Vercel, adicionar as variáveis no Settings
3. Redeploy o projeto no Vercel

### Problema 2: Dados não sincronizam em outro dispositivo
**Causa:** 
- Usuário não logado
- ENV vars não configuradas no Vercel
- Firewall/CORS bloqueando Supabase

**Solução:**
1. Confirmar login (Supabase Auth)
2. Verificar console para erros CORS
3. Verificar se Supabase projeto não está com rate limiting

### Problema 3: Conflito Cloudflare + Vercel
**Contexto:** wrangler.jsonc está no projeto mas NÃO é usado para a API
**Status:** ⚠️ Pode gerar confusão
**Ação recomendada:** 
- Se não usar Cloudflare Workers, remover wrangler.jsonc
- Se usar, criar API routes em Cloudflare Workers para backend
- Atualmente, o backend é direto no Supabase (sem intermediário)

---

## 📊 Banco de Dados - Estrutura

### Tabela: `card_transactions`
```sql
- user_id (UUID) - Seu ID no Supabase Auth
- transaction_id (UUID) - ID único da transação
- date (TEXT) - DD/MM format
- description (TEXT) - Descrição do gasto
- amount (DECIMAL) - Valor em R$
- category (TEXT) - Categoria (ex: "Alimentação")
- source (TEXT) - Nome do PDF (ex: "fatura_maio2025.pdf")
- invoice_due_date (TEXT) - YYYY-MM-DD
- installment_current / installment_total - Parcelas
- created_at / updated_at - Timestamps
```

### Tabela: `card_categories`
```sql
- user_id (UUID)
- name (TEXT) - Nome da categoria personalizada
```

### Tabela: `card_summaries`
```sql
- user_id (UUID)
- source (TEXT) - Arquivo da fatura
- total_amount (DECIMAL) - Valor total da fatura
- previous_balance (DECIMAL) - Saldo anterior
- [outros campos de resumo]
```

---

## 🚀 Configuração Recomendada Final

### Opção A: Manter Supabase (RECOMENDADO)
✅ Mais simples
✅ Funciona em dev e produção
✅ Sem conflitos

**Passos:**
1. ✅ Já está configurado localmente
2. ⚠️ ADICIONAR vars no Vercel (crítico!)
3. Testar sincronização em produção
4. Opcionalmente remover wrangler.jsonc se não usar

### Opção B: Usar Cloudflare Workers como API
❌ Mais complexo
❌ Adiciona camada intermediária
❌ Possível conflito com Vercel

**Não recomendado** a menos que tenha necessidade específica.

---

## ✅ Checklist de Produção

- [ ] Variáveis de ambiente adicionadas no Vercel
- [ ] Testar login e sincronização em produção
- [ ] Testar em 2 navegadores diferentes
- [ ] Testar em mobile
- [ ] Verificar console para erros CORS/API
- [ ] Backup do banco Supabase feito
- [ ] Documentação compartilhada com time

---

## 📞 Próximos Passos

1. **Imediato**: Adicionar ENV vars no Vercel Dashboard
2. **Hoje**: Testar sincronização multi-dispositivo
3. **Se houver erro**: Verificar console e Supabase logs
4. **Longo prazo**: Considerar remover wrangler.jsonc se não for usar

---

**Data**: Junho 2026  
**Status**: Supabase ✅ Configurado | Vercel 🔄 Pendente | Cloudflare Workers ❌ Não necessário
