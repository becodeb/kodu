import assert from 'node:assert/strict';
import { aAnthropicMessages, type ChatMessage } from '../src/lib/ai/provider.ts';

/**
 * T7 (motor-claude, nota "cross-model"): confirma que la traducción de
 * historial al dialecto Anthropic (`aAnthropicMessages`, exportada sólo
 * para esta prueba) nunca produce un bloque `thinking` — ni siquiera
 * cuando el historial trae un turno `assistant` con texto Y un tool call,
 * la combinación real de cada turno de este producto. Esto es lo que hace
 * seguro cambiar de modelo entre turnos bajo un modo de generación (T7):
 * ningún bloque de razonamiento de OTRO modelo puede reenviarse, porque
 * nunca llega a existir en el historial que se manda.
 *
 * Ejecutar con: npx tsx e2e/unidad-mensajes-anthropic.ts
 */

let fallas = 0;

function prueba(nombre: string, fn: () => void): void {
  try {
    fn();
    console.log(`✔ ${nombre}`);
  } catch (error) {
    fallas++;
    console.error(`✖ ${nombre}`);
    console.error(`  ${(error as Error).message}`);
  }
}

function tiposDeBloques(mensajes: ReturnType<typeof aAnthropicMessages>['messages']): string[] {
  return mensajes.flatMap((mensaje) =>
    Array.isArray(mensaje.content) ? mensaje.content.map((bloque) => (bloque as { type: string }).type) : [typeof mensaje.content],
  );
}

prueba('un turno assistant con texto Y tool_use nunca produce un bloque "thinking"', () => {
  const historial: ChatMessage[] = [
    { role: 'system', content: 'Sos el motor de KoduEdu.' },
    { role: 'user', content: 'Creá un recurso sobre el ciclo del agua.' },
    {
      role: 'assistant',
      content: 'Listo, acá va.',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'update_resource_code', arguments: '{"html":"<p>agua</p>"}' } }],
    },
  ];

  const { messages } = aAnthropicMessages(historial);
  const tipos = tiposDeBloques(messages);
  assert.ok(tipos.includes('tool_use'), 'el tool call sí tiene que traducirse');
  assert.ok(tipos.includes('text'), 'el texto del turno sí tiene que traducirse');
  assert.ok(!tipos.includes('thinking'), 'ChatMessage no tiene ningún campo para guardar razonamiento — nunca puede aparecer acá');
});

prueba('varios turnos assistant consecutivos (ej. después de cambiar de modo/modelo): ninguno trae "thinking"', () => {
  const historial: ChatMessage[] = [
    { role: 'user', content: 'Agregá una pregunta más.' },
    { role: 'assistant', content: 'Hecho con Sonnet.' },
    { role: 'user', content: 'Ahora hacelo más grande.' },
    { role: 'assistant', content: 'Hecho con Haiku (el modo bajó a base).' },
  ];

  const { messages } = aAnthropicMessages(historial);
  const tipos = tiposDeBloques(messages);
  assert.ok(!tipos.includes('thinking'));
});

if (fallas > 0) {
  console.error(`\n${fallas} prueba(s) fallaron.`);
  process.exit(1);
}
console.log('\nTodo OK.');
