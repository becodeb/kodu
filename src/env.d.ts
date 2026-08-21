/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** Sesion resuelta por src/middleware.ts en cada request (null si es anonimo). */
    user: import('./lib/auth/session.ts').SessionUser | null;
  }
}
