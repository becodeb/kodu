import { useState } from 'react';
import { apiRequest } from '../../lib/client/api.ts';
import type { FilaUsuarioAdmin } from '../../lib/admin/usuarios.ts';

interface Props {
  initialUsuarios: FilaUsuarioAdmin[];
}

/**
 * La tabla de `/admin/usuarios` (design.md — "The users table";
 * specs/admin-users/spec.md).
 *
 * El menú de acciones reusa `[data-menu]` de `BaseLayout.astro:126` — un
 * `<details>` nativo, foco/apertura/cierre por teclado sin ninguna línea de
 * JS propia (ver el comentario que ya dejó M1 en ese script). Sólo hay dos
 * acciones hoy: "Hacer/Quitar administrador" y "Ver ficha". Los ítems de
 * habilitar/bloquear el acceso individual a la IA que describe design.md NO
 * están acá — esa columna (`aiAccessOverride`) todavía no existe, ver la
 * nota completa en `src/lib/admin/usuarios.ts`.
 */
export default function UsuariosTabla({ initialUsuarios }: Props) {
  const [usuarios, setUsuarios] = useState(initialUsuarios);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function alternarRol(usuario: FilaUsuarioAdmin) {
    setError(null);
    setPendingId(usuario.id);
    const nuevoRol = usuario.role === 'ADMIN' ? 'DOCENTE' : 'ADMIN';

    const result = await apiRequest<{ usuario: { id: string; role: 'DOCENTE' | 'ADMIN' } }>(
      `/api/admin/users/${usuario.id}`,
      'PATCH',
      { role: nuevoRol },
    );

    setPendingId(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setUsuarios((actuales) =>
      actuales.map((item) => (item.id === usuario.id ? { ...item, role: result.data.usuario.role } : item)),
    );
  }

  if (usuarios.length === 0) {
    return (
      <div className="kodu-card p-10 text-center text-sm text-ink-500">
        Todavía no hay ningún docente registrado.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="kodu-card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-linea text-xs text-ink-500 uppercase">
            <tr>
              <th className="px-4 py-3 font-medium">Docente</th>
              <th className="px-4 py-3 font-medium">Rol</th>
              <th className="px-4 py-3 font-medium">Acceso a la IA</th>
              <th className="px-4 py-3 text-right font-medium">Recursos</th>
              <th className="px-4 py-3 text-right font-medium">Tokens</th>
              <th className="px-4 py-3 text-right font-medium">USD</th>
              <th className="px-4 py-3 font-medium">Última actividad</th>
              <th className="px-4 py-3">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((usuario) => (
              <tr key={usuario.id} className="border-b border-linea last:border-0">
                <td className="px-4 py-3">
                  <a
                    href={`/admin/usuarios/${usuario.id}`}
                    className="block font-medium text-ink-900 hover:text-brand-600"
                  >
                    {usuario.name}
                  </a>
                  <span className="flex items-center gap-1.5 text-xs text-ink-500">
                    {usuario.email}
                    {usuario.esGoogle && (
                      <span
                        title="Inició sesión con Google"
                        aria-label="Cuenta de Google"
                        className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-linea text-[9px] leading-none text-ink-500"
                      >
                        G
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-3 text-ink-700">{usuario.role === 'ADMIN' ? 'Admin' : 'Docente'}</td>
                <td className="px-4 py-3 text-ink-700">{usuario.accesoIa}</td>
                <td className="px-4 py-3 text-right tabular-nums text-ink-700">{usuario.proyectos}</td>
                <td className="px-4 py-3 text-right tabular-nums text-ink-700">
                  {usuario.tokens.toLocaleString('es-AR')}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-ink-900">{usuario.costoDisplay}</td>
                <td className="px-4 py-3 text-ink-500">{usuario.ultimaActividad}</td>
                <td className="px-4 py-3 text-right">
                  <details className="relative inline-block text-left" data-menu>
                    <summary
                      className="cursor-pointer list-none rounded-md px-2 py-1 text-ink-500 hover:bg-sutil"
                      aria-label={`Acciones para ${usuario.name}`}
                    >
                      ⋯
                    </summary>
                    <div className="kodu-card absolute right-0 z-50 mt-1 w-52 overflow-hidden p-1 shadow-lg">
                      <button
                        type="button"
                        disabled={pendingId === usuario.id}
                        onClick={() => void alternarRol(usuario)}
                        className="block w-full rounded-md px-3 py-2 text-left text-ink-700 hover:bg-sutil disabled:opacity-50"
                      >
                        {usuario.role === 'ADMIN' ? 'Quitar administrador' : 'Hacer administrador'}
                      </button>
                      <a
                        href={`/admin/usuarios/${usuario.id}`}
                        className="block rounded-md px-3 py-2 text-ink-700 hover:bg-sutil"
                      >
                        Ver ficha
                      </a>
                    </div>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
