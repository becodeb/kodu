import { useState, type FormEvent } from 'react';
import { apiRequest } from '../../lib/client/api.ts';

interface Props {
  nombreInicial: string;
  emailInicial: string;
  /** Prellenado cuando viene de la rama "Hablemos" de la calculadora (T5). */
  institucionInicial?: string;
  alumnosIniciales?: number | null;
}

/**
 * odd/tasks/planes-y-cobros.md (T5): el contacto "Hablemos" — dos entradas:
 * matrícula por encima del umbral (`AltaInstitucionForm` lo embebe) o el
 * dominio del creador es público (`alta.astro` lo muestra directo). Nunca
 * crea una organización, sólo una fila que revisa el superadmin (T7).
 */
export default function LeadInstitucionForm({ nombreInicial, emailInicial, institucionInicial, alumnosIniciales }: Props) {
  const [institutionName, setInstitutionName] = useState(institucionInicial ?? '');
  const [contactName, setContactName] = useState(nombreInicial);
  const [contactEmail, setContactEmail] = useState(emailInicial);
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const resultado = await apiRequest('/api/instituciones/lead', 'POST', {
      institutionName,
      contactName,
      contactEmail,
      phone: phone || null,
      declaredStudents: alumnosIniciales ?? null,
      message: message || null,
    });

    setPending(false);
    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }
    setEnviado(true);
  }

  if (enviado) {
    return (
      <p className="rounded-lg bg-sutil px-4 py-3 text-sm text-ink-700">
        Recibimos tu consulta. Te vamos a escribir a <strong>{contactEmail}</strong> a la brevedad.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="kodu-label" htmlFor="lead-institution">Institución</label>
        <input
          id="lead-institution"
          className="kodu-input"
          required
          disabled={pending}
          value={institutionName}
          onChange={(e) => setInstitutionName(e.target.value)}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="kodu-label" htmlFor="lead-name">Tu nombre</label>
          <input
            id="lead-name"
            className="kodu-input"
            required
            disabled={pending}
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
          />
        </div>
        <div>
          <label className="kodu-label" htmlFor="lead-email">Email</label>
          <input
            id="lead-email"
            type="email"
            className="kodu-input"
            required
            disabled={pending}
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
        </div>
      </div>
      <div>
        <label className="kodu-label" htmlFor="lead-phone">Teléfono (opcional)</label>
        <input
          id="lead-phone"
          className="kodu-input"
          disabled={pending}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      <div>
        <label className="kodu-label" htmlFor="lead-message">Contanos tu caso (opcional)</label>
        <textarea
          id="lead-message"
          className="kodu-input"
          rows={3}
          disabled={pending}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className="kodu-btn kodu-btn-primary">
        {pending ? 'Mandando…' : 'Escribinos'}
      </button>
    </form>
  );
}
