import { useState, type FormEvent } from 'react';
import { apiRequest } from '../lib/client/api.ts';

export interface Rule {
  id: string;
  title: string;
  content: string;
  isGlobal: boolean;
  isActive: boolean;
}

interface RulesManagerProps {
  initialRules: Rule[];
  isAdmin: boolean;
}

/**
 * Panel de reglas y contexto (README §3).
 *
 * El docente crea, edita y prende/apaga sus directivas; el ADMIN además maneja
 * las reglas institucionales que se le inyectan a todos.
 */
export default function RulesManager({ initialRules, isAdmin }: RulesManagerProps) {
  const [rules, setRules] = useState(initialRules);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [asGlobal, setAsGlobal] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mine = rules.filter((rule) => !rule.isGlobal);
  const global = rules.filter((rule) => rule.isGlobal);

  async function create(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const result = await apiRequest<{ rule: Rule }>('/api/rules', 'POST', {
      title,
      content,
      isGlobal: asGlobal,
    });
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setRules((current) => [...current, result.data.rule]);
    setTitle('');
    setContent('');
    setAsGlobal(false);
  }

  async function toggle(rule: Rule) {
    const next = !rule.isActive;
    setRules((current) =>
      current.map((item) => (item.id === rule.id ? { ...item, isActive: next } : item)),
    );

    const result = await apiRequest(`/api/rules/${rule.id}`, 'PATCH', { isActive: next });
    if (!result.ok) {
      // Revertimos el optimismo si el servidor dijo que no.
      setRules((current) =>
        current.map((item) => (item.id === rule.id ? { ...item, isActive: rule.isActive } : item)),
      );
      setError(result.error);
    }
  }

  async function remove(rule: Rule) {
    if (!window.confirm(`¿Borrar la regla "${rule.title}"?`)) return;

    const result = await apiRequest(`/api/rules/${rule.id}`, 'DELETE');
    if (result.ok) setRules((current) => current.filter((item) => item.id !== rule.id));
    else setError(result.error);
  }

  async function saveContent(rule: Rule, nextContent: string) {
    if (nextContent === rule.content) return;

    setRules((current) =>
      current.map((item) => (item.id === rule.id ? { ...item, content: nextContent } : item)),
    );

    const result = await apiRequest(`/api/rules/${rule.id}`, 'PATCH', { content: nextContent });
    if (!result.ok) setError(result.error);
  }

  function renderRule(rule: Rule, editable: boolean) {
    return (
      <li key={rule.id} className="kodu-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-medium text-ink-900">{rule.title}</h3>
            <p className="text-xs text-ink-500">
              {rule.isGlobal ? 'Institucional · se aplica a todos' : 'Personal'}
            </p>
          </div>

          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-ink-700">
            <input
              type="checkbox"
              checked={rule.isActive}
              disabled={!editable}
              onChange={() => void toggle(rule)}
              className="h-4 w-4 accent-brand-600"
            />
            {rule.isActive ? 'Activa' : 'Apagada'}
          </label>
        </div>

        {editable ? (
          <textarea
            defaultValue={rule.content}
            rows={3}
            onBlur={(event) => void saveContent(rule, event.target.value.trim())}
            className="kodu-input mt-2 resize-y text-sm"
          />
        ) : (
          <p className="mt-2 text-sm whitespace-pre-wrap text-ink-700">{rule.content}</p>
        )}

        {editable && (
          <button
            type="button"
            onClick={() => void remove(rule)}
            className="mt-2 text-xs text-ink-500 underline hover:text-red-600"
          >
            Borrar
          </button>
        )}
      </li>
    );
  }

  return (
    <div className="space-y-8">
      <form onSubmit={create} className="kodu-card space-y-3 p-4">
        <h2 className="font-semibold text-ink-900">Nueva regla</h2>

        <div>
          <label className="kodu-label" htmlFor="rule-title">
            Título
          </label>
          <input
            id="rule-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            minLength={2}
            maxLength={120}
            placeholder="Ej.: Paleta accesible para primaria"
            className="kodu-input"
          />
        </div>

        <div>
          <label className="kodu-label" htmlFor="rule-content">
            Directiva para la IA
          </label>
          <textarea
            id="rule-content"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            required
            minLength={5}
            rows={3}
            placeholder="Ej.: Usar siempre colores de alto contraste y tipografía grande, pensando en primer ciclo."
            className="kodu-input resize-y"
          />
        </div>

        {isAdmin && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              checked={asGlobal}
              onChange={(event) => setAsGlobal(event.target.checked)}
              className="h-4 w-4 accent-brand-600"
            />
            Crear como regla institucional (se aplica a todos los docentes)
          </label>
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <button type="submit" disabled={pending} className="kodu-btn-primary">
          {pending ? 'Guardando…' : 'Agregar regla'}
        </button>
      </form>

      <section>
        <h2 className="mb-3 font-semibold text-ink-900">Mis reglas ({mine.length})</h2>
        {mine.length === 0 ? (
          <p className="text-sm text-ink-500">
            Todavía no tenés reglas propias. Las que agregues se suman al contexto de todas tus
            conversaciones.
          </p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">{mine.map((rule) => renderRule(rule, true))}</ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-semibold text-ink-900">Reglas institucionales ({global.length})</h2>
        <p className="mb-3 text-sm text-ink-500">
          {isAdmin
            ? 'Las editás vos como administrador; se inyectan en todas las conversaciones de la red.'
            : 'Las define el equipo administrador y se aplican siempre. Las ves para saber con qué criterios trabaja la IA.'}
        </p>
        <ul className="grid gap-3 md:grid-cols-2">
          {global.map((rule) => renderRule(rule, isAdmin))}
        </ul>
      </section>
    </div>
  );
}
