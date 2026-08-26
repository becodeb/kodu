-- DeepSeek deja de ofrecerse a todos: es el motor pago, asi que queda oculto
-- salvo que un admin lo habilite para un docente puntual.
ALTER TABLE "User" ADD COLUMN "deepseekEnabled" BOOLEAN NOT NULL DEFAULT false;
