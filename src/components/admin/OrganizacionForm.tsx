import { useId, useState, type FormEvent } from 'react';
import Modal from '../workspace/Modal.tsx';
import { apiRequest } from '../../lib/client/api.ts';
import type { OrganizacionResumen } from '../../lib/orgs/gestion.ts';

/**
 * Alta de una organización (odd/tasks/organizaciones.md T6): colegio
 * standalone, red, o sede DENTRO de una red — las tres son la misma llamada
 * (`POST /api/admin/organizaciones`), lo único que cambia es `kind` y
 * `parentId`. Mismo patrón que `ProveedorForm.tsx` (Modal + `apiRequest`).
 *
 * Simplificación deliberada sobre el reparto de la tarea ("alta de colegio,
 * red y sede" como tres puntos): un solo formulario con un selector de tipo
 * cubre los tres casos sin triplicar el modal — "sede de una red" es
 * simplemente "colegio" + una red elegida. Cuando se abre desde el botón
 * "+ Agregar sede" de una red puntual, esa red viene fija y no se puede
 * cambiar.
 */

interface OrganizacionFormProps {
  /** Fijo, no hay selector en el form: los botones de arriba ya distinguen la intención ("+ Nueva red" / "+ Nuevo colegio"). */
  kind: 'CAMPUS' | 'NETWORK';
  redesDisponibles: OrganizacionResumen[];
  /** Si viene, el formulario nace en modo CAMPUS con esta red fija (no se puede tocar). */
  redFija?: { id: string; name: string } | null;
  onGuardado: (organizacion: OrganizacionResumen) => void;
  onCerrar: () => void;
}

export default function OrganizacionForm(props: OrganizacionFormProps) {
  const idBase = useId();
  const kind = props.kind;
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState(props.redFija?.id ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Falta el nombre.');
      return;
    }

    setPending(true);
    const result = await apiRequest<{ organizacion: OrganizacionResumen }>('/api/admin/organizaciones', 'POST', {
      name: name.trim(),
      kind,
      parentId: kind === 'CAMPUS' && parentId ? parentId : null,
    });
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    props.onGuardado(result.data.organizacion);
  }

  const titulo = props.redFija
    ? `Nueva sede de ${props.redFija.name}`
    : kind === 'NETWORK'
      ? 'Nueva red'
      : 'Nuevo colegio';

  return (
    <Modal
      abierto
      titulo={titulo}
      onCerrar={props.onCerrar}
      pie={
        <>
          <button type="button" onClick={props.onCerrar} className="kodu-btn-ghost text-sm">
            Cancelar
          </button>
          <button type="submit" form={`${idBase}-form`} disabled={pending} className="kodu-btn-primary text-sm">
            {pending ? 'Creando…' : 'Crear'}
          </button>
        </>
      }
    >
      <form id={`${idBase}-form`} onSubmit={submit} className="space-y-4">
        <div>
          <label className="kodu-label" htmlFor={`${idBase}-name`}>
            Nombre
          </label>
          <input
            id={`${idBase}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={kind === 'NETWORK' ? 'Red Educativa del Sur' : 'Instituto San Martín'}
            className="kodu-input"
            required
          />
        </div>

        {kind === 'CAMPUS' &&
          (props.redFija ? (
            <p className="text-sm text-ink-500">
              Va a ser una sede de <span className="font-medium text-ink-700">{props.redFija.name}</span>.
            </p>
          ) : props.redesDisponibles.length > 0 ? (
            <div>
              <label className="kodu-label" htmlFor={`${idBase}-parent`}>
                Pertenece a una red (opcional)
              </label>
              <select
                id={`${idBase}-parent`}
                value={parentId}
                onChange={(event) => setParentId(event.target.value)}
                className="kodu-input"
              >
                <option value="">Standalone (no pertenece a ninguna red)</option>
                {props.redesDisponibles.map((red) => (
                  <option key={red.id} value={red.id} disabled={red.archivada}>
                    {red.name}
                    {red.archivada ? ' (archivada)' : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : null)}

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
