import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Verifica se as credenciais são válidas antes de criar o cliente.
// Credenciais ausentes ou com valores de placeholder causam uma exceção em
// createClient() que derruba toda a aplicação antes de qualquer rota carregar.
const isConfigured =
  supabaseUrl.startsWith('https://') &&
  !supabaseUrl.includes('seu-projeto-id') &&
  supabaseAnonKey.length > 20 &&
  !supabaseAnonKey.includes('...');

export const supabase = isConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : (null as unknown as ReturnType<typeof createClient>);

/** true quando o Supabase está configurado e disponível */
export const supabaseEnabled = isConfigured;

