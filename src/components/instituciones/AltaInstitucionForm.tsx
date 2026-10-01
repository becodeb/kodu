import { useEffect, useState, type FormEvent } from 'react';
import { apiRequest } from '../../lib/client/api.ts';
import LeadInstitucionForm from './LeadInstitucionForm.tsx';

interface Props {
  /** Dominio del creador — pre-cargado y bloqueado como el primer dominio (decisión de T5). */
  dominioPropio: string;
  /** `?alumnos=N` de la URL (futuro `/precios?alumnos=N`, T6) para prellenar la matrícula. */
  alumnosPrefill: string;
  nombreContacto: string;
  emailContacto: string;
  /** T11: la prueba institucional es un interruptor del superadmin (OFF por
   *  default) — el botón de envío nunca promete una prueba que está apagada. */
  trialEnabled: boolean;
  trialDays: number;
}

interface Campus {
  name: string;
  domain: string;
}

type PrecioPreview =
  | { estado: 'idle' }
  | { estado: 'cargando' }
  | { estado: 'error'; mensaje: string }
  | { estado: 'hablemos' }
  | { estado: 'banda'; bandName: string; monthlyPriceArs: number; cyclePriceArs: number };

const formateador = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

/**
 * odd/tasks/planes-y-cobros.md (T5): formulario de alta — nombre, colegio o
 * red, matrícula con calculadora en vivo, dominios (el propio bloqueado como
 * primero) y, para una red, sedes. Si la matrícula supera el umbral, el envío
 * del servidor vuelve con `reason: 'HABLEMOS'` y acá se cambia a
 * `LeadInstitucionForm` en vez de reintentar — nunca se decide "Hablemos" sólo
 * del lado del cliente (el umbral vive en `BillingSettings`, editable).
 */
