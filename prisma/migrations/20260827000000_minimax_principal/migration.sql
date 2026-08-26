-- Alpha dejo de ser gratuito y sale de servicio. MiniMax M3 pasa a ser el motor
-- principal. El valor ALPHA se conserva en el enum porque hay consumo historico
-- en TokenUsage que lo referencia, pero ya no se ofrece ni se resuelve.
ALTER TABLE "Project" ALTER COLUMN "selectedModel" SET DEFAULT 'MINIMAX';
UPDATE "Project" SET "selectedModel" = 'MINIMAX' WHERE "selectedModel" = 'ALPHA';
