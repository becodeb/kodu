import { useState, type FormEvent } from 'react';

interface AuthFormProps {
  mode: 'login' | 'register';
  /** Dominios institucionales habilitados, para el texto de ayuda. */
  allowedDomains: string;
  /** Ruta a la que volver despues de iniciar sesion (?next=...). */
  nextUrl?: string;
}

interface AuthResponse {
  ok: boolean;
  error?: string;
  redirect?: string;
}

/**
 * Isla React de autenticacion. Habla con /api/auth/login | /api/auth/register
 * por fetch y redirige del lado del cliente cuando el backend confirma.
 */
export default function AuthForm({ mode, allowedDomains, nextUrl }: AuthFormProps) {
  const isRegister = mode === 'register';
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData.entries());

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as AuthResponse;

      if (!response.ok || !data.ok) {
        setError(data.error ?? 'No pudimos completar la operación.');
        setPending(false);
        return;
      }

      window.location.href = nextUrl || data.redirect || '/app';
    } catch {
      setError('Error de conexión con el servidor.');
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {isRegister && (
        <div>
          <label className="kodu-label" htmlFor="name">
            Nombre y apellido
          </label>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            required
            disabled={pending}
            className="kodu-input"
            placeholder="Ana Pérez"
          />
        </div>
      )}

      <div>
        <label className="kodu-label" htmlFor="email">
          Email institucional
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={pending}
          className="kodu-input"
          placeholder={`docente${allowedDomains.split(',')[0]?.trim() ?? ''}`}
        />
        <p className="mt-1.5 text-xs text-ink-500">
          Solo se aceptan correos de: <span className="font-medium">{allowedDomains}</span>
        </p>
      </div>

      <div>
        <label className="kodu-label" htmlFor="password">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          required
          minLength={isRegister ? 8 : undefined}
          disabled={pending}
          className="kodu-input"
          placeholder={isRegister ? 'Mínimo 8 caracteres' : '••••••••'}
        />
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <button type="submit" disabled={pending} className="kodu-btn-primary w-full">
        {pending ? 'Procesando…' : isRegister ? 'Crear cuenta' : 'Ingresar'}
      </button>
    </form>
  );
}