export default function AltaInstitucionForm({ dominioPropio, alumnosPrefill, nombreContacto, emailContacto, trialEnabled, trialDays }: Props) {
  const [institutionName, setInstitutionName] = useState('');
  const [kind, setKind] = useState<'CAMPUS' | 'NETWORK'>('CAMPUS');
  const [declaredStudents, setDeclaredStudents] = useState(alumnosPrefill);
  const [extraDomains, setExtraDomains] = useState<string[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([{ name: '', domain: '' }]);
  const [precio, setPrecio] = useState<PrecioPreview>({ estado: 'idle' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hablemos, setHablemos] = useState(false);

  useEffect(() => {
    const n = Number(declaredStudents);
    if (!declaredStudents || !Number.isInteger(n) || n < 1) {
      setPrecio({ estado: 'idle' });
      return;
    }
    let cancelado = false;
    setPrecio({ estado: 'cargando' });
    const temporizador = setTimeout(async () => {
      const resultado = await apiRequest<
        | { kind: 'hablemos' }
        | { kind: 'band'; bandName: string; monthlyPriceArs: number; cyclePriceArs: number }
      >(`/api/instituciones/precio?alumnos=${n}`);
      if (cancelado) return;
      if (!resultado.ok) {
        setPrecio({ estado: 'error', mensaje: resultado.error });
        return;
      }
      setPrecio(
        resultado.data.kind === 'hablemos'
          ? { estado: 'hablemos' }
          : {
              estado: 'banda',
              bandName: resultado.data.bandName,
              monthlyPriceArs: resultado.data.monthlyPriceArs,
              cyclePriceArs: resultado.data.cyclePriceArs,
            },
      );
    }, 300);
    return () => {
      cancelado = true;
      clearTimeout(temporizador);
    };
  }, [declaredStudents]);

  function agregarDominio() {
    setExtraDomains((prev) => [...prev, '']);
  }
  function cambiarDominio(i: number, valor: string) {
    setExtraDomains((prev) => prev.map((d, idx) => (idx === i ? valor : d)));
  }
  function quitarDominio(i: number) {
    setExtraDomains((prev) => prev.filter((_, idx) => idx !== i));
  }

  function agregarSede() {
    setCampuses((prev) => [...prev, { name: '', domain: '' }]);
  }
  function cambiarSede(i: number, campo: 'name' | 'domain', valor: string) {
    setCampuses((prev) => prev.map((c, idx) => (idx === i ? { ...c, [campo]: valor } : c)));
  }
  function quitarSede(i: number) {
    setCampuses((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    // Fetch crudo (no `apiRequest`, que descarta todo campo que no sea
    // `error`): hace falta leer `reason` para distinguir "HABLEMOS" (cambia a
    // `LeadInstitucionForm`) de cualquier otro rechazo (se muestra tal cual).
    let payload: { ok: boolean; error?: string; reason?: string; redirect?: string };
    try {
      const response = await fetch('/api/instituciones/alta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          institutionName,
          kind,
          declaredStudents: Number(declaredStudents),
          extraDomains: extraDomains.filter((d) => d.trim()),
          campuses:
            kind === 'NETWORK'
              ? campuses.filter((c) => c.name.trim()).map((c) => ({ name: c.name, domain: c.domain.trim() || null }))
              : [],
        }),
      });
      payload = await response.json();
    } catch {
      setPending(false);
      setError('No se pudo contactar al servidor.');
      return;
    }

    setPending(false);
    if (!payload.ok) {
      if (payload.reason === 'HABLEMOS') {
        setHablemos(true);
        return;
      }
      setError(payload.error ?? 'No pudimos completar el alta.');
      return;
    }

    window.location.href = payload.redirect || '/org';
  }

  if (hablemos) {
    return (
      <div className="kodu-card p-6">
        <h2 className="font-display text-lg font-bold text-ink-900">Hablemos</h2>
        <p className="mt-2 text-sm text-ink-600">
          Tu matrícula supera nuestras bandas con precio fijo. Dejanos tus datos y te escribimos para
          armar una propuesta.
        </p>
        <div className="mt-5">
          <LeadInstitucionForm
            nombreInicial={nombreContacto}
            emailInicial={emailContacto}
            institucionInicial={institutionName}
            alumnosIniciales={Number(declaredStudents) || null}
          />
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="kodu-card space-y-6 p-6">
      <div>
        <label className="kodu-label" htmlFor="institution-name">Nombre de la institución</label>
        <input
          id="institution-name"
          className="kodu-input"
          required
          disabled={pending}
          value={institutionName}
          onChange={(e) => setInstitutionName(e.target.value)}
          placeholder="Colegio San Martín"
        />
      </div>

      <fieldset>
        <legend className="kodu-label">Tipo</legend>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input
              type="radio"
              name="kind"
              checked={kind === 'CAMPUS'}
              onChange={() => setKind('CAMPUS')}
              disabled={pending}
            />
            Colegio
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input
              type="radio"
              name="kind"
              checked={kind === 'NETWORK'}
              onChange={() => setKind('NETWORK')}
              disabled={pending}
            />
            Red de colegios
          </label>
        </div>
      </fieldset>

      <div>
        <label className="kodu-label" htmlFor="declared-students">
          Matrícula {kind === 'NETWORK' ? '(total de todas las sedes)' : ''}
        </label>
        <input
          id="declared-students"
          type="number"
          min={1}
          step={1}
          className="kodu-input"
          required
          disabled={pending}
          value={declaredStudents}
          onChange={(e) => setDeclaredStudents(e.target.value)}
        />
        <div className="mt-2 text-sm" role="status">
          {precio.estado === 'cargando' && <span className="text-ink-500">Calculando…</span>}
          {precio.estado === 'error' && <span className="text-red-600">{precio.mensaje}</span>}
          {precio.estado === 'hablemos' && (
            <span className="text-brand-600">Esa matrícula es "Hablemos" — más abajo te mostramos el contacto.</span>
          )}
          {precio.estado === 'banda' && (
            <span className="text-ink-700">
              Banda <strong>{precio.bandName}</strong>: {formateador.format(precio.monthlyPriceArs)}/mes o{' '}
              {formateador.format(precio.cyclePriceArs)} el ciclo lectivo completo.
            </span>
          )}
        </div>
      </div>

      <div>
        <span className="kodu-label">Dominios de mail</span>
        <p className="mb-2 text-xs text-ink-500">
          Cualquier docente que entre con uno de estos dominios se suma a tu institución.
        </p>
        <div className="space-y-2">
          <input className="kodu-input bg-sutil" value={dominioPropio} disabled readOnly />
          {extraDomains.map((dominio, i) => (
            <div key={i} className="flex gap-2">
              <input
                className="kodu-input"
                placeholder="otraesecuela.edu.ar"
                disabled={pending}
                value={dominio}
                onChange={(e) => cambiarDominio(i, e.target.value)}
              />
              <button
                type="button"
                className="kodu-btn kodu-btn-ghost"
                disabled={pending}
                onClick={() => quitarDominio(i)}
                aria-label="Quitar dominio"
              >
                Quitar
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="mt-2 text-sm text-brand-600 hover:underline" disabled={pending} onClick={agregarDominio}>
          + Agregar otro dominio
        </button>
        <p className="mt-2 text-xs text-ink-500">
          Los dominios extra quedan pendientes de revisión hasta que los confirmemos.
        </p>
      </div>

      {kind === 'NETWORK' && (
        <div>
          <span className="kodu-label">Sedes</span>
          <div className="space-y-3">
            {campuses.map((campus, i) => (
              <div key={i} className="flex flex-wrap gap-2 rounded-lg border border-linea p-3">
                <input
                  className="kodu-input flex-1"
                  placeholder="Nombre de la sede"
                  required
                  disabled={pending}
                  value={campus.name}
                  onChange={(e) => cambiarSede(i, 'name', e.target.value)}
                />
                <input
                  className="kodu-input flex-1"
                  placeholder="Dominio de la sede (opcional)"
                  disabled={pending}
                  value={campus.domain}
                  onChange={(e) => cambiarSede(i, 'domain', e.target.value)}
                />
                {campuses.length > 1 && (
                  <button
                    type="button"
                    className="kodu-btn kodu-btn-ghost"
                    disabled={pending}
                    onClick={() => quitarSede(i)}
                  >
                    Quitar sede
                  </button>
                )}
              </div>
            ))}
          </div>
          <button type="button" className="mt-2 text-sm text-brand-600 hover:underline" disabled={pending} onClick={agregarSede}>
            + Agregar sede
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <button type="submit" disabled={pending || precio.estado === 'hablemos'} className="kodu-btn kodu-btn-primary w-full">
        {pending ? 'Creando…' : trialEnabled ? `Empezar la prueba de ${trialDays} días` : 'Contratar'}
      </button>
    </form>
  );
}
