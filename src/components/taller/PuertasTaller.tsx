import { useState, type ReactNode } from 'react';
import { apiRequest } from '../../lib/client/api.ts';
import type { ModoTaller } from '../../lib/taller/prompt.ts';

/**
 * Las dos puertas del Taller de ideas (odd/tasks/taller-de-ideas.md).
 *
 * Antes cada puerta explicaba en un párrafo para quién era, y en la página
 * pasaban de largo: dos cajas de texto iguales al fondo. Ahora cada una cuenta
 * lo que pasa con un dibujo (un tema que se abre en ideas; una idea que se
 * vuelve una lista completa) y una sola frase. Toda la tarjeta es el botón.
 */

function FlechaRedonda({ cargando }: { cargando: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="grid h-13 w-13 shrink-0 place-items-center rounded-full bg-brand-600 text-white transition-[filter] group-hover:brightness-110"
    >
      {cargando ? (
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
      ) : (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      )}
    </span>
  );
}

/** Una tarjetita de idea en el dibujo: título y una línea de texto, en barras. */
function TarjetaIdea({ clase, destacada = false }: { clase: string; destacada?: boolean }) {
  return (
    <span
      className={`kodu-elev absolute h-[72px] w-[110px] rounded-xl bg-superficie ${
        destacada ? 'border-2 border-brand-600' : 'border border-linea'
      } ${clase}`}
    >
      <span className={`mx-3.5 mt-3.5 mb-2 block h-2 rounded ${destacada ? 'w-[65%] bg-brand-600' : 'w-[55%] bg-brand-300'}`} />
      <span className="mx-3.5 block h-1.5 w-[75%] rounded bg-linea" />
    </span>
  );
}

/** "Tengo el tema": un tema que se abre en tres ideas para elegir. */
function DibujoTema() {
  return (
    <>
      <span className="absolute top-[88px] left-[16px] rounded-full bg-brand-600 px-4 py-2.5 text-[15px] font-bold whitespace-nowrap text-white">
        Fracciones · 4.º
      </span>
      <span className="absolute top-[106px] left-[180px] h-0.5 w-9 bg-brand-300" />
      <TarjetaIdea clase="top-[44px] left-[232px] -rotate-[9deg]" />
      <TarjetaIdea clase="top-[86px] left-[258px]" />
      <TarjetaIdea clase="top-[128px] left-[284px] rotate-[8deg]" destacada />
    </>
  );
}

/** "Ya tengo la idea": una idea suelta que se vuelve una lista completa. */
function DibujoIdea() {
  return (
    <>
      <span className="kodu-elev absolute top-[64px] left-[16px] flex w-[150px] items-center gap-2.5 rounded-[18px] rounded-bl-[4px] border border-linea bg-superficie p-3.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-brand-600 text-white">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />
          </svg>
        </span>
        <span className="flex-1">
          <span className="mb-2 block h-[7px] rounded bg-brand-300" />
          <span className="block h-1.5 w-[70%] rounded bg-linea" />
        </span>
      </span>
      <span className="absolute top-[100px] left-[178px] text-brand-300">
        <svg width="40" height="24" viewBox="0 0 40 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12h34M28 4l8 8-8 8" />
        </svg>
      </span>
      <span className="kodu-elev absolute top-[48px] left-[232px] flex w-[160px] flex-col gap-3 rounded-2xl border-2 border-brand-600 bg-superficie p-4">
        {['w-[90px]', 'w-[70px]', 'w-[96px]'].map((ancho) => (
          <span key={ancho} className="flex items-center gap-2.5">
            <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md bg-brand-600 text-white">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m5 12 5 5 9-10" />
              </svg>
            </span>
            <span className={`block h-[7px] rounded bg-linea ${ancho}`} />
          </span>
        ))}
      </span>
    </>
  );
}

const PUERTAS: Array<{ modo: ModoTaller; titulo: string; frase: string; dibujo: ReactNode }> = [
  { modo: 'TOPIC', titulo: 'Tengo el tema', frase: 'Kodu te propone ideas para elegir.', dibujo: <DibujoTema /> },
  { modo: 'IDEA', titulo: 'Ya tengo la idea', frase: 'La completan juntos, con detalle.', dibujo: <DibujoIdea /> },
];

export default function PuertasTaller(props: { mostrarAtajo?: boolean }) {
  const [pendiente, setPendiente] = useState<ModoTaller | 'directo' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function entrar(modo: ModoTaller) {
    setPendiente(modo);
    setError(null);
    const resultado = await apiRequest<{ redirect: string }>('/api/taller', 'POST', { mode: modo });
    if (!resultado.ok) {
      setError(resultado.error);
      setPendiente(null);
      return;
    }
    window.location.href = resultado.data.redirect;
  }

  async function directo() {
    setPendiente('directo');
    setError(null);
    const resultado = await apiRequest<{ redirect: string }>('/api/projects', 'POST', { title: 'Nuevo Recurso' });
    if (!resultado.ok) {
      setError(resultado.error);
      setPendiente(null);
      return;
    }
    window.location.href = resultado.data.redirect;
  }

  return (
    <div>
      <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
        {PUERTAS.map((puerta) => (
          <button
            key={puerta.modo}
            type="button"
            onClick={() => void entrar(puerta.modo)}
            disabled={pendiente !== null}
            className="kodu-card kodu-elev kodu-alza group flex flex-col overflow-hidden rounded-3xl text-left disabled:opacity-70"
          >
            {/* El dibujo mide 410px de ancho: centrado, y achicado donde la
                tarjeta es más angosta (celular, y las dos columnas de una
                tablet) para que nunca se corte por los costados. */}
            <span aria-hidden="true" className="relative block h-[220px] overflow-hidden bg-brand-50">
              <span className="absolute top-0 left-1/2 block h-full w-[410px] -translate-x-1/2 max-sm:scale-[0.8] md:max-lg:scale-[0.85]">
                {puerta.dibujo}
              </span>
            </span>
            <span className="flex items-center gap-4 px-6 pt-6 pb-7 sm:px-7">
              <span className="flex flex-1 flex-col gap-1">
                <span className="font-display text-2xl text-ink-900">{puerta.titulo}</span>
                <span className="text-base text-ink-500">{puerta.frase}</span>
              </span>
              <FlechaRedonda cargando={pendiente === puerta.modo} />
            </span>
          </button>
        ))}
      </div>

      {props.mostrarAtajo && (
        <p className="mt-6 text-center text-[15px] text-ink-500">
          ¿Ya sabés exactamente qué pedir?{' '}
          <button
            type="button"
            onClick={() => void directo()}
            disabled={pendiente !== null}
            className="font-semibold text-brand-600 underline-offset-2 hover:underline disabled:opacity-60"
          >
            {pendiente === 'directo' ? 'Creando…' : 'Crear directo'}
          </button>
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 text-center text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
