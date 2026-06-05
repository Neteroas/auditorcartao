-- MIGRAÇÃO: adiciona coluna is_manual_category à tabela card_transactions
-- Execute no SQL Editor do Supabase → Run

alter table public.card_transactions
  add column if not exists is_manual_category boolean not null default false;

comment on column public.card_transactions.is_manual_category
  is 'Indica se o usuário alterou a categoria desta transação manualmente';
