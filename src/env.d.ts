/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** Sesion resuelta por src/middleware.ts en cada request (null si es anonimo). */
    user: import('./lib/auth/session.ts').SessionUser | null;
    /**
     * false cuando la lectura de identidad en base falló y se usó el JWT
     * degradado (ver src/middleware.ts). Las rutas de solo lectura toleran un
     * dato viejo; las mutaciones de /api/admin no.
     */
    identityFresh: boolean;
  }
}
