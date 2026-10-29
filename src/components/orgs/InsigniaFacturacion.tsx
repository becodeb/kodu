/**
 * odd/tasks/org-admin-facturacion.md: la marca "este admin gestiona la
 * facturación de la institución". Una sola pieza para la lista de docentes
 * (`MiembrosLista`), la de admins de la red (`AdminsRed`) y el detalle del
 * superadmin, así se ve igual en las tres.
 *
 * `compacta`: versión mínima para ir pegada al nombre en la lista de docentes,
 * donde la jerarquía la lleva el nombre y no la etiqueta.
 */
export default function InsigniaFacturacion({ compacta = false }: { compacta?: boolean }) {
  return (
    <span
      title="Ve y gestiona el plan y la facturación de la institución"
      className={
        compacta
          ? 'shrink-0 rounded border border-linea px-1 text-[10px] leading-4 font-medium text-ink-500'
          : 'shrink-0 rounded-full border border-brand-300 bg-sutil px-2 py-0.5 text-xs font-medium text-brand-700'
      }
    >
      Facturación
    </span>
  );
}
