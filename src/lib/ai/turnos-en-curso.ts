/**
 * T4 (odd/tasks/generacion-simple-y-reanudable.md): registro en memoria de
 * los turnos que ESTE proceso de Node está, ahora mismo, pidiéndole a un
 * motor de IA — uno por hilo (nunca más de uno de verdad: nada impide hoy
 * que dos turnos arranquen en el mismo hilo casi juntos, ver la nota de
 * "concurrencia" en stream.ts; un registro nuevo simplemente reemplaza al
 * anterior, mismo criterio que ya vale para todo lo demás en ese caso).
 *
 * Sirve para una sola cosa: que `/api/chat/cancel` (el botón "Detener")
 * pueda cortar la llamada al proveedor DE VERDAD, del lado del servidor.
 * Antes, lo único que frenaba la generación era `request.signal` — la
 * conexión del navegador — que a partir de T4 ya no se usa para esto
 * (cerrar la pestaña ya no tiene que frenar nada).
 *
 * Asunción de un solo proceso (design.md, Coolify: un solo contenedor):
 * esto vive en memoria de ESTE proceso. Un deploy/reinicio pierde el
 * registro entero junto con cualquier turno en curso — documentado como
 * fuera de alcance en la tarea (el poll de 30 minutos del cliente termina
 * solo y el docente puede volver a mandar el pedido).
 */

export type MotivoAbortTurno = 'stop' | 'timeout';

interface TurnoRegistrado {
  abortar(motivo: MotivoAbortTurno): void;
}

const registro = new Map<string, TurnoRegistrado>();

/**
 * `stream.ts` llama esto apenas arranca a pedirle algo a un motor.
 * Devuelve la función de baja: sólo saca el registro si sigue siendo ESTE
 * turno el registrado (nunca pisa el registro de uno más nuevo que haya
 * arrancado mientras tanto en el mismo hilo).
 */
export function registrarTurnoEnCurso(threadId: string, turno: TurnoRegistrado): () => void {
  registro.set(threadId, turno);
  return () => {
    if (registro.get(threadId) === turno) registro.delete(threadId);
  };
}

/**
 * `/api/chat/cancel`: si hay un turno registrado para este hilo, lo aborta
 * (motivo `'stop'`) y devuelve `true`. `false` = no había nada corriendo del
 * lado del servidor (el turno ya había terminado, o el pedido todavía no
 * había llegado a registrarse) — la ruta ya sabe tratar ese caso igual que
 * antes de T4.
 */
export function cancelarTurnoEnCurso(threadId: string): boolean {
  const turno = registro.get(threadId);
  if (!turno) return false;
  turno.abortar('stop');
  return true;
}
