import { useState } from 'react';
import Interruptor from './Interruptor.tsx';
import { apiRequest } from '../../lib/client/api.ts';

interface Props {
  userId: string;
  initialPrimeAccess: boolean;
}

/**
 * Interruptor de "Acceso prime" en la ficha de un docente (T5,
 * odd/tasks/modo-prime.md — "cuentas que un admin marque").
 *
 * Vive en su propia isla, junto al control de acceso a la IA que ya existe
 * en el encabezado de la ficha (`usuarios/[id].astro`), porque ahí es donde
 * el dueño pidió poder marcar cuentas una por una. `/admin/generacion`
 * (GeneracionPanel.tsx) sólo lista el resultado y ofrece desmarcar — este es
 * el punto de alta.
 */
export default function AccesoPrimeSwitch({ userId, initialPrimeAccess }: Props) {
  const [primeAccess, setPrimeAccess] = useState(initialPrimeAccess);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function alternar(valor: boolean) {
    setError(null);
    setPending(true);
    const anterior = primeAccess;
    setPrimeAccess(valor);

    const result = await apiRequest<{ usuario: { primeAccess: boolean } }>(`/api/admin/users/${userId}`, 'PATCH', {
      primeAccess: valor,
    });

    setPending(false);
    if (!result.ok) {
      setPrimeAccess(anterior);
      setError(result.error);
      return;
    }
    setPrimeAccess(result.data.usuario.primeAccess);
  }

  return (
    <div className="flex items-center gap-3">
      <div className="rounded-lg border border-linea bg-sutil px-3 py-1.5">
        <Interruptor
          id="acceso-prime"
          checked={primeAccess}
          disabled={pending}
          onChange={(valor) => void alternar(valor)}
          label="Acceso prime"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
