import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';

export function useSupabase() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const query = useCallback(
    async <T,>(
      table: string,
      options?: {
        select?: string;
        filter?: [string, string, unknown];
        limit?: number;
      }
    ): Promise<T[] | null> => {
      setLoading(true);
      setError(null);

      try {
        let query = supabase.from(table).select(options?.select || '*');

        if (options?.filter) {
          const [column, operator, value] = options.filter;
          query = query.filter(column, operator as any, value);
        }

        if (options?.limit) {
          query = query.limit(options.limit);
        }

        const { data, error: err } = await query;

        if (err) throw err;
        return data as T[];
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const insert = useCallback(
    async <T,>(table: string, data: Record<string, unknown>): Promise<T | null> => {
      setLoading(true);
      setError(null);

      try {
        const { data: result, error: err } = await supabase
          .from(table)
          .insert([data])
          .select()
          .single();

        if (err) throw err;
        return result as T;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        return null;
      } finally {
        setLoading(false);
      }
    }
  );

  const update = useCallback(
    async <T,>(
      table: string,
      id: string | number,
      data: Record<string, unknown>
    ): Promise<T | null> => {
      setLoading(true);
      setError(null);

      try {
        const { data: result, error: err } = await supabase
          .from(table)
          .update(data)
          .eq('id', id)
          .select()
          .single();

        if (err) throw err;
        return result as T;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        return null;
      } finally {
        setLoading(false);
      }
    }
  );

  const remove = useCallback(
    async (table: string, id: string | number): Promise<boolean> => {
      setLoading(true);
      setError(null);

      try {
        const { error: err } = await supabase.from(table).delete().eq('id', id);

        if (err) throw err;
        return true;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        return false;
      } finally {
        setLoading(false);
      }
    }
  );

  return { query, insert, update, remove, loading, error };
}
