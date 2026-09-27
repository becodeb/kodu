import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

/**
 * odd/tasks/organizaciones.md (T3): mock de la API de Resend, sólo
 * `node:http` (mismo criterio que `e2e/mock-proveedor.ts`: este repo no
 * tiene test runner ni dependencias de mocking). Sirve únicamente
 * `POST /emails`, que es lo único que pega `src/lib/email/resend.ts`.
 *
 * Puerto por defecto 4791 — DISTINTO del 4790 de `mock-proveedor.ts`
 * (compartido entre varios e2e de este cambio): confirmar que está libre
 * con `ss -ltn` antes de correr, igual que documenta odd/tasks/organizaciones.md.
 */

export const PUERTO_POR_DEFECTO = 4791;

export interface LlamadaResend {
  recibidaEn: number;
  /** `undefined` si el pedido no mandó el header (nunca debería pasar). */
  authorization: string | undefined;
  body: { from?: string; to?: string; subject?: string; html?: string; text?: string };
}

export interface MockResend {
  url: string;
  puerto: number;
  /** Se va llenando en vivo, no hace falta esperar a `detener()`. */
  llamadas: LlamadaResend[];
  detener(): Promise<void>;
}

function leerCuerpo(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const trozos: Buffer[] = [];
    req.on('data', (trozo: Buffer) => trozos.push(trozo));
    req.on('end', () => resolve(Buffer.concat(trozos).toString('utf8')));
    req.on('error', reject);
  });
}

export async function iniciarMockResend(opciones: { puerto?: number } = {}): Promise<MockResend> {
  const puerto = opciones.puerto ?? PUERTO_POR_DEFECTO;
  const llamadas: LlamadaResend[] = [];

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/emails')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'mock-resend: ruta no encontrada' }));
      return;
    }

    leerCuerpo(req)
      .then((crudo) => {
        let body: LlamadaResend['body'] = {};
        try {
          body = crudo ? JSON.parse(crudo) : {};
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'mock-resend: body no es JSON válido' }));
          return;
        }

        llamadas.push({
          recibidaEn: Date.now(),
          authorization: req.headers.authorization,
          body,
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: `mock-email-${llamadas.length}` }));
      })
      .catch((error) => {
        console.error('[mock-resend] error atendiendo el pedido:', error);
        try {
          if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'mock-resend: error interno' }));
        } catch {
          /* la conexión ya se había cortado */
        }
      });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(puerto, '127.0.0.1', () => resolve());
  });

  return {
    url: `http://127.0.0.1:${puerto}`,
    puerto,
    llamadas,
    detener: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}
