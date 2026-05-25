import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-primary drop-shadow-[0_0_15px_rgba(120,224,154,0.15)]">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A página que você está procurando não existe ou foi movida.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-mono uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Voltar ao Início
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Esta página não pôde ser carregada
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Ocorreu um erro inesperado em nosso sistema. Tente recarregar a página ou voltar ao início.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-mono uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary/90 cursor-pointer"
          >
            Tentar Novamente
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-border/40 bg-background px-4 py-2 text-sm font-mono uppercase tracking-wider text-foreground transition-colors hover:bg-muted/50 cursor-pointer"
          >
            Voltar ao Início
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Auditor · Inteligência e Auditoria de Cartão" },
      { name: "description", content: "Auditor Cartão analisa faturas em PDF para extrair lançamentos, categorizar gastos, identificar anomalias e gerar projeções de parcelas futuras." },
      { name: "author", content: "Auditor" },
      { property: "og:title", content: "Auditor · Inteligência e Auditoria de Cartão" },
      { property: "og:description", content: "Auditor Cartão analisa faturas em PDF para extrair lançamentos, categorizar gastos, identificar anomalias e gerar projeções de parcelas futuras." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Auditor · Inteligência e Auditoria de Cartão" },
      { name: "twitter:description", content: "Auditor Cartão analisa faturas em PDF para extrair lançamentos, categorizar gastos, identificar anomalias e gerar projeções de parcelas futuras." },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
