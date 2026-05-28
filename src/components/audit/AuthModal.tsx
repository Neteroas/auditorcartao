import { useState } from "react";
import { supabase } from "@/lib/supabase";
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
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      const trimmedEmail = email.trim();
      if (!trimmedEmail) throw new Error("Por favor, digite seu e-mail.");
      if (password.length < 6) throw new Error("A senha deve conter no mínimo 6 caracteres.");

      if (isLogin) {
        // Sign In
        const { data, error: authErr } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password
        });

        if (authErr) {
          if (authErr.message === "Invalid login credentials") {
            throw new Error("E-mail ou senha incorretos.");
          }
          throw authErr;
        }
        
        setSuccessMsg("Entrando... Conexão segura estabelecida!");
        setTimeout(() => {
          onSuccess(data.user);
          onClose();
        }, 1200);
      } else {
        // Sign Up
        const { data, error: authErr } = await supabase.auth.signUp({
          email: trimmedEmail,
          password
        });

        if (authErr) throw authErr;

        if (data.user?.identities?.length === 0) {
          throw new Error("Este e-mail já está cadastrado. Tente fazer login!");
        }

        setSuccessMsg("Conta criada! Verifique seu e-mail para confirmação se necessário.");
        setTimeout(() => {
          if (data.user) {
            onSuccess(data.user);
          }
          onClose();
        }, 3000);
      }
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

        {/* Tab Selector */}
        <div className="grid grid-cols-2 gap-2 bg-white/5 p-1 rounded-xl border border-white/5 mb-6 text-sm font-medium">
          <button
            onClick={() => { setIsLogin(true); setError(null); setSuccessMsg(null); }}
            className={`py-2 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              isLogin 
                ? "bg-primary text-white shadow-md shadow-primary/30" 
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LogIn className="size-3.5" />
            Entrar
          </button>
          <button
            onClick={() => { setIsLogin(false); setError(null); setSuccessMsg(null); }}
            className={`py-2 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              !isLogin 
                ? "bg-primary text-white shadow-md shadow-primary/30" 
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <UserPlus className="size-3.5" />
            Criar Conta
          </button>
        </div>

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
                placeholder="nome@exemplo.com"
                required
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-white/10 bg-white/5 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary text-sm font-medium transition-all"
              />
            </div>
          </div>

          {/* Password field */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Senha
            </label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-3 size-4.5 text-muted-foreground/60" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="******"
                required
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-white/10 bg-white/5 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary text-sm font-medium transition-all"
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
            disabled={loading}
            className="w-full bg-primary hover:bg-primary-hover active:scale-[0.98] text-white font-semibold py-3 rounded-xl shadow-lg shadow-primary/30 flex items-center justify-center gap-2 text-sm transition-all hover:shadow-primary/45 disabled:opacity-50 disabled:pointer-events-none"
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : isLogin ? (
              <>
                <LogIn className="size-4" />
                Acessar Auditor
              </>
            ) : (
              <>
                <UserPlus className="size-4" />
                Criar Minha Conta
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
