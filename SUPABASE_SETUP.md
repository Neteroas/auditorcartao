# Integração com Supabase

## Configuração

### 1. Instale as dependências

O projeto já possui `@supabase/supabase-js@^2.106.2` instalado.

```bash
npm install
```

### 2. Configure as variáveis de ambiente

Crie um arquivo `.env.local` na raiz do projeto com suas credenciais do Supabase:

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anonima
```

Você encontra essas credenciais em:
- Dashboard Supabase → Settings → API → Project URL e anon key

### 3. Arquivos adicionados

- **`src/lib/supabase.ts`** - Cliente Supabase configurado
- **`src/hooks/useSupabase.ts`** - Hook React para operações com banco de dados
- **`.env.example`** - Exemplo de variáveis de ambiente

## Uso

### Hook `useSupabase`

O hook fornece métodos para CRUD:

```typescript
import { useSupabase } from '@/hooks';

function MyComponent() {
  const { query, insert, update, remove, loading, error } = useSupabase();

  // Query
  const users = await query('users', {
    select: 'id, name, email',
    limit: 10
  });

  // Insert
  const newUser = await insert('users', {
    name: 'João',
    email: 'joao@example.com'
  });

  // Update
  const updatedUser = await update('users', userId, {
    name: 'João Silva'
  });

  // Delete
  await remove('users', userId);

  return (
    <div>
      {loading && <p>Carregando...</p>}
      {error && <p>Erro: {error.message}</p>}
    </div>
  );
}
```

## Client Supabase direto

Também é possível usar o cliente Supabase diretamente:

```typescript
import { supabase } from '@/lib/supabase';

const { data, error } = await supabase
  .from('users')
  .select()
  .eq('id', userId);
```

## Documentação

- [Supabase JavaScript SDK](https://supabase.com/docs/reference/javascript/introduction)
- [Supabase Database](https://supabase.com/docs/guides/database)
