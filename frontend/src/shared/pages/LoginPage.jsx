import { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Eye, EyeSlash } from '@phosphor-icons/react';

// Patron topografico (Hero Patterns "Topography", MIT) — encoded as data URL
const TOPO_SVG = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='800' height='800' viewBox='0 0 800 800'><g fill='none' stroke='currentColor' stroke-width='1.2'><path d='M769 229L1037 260.9M927 880L731 737 520 660 309 538 40 599 295 764 126.5 879.5 40 599-197 493 102 382-31 229 126.5 79.5-69-63'/><path d='M-31 229L237 261 390 382 603 493 308.5 537.5 101.5 381.5M370 905L295 764'/><path d='M520 660L578 842 731 737 840 599 603 493 520 660 295 764 309 538 390 382 539 269 769 229 577.5 41.5 370 105 295 -36 126.5 79.5 237 261 102 382 40 599 -69 737 127 880'/><path d='M520-140L578.5 42.5 731-63M603 493L539 269 237 261 370 105M902 382L539 269M390 382L102 382'/><path d='M-222 42L126.5 79.5 370 105 539 269 577.5 41.5 927 80 769 229 902 382 603 493 731 737M295-36L577.5 41.5M578 842L295 764M40-201L127 80M102 382L-261 269'/></g><g fill='currentColor'><circle cx='769' cy='229' r='4'/><circle cx='539' cy='269' r='4'/><circle cx='603' cy='493' r='4'/><circle cx='731' cy='737' r='4'/><circle cx='520' cy='660' r='4'/><circle cx='309' cy='538' r='4'/><circle cx='295' cy='764' r='4'/><circle cx='40' cy='599' r='4'/><circle cx='102' cy='382' r='4'/><circle cx='127' cy='80' r='4'/><circle cx='370' cy='105' r='4'/><circle cx='578' cy='42' r='4'/><circle cx='237' cy='261' r='4'/><circle cx='390' cy='382' r='4'/></g></svg>`;

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isAuthenticated, loading: authLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (isAuthenticated) {
    const from = location.state?.from?.pathname || '/dashboard';
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password.trim()) {
      setError('Completa todos los campos');
      return;
    }

    setLoading(true);
    try {
      await login(email, password);
      const from = location.state?.from?.pathname || '/dashboard';
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || 'Credenciales incorrectas');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex bg-background">
      {/* Panel formulario (izquierda) */}
      <div className="w-full lg:w-[440px] xl:w-[480px] flex flex-col justify-between p-8 lg:p-10 flex-shrink-0">
        {/* Logo */}
        <div className="flex items-center justify-center pt-8 lg:pt-12">
          <img src="/iseie-logo-color.png" alt="ISEIE" className="h-10 w-auto object-contain dark:hidden" />
          <img src="/iseie-logo.png"       alt="ISEIE" className="h-10 w-auto object-contain hidden dark:block" />
        </div>

        {/* Form al centro vertical */}
        <div className="flex-1 flex items-center justify-center py-10">
          <div className="w-full max-w-[340px]">
            <div className="mb-6">
              <h1 className="text-xl font-semibold">Inicia sesión</h1>
              <p className="text-muted-foreground text-sm mt-1">Introduce tus credenciales para continuar.</p>
            </div>

            <form onSubmit={handleSubmit} aria-label="Formulario de inicio de sesión" className="space-y-4">
              <div>
                <label htmlFor="login-email" className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 block">
                  Email
                </label>
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nombre@empresa.com"
                  autoComplete="email"
                  autoFocus
                  className="w-full h-11 px-4 rounded-lg border border-border bg-muted/30 text-sm outline-none transition-all focus:border-primary focus:bg-background focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground"
                />
              </div>

              <div>
                <label htmlFor="login-password" className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 block">
                  Contraseña
                </label>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Tu contraseña"
                    autoComplete="current-password"
                    className="w-full h-11 px-4 pr-11 rounded-lg border border-border bg-muted/30 text-sm outline-none transition-all focus:border-primary focus:bg-background focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
                  >
                    {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {error && (
                <div role="alert" className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-4 py-2.5 font-medium">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 bg-primary text-primary-foreground rounded-lg font-semibold text-sm hover:bg-primary/90 transition-colors active:scale-[0.99] disabled:opacity-60 disabled:pointer-events-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-2 focus:ring-offset-background"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Iniciando sesión...
                  </span>
                ) : (
                  'Iniciar sesión'
                )}
              </button>

              <p className="text-xs text-muted-foreground text-center pt-2">
                ¿No tienes cuenta?{' '}
                <span className="text-foreground font-medium cursor-pointer hover:underline underline-offset-2">
                  Contacta con el administrador
                </span>
              </p>
            </form>
          </div>
        </div>

        {/* Footer */}
        <p className="text-xs text-muted-foreground/60">
          &copy; {new Date().getFullYear()} CRM ISEIE · v0.1.0
        </p>
      </div>

      {/* Panel decoracion (derecha, solo desktop) */}
      <div
        aria-hidden="true"
        className="hidden lg:flex flex-1 relative overflow-hidden bg-gradient-to-br from-primary/5 via-violet-500/5 to-emerald-500/5 dark:from-primary/10 dark:via-violet-500/10 dark:to-emerald-500/10"
      >
        <div
          className="absolute inset-0 text-primary/30 dark:text-primary/20"
          style={{
            backgroundImage: `url("${TOPO_SVG}")`,
            backgroundSize: '700px 700px',
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background/60 via-transparent to-transparent pointer-events-none" />
        <div className="absolute top-1/4 right-1/4 w-96 h-96 rounded-full bg-violet-500/10 dark:bg-violet-500/5 blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 left-1/3 w-80 h-80 rounded-full bg-emerald-500/10 dark:bg-emerald-500/5 blur-3xl pointer-events-none" />
      </div>
    </div>
  );
}
