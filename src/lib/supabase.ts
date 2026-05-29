import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseEnabled = Boolean(supabaseUrl && supabaseAnonKey);

// Create client only if environment variables are available, otherwise use dummy client
let supabase: any;

if (supabaseEnabled) {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
} else {
  console.warn('Supabase environment variables not configured. Running in local-only mode.');
  // Dummy client that won't be used
  supabase = {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: () => ({
      select: () => ({ eq: () => ({ order: () => ({ then: (f: any) => f({ data: null, error: null }) }) }) }),
    }),
  };
}

export { supabase };