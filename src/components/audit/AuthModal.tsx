import { useState } from "react";
import { supabase, supabaseEnabled } from "@/lib/supabase";
import { 
  Cloud, 
  Lock, 
  Loader2, 
  Mail, 
  KeyRound, 
  LogIn, 
  AlertCircle, 
  X, 
  CheckCircle2, 
  UserPlus 
} from "lucide-react";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: any) => void;
}

export function AuthModal({ isOpen, onClose, onSuccess }: AuthModalProps) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    if (!supabaseEnabled) {
      setError("Supabase não configurado. Adicione VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY válidos no arquivo .env.local.");
      setLoading(false);
      return;
    }

    try {
      const trimmedEmail = email.trim();
      if (!trimmedEmail) throw new Error("Por favor, digite seu e-mail.");

      // Enviar Magic Link por email
      const { error: authErr } = await supabase.auth.signInWithOtp({
        email: trimmedEmail,
        options: {
          emailRedirectTo: window.location.origin,
        }
      });

      if (authErr) throw authErr;

      setEmailSent(true);
      setSuccessMsg("Link de acesso enviado! Verifique seu e-mail.");
      setTimeout(() => {
        onClose();
      }, 3000);
    } catch (err: any) {
      setError(err?.message || "Ocorreu um erro inesperado.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop glassmorphism */}
      <div 
        className="absolute inset-0 bg-background/60 backdrop-blur-md transition-opacity duration-300"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div className="relative w-full max-w-md glass-card rounded-2xl p-6 md:p-8 shadow-2xl border border-white/10 bg-white/5 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Close Button */}
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground hover:bg-white/10 p-1.5 rounded-lg transition-all"
        >
          <X className="size-4" />
        </button>

        {/* Top Header */}
        <div className="text-center mb-8">
          <div className="inline-flex size-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4 text-primary shadow-sm shadow-primary/20">
            <Cloud className="size-6 animate-pulse" />
          </div>
          <h2 className="font-display text-2xl font-800 tracking-tight text-foreground">
            Sincronizar com a Nuvem
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto leading-relaxed">
            Acesse suas faturas, parcelas e categorias de qualquer lugar, com segurança e privacidade.
          </p>
        </div>

        {/* Tab Selector - REMOVIDO, usar magic link direto */}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* Email field */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Endereço de e-mail
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-3 size-4.5 text-muted-foreground/60" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                required
                disabled={emailSent}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-white/10 bg-white/5 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary text-sm font-medium transition-all disabled:opacity-50"
              />
            </div>
          </div>

          {/* Messages */}
          {error && (
            <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-3.5 text-xs flex gap-2.5 text-destructive animate-in slide-in-from-top-2 duration-200">
              <AlertCircle className="size-4 flex-shrink-0" />
              <p className="leading-normal font-medium">{error}</p>
            </div>
          )}

          {successMsg && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3.5 text-xs flex gap-2.5 text-emerald-400 animate-in slide-in-from-top-2 duration-200">
              <CheckCircle2 className="size-4 flex-shrink-0" />
              <p className="leading-normal font-medium">{successMsg}</p>
            </div>
          )}

          {/* Submit button */}
          <button
            type="submit"
            disabled={loading || emailSent}
            className="w-full bg-primary hover:bg-primary-hover active:scale-[0.98] text-white font-semibold py-3 rounded-xl shadow-lg shadow-primary/30 flex items-center justify-center gap-2 text-sm transition-all hover:shadow-primary/45 disabled:opacity-50 disabled:pointer-events-none"
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : emailSent ? (
              <>
                <CheckCircle2 className="size-4" />
                Link enviado!
              </>
            ) : (
              <>
                <Mail className="size-4" />
                Enviar Link de Acesso
              </>
            )}
          </button>

        </form>

        {/* Footer info */}
        <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <Lock className="size-3" />
          <span>Seus dados são transmitidos com criptografia ponta-a-ponta SSL.</span>
        </div>

      </div>
    </div>
  );
}
