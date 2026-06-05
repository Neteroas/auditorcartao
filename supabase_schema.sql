-- SCHEMA DE BANCO DE DADOS - AUDITOR CARTÃO (SUPABASE)
-- Copie este script e cole no SQL Editor do seu projeto Supabase.
-- Clique em "Run" para executar e criar as tabelas e políticas de segurança.

-- Habilita a extensão UUID caso não esteja ativa
create extension if not exists "uuid-ossp";

-------------------------------------------------------------------------------
-- 1. TABELA: CARD_CATEGORIES (Categorias Customizadas)
-------------------------------------------------------------------------------
create table if not exists public.card_categories (
    id uuid default gen_random_uuid() primary key,
    user_id uuid references auth.users(id) on delete cascade not null,
    name text not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    
    -- Impede duplicidade de nome de categoria por usuário
    unique(user_id, name)
);

-- Ativa Row Level Security (RLS)
alter table public.card_categories enable row level security;

-- Políticas de Acesso Seguro (RLS)
create policy "Usuários podem gerenciar apenas suas próprias categorias" 
on public.card_categories for all 
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Índices para melhor desempenho de busca
create index if not exists idx_card_categories_user_id on public.card_categories(user_id);

-------------------------------------------------------------------------------
-- 2. TABELA: CARD_TRANSACTIONS (Lançamentos de Cartão)
-------------------------------------------------------------------------------
create table if not exists public.card_transactions (
    id uuid default gen_random_uuid() primary key,
    user_id uuid references auth.users(id) on delete cascade not null,
    transaction_id text not null, -- ID único gerado no parser client-side
    date text not null,
    description text not null,
    amount numeric not null,
    installment_current integer,
    installment_total integer,
    category text not null,
    source text not null, -- Nome do arquivo PDF de origem
    invoice_due_date text,
    is_manual_category boolean not null default false, -- Indica se o usuário alterou a categoria manualmente
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Ativa Row Level Security (RLS)
alter table public.card_transactions enable row level security;

-- Políticas de Acesso Seguro (RLS)
create policy "Usuários podem gerenciar apenas suas próprias transações" 
on public.card_transactions for all 
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Índices para otimização de filtros, agregação e junções
create index if not exists idx_card_transactions_user_id on public.card_transactions(user_id);
create index if not exists idx_card_transactions_source on public.card_transactions(user_id, source);

-------------------------------------------------------------------------------
-- 3. TABELA: CARD_SUMMARIES (Resumos Financeiros por Fatura)
-------------------------------------------------------------------------------
create table if not exists public.card_summaries (
    id uuid default gen_random_uuid() primary key,
    user_id uuid references auth.users(id) on delete cascade not null,
    source text not null, -- Nome da fatura PDF (chave única por usuário)
    previous_balance numeric not null default 0,
    payments_credits numeric not null default 0,
    local_purchases numeric not null default 0,
    intl_purchases numeric not null default 0,
    fees_and_charges numeric not null default 0,
    total_amount numeric not null default 0,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    
    unique(user_id, source)
);

-- Ativa Row Level Security (RLS)
alter table public.card_summaries enable row level security;

-- Políticas de Acesso Seguro (RLS)
create policy "Usuários podem gerenciar apenas seus próprios resumos" 
on public.card_summaries for all 
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Índices para buscas rápidas de resumo
create index if not exists idx_card_summaries_user_id on public.card_summaries(user_id);
