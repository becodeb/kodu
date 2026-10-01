import { Prisma } from '../../generated/prisma/client.ts';
import type { PeakWindow, PriceSchedule } from './pricing.ts';

/**
 * odd/tasks/ahorro-tokens.md (T7): model presets defined in CODE, not in the
 * database. `AiModel.presetKey` (nullable) links a row to one of these — when
 * set, `catalogo.ts#construirConfig` reads pricing/schedule/holidays from
 * HERE at call time instead of from the model's own DB columns, so a price
 * change here updates every linked model at once ("si cambian los precios te
 * aviso y actualizás el preset" — the owner's own words). `presetKey: null`
 * ("Personalizado" in `/admin/motores`) keeps today's behavior: the DB
 * columns are the only source of truth.
 *
 * `providerModel`/`displayName`/`reasoningEffort`/`reasoningParam`/
 * `maxOutputTokens`/the provider's `baseUrl`/`apiFormat` are preset-owned
 * too, but only at the moment a model is CREATED or re-linked to a preset
 * from `/admin/motores` — they get copied into the normal `AiModel`/
 * `AiProvider` columns then (so the rest of the app, which reads those
 * columns everywhere, never needs to know a preset exists) and stay there
 * until the admin re-applies the preset. Only pricing/schedule/holidays are
 * read from this module on EVERY call — that is the one thing the owner
 * explicitly wants to update centrally without touching every row.
 */

export interface ModelPreset {
  /** Stable key, stored verbatim in `AiModel.presetKey`. */
  key: string;
  /** What the admin sees in the `/admin/motores` preset selector. */
  label: string;
  /** The provider account this preset expects — `/admin/motores` uses this
   *  to find-or-create the matching `AiProvider` row (never duplicates one
   *  for the same `baseUrl`/`apiFormat`). */
  provider: {
    baseUrl: string;
    apiFormat: 'chat' | 'responses';
  };
  /** The exact string the provider's API expects as the model id. */
  providerModel: string;
  /** PEAK prices (USD per million tokens) — the schedule's `offPeakFactor`
   *  (when present) discounts these at call time, same as any other model. */
  prices: {
    inputPerMToken: number;
    cachedInputPerMToken: number;
    outputPerMToken: number;
  };
  reasoning: {
    /** `null` = this provider dialect doesn't take a reasoning parameter. */
    param: 'reasoning_effort' | 'thinking' | null;
    /** The level a brand-new model gets when linked to this preset. */
    defaultEffort: string;
  };
  maxOutputTokens: number;
  /** `null` = no time-of-day discount (flat `prices` always apply), same
   *  convention as `AiModel.priceOffPeakFactor` being unset. */
  schedule: PriceSchedule | null;
  /** When the prices above were last checked against the provider's own
   *  pricing page, and where — shown in `/admin/motores` next to the
   *  preset-owned fields ("Valores del preset (verificados el …)"). */
  pricesVerifiedAt: string;
  sourceUrl: string;
}

/**
 * DeepSeek's official peak windows, UTC, Monday to Friday — ver
 * api-docs.deepseek.com/quick_start/pricing (leído 2026-10-01, T1). Every
 * other hour (including weekends and the holidays below) is off-peak at half
 * price (`offPeakFactor: 0.5`).
 */
const VENTANAS_PICO_DEEPSEEK: PeakWindow[] = [1, 2, 3, 4, 5].flatMap((weekday) => [
  { weekday, startHour: 1, endHour: 4 },
  { weekday, startHour: 6, endHour: 10 },
]);

/**
 * 2026 Chinese public holidays (State Council notice 国办发明电〔2025〕7号,
 * published 2025-11-04), every day of each holiday fully off-peak — T7's
 * verified source for this list, not invented. DeepSeek's pricing page only
 * says weekends are off-peak; it does not explicitly confirm these holidays
 * follow the same rule, so this is a reasonable inference from "excluding
 * Chinese public holidays" in the official pricing text (see `pricing.ts`
 * T1 comment), not a second independently verified fact.
 *
 * The make-up workdays the same notice moves to a Saturday/Sunday (01-04,
 * 02-14, 02-28, 05-09, 09-20, 10-10) are NOT listed here: they are weekends,
 * already off-peak by `isOffPeak`'s weekday check — listing them again would
 * be redundant, not wrong.
 *
 * These are China-local calendar dates, but every peak window above falls
 * within the SAME UTC date (01:00-04:00 and 06:00-10:00 UTC is 09:00-12:00
 * and 14:00-18:00 China time, both inside China's business day) — so a
 * plain UTC date comparison against this list is correct, with no timezone
 * conversion needed.
 */
const FERIADOS_DEEPSEEK_2026: string[] = [
  '2026-01-01', '2026-01-02', '2026-01-03',
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  '2026-06-19', '2026-06-20', '2026-06-21',
  '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
];

const ESQUEMA_DEEPSEEK: PriceSchedule = {
  offPeakFactor: new Prisma.Decimal(0.5),
  peakWindows: VENTANAS_PICO_DEEPSEEK,
  offPeakDates: FERIADOS_DEEPSEEK_2026,
};

const FUENTE_DEEPSEEK = 'https://api-docs.deepseek.com/quick_start/pricing';

const DEEPSEEK_FLASH: ModelPreset = {
  key: 'deepseek-flash',
  label: 'DeepSeek Flash (DeepSeek-V4.1-Flash)',
  provider: { baseUrl: 'https://api.deepseek.com', apiFormat: 'chat' },
  providerModel: 'deepseek-flash',
  prices: { inputPerMToken: 0.3, cachedInputPerMToken: 0.006, outputPerMToken: 1.2 },
  reasoning: { param: 'reasoning_effort', defaultEffort: 'low' },
  // DeepSeek allows up to 384K; kept at 131072 because that's what
  // production uses today (see the `AiModel.maxOutputTokens` column
  // comment) — not a provider limit.
  maxOutputTokens: 131_072,
  schedule: ESQUEMA_DEEPSEEK,
  pricesVerifiedAt: '2026-10-01',
  sourceUrl: FUENTE_DEEPSEEK,
};

const DEEPSEEK_V4_PRO: ModelPreset = {
  key: 'deepseek-v4-pro',
  label: 'DeepSeek V4 Pro',
  provider: { baseUrl: 'https://api.deepseek.com', apiFormat: 'chat' },
  providerModel: 'deepseek-v4-pro',
  prices: { inputPerMToken: 1.32, cachedInputPerMToken: 0.044, outputPerMToken: 3.96 },
  reasoning: { param: 'reasoning_effort', defaultEffort: 'low' },
  maxOutputTokens: 131_072,
  schedule: ESQUEMA_DEEPSEEK,
  pricesVerifiedAt: '2026-10-01',
  sourceUrl: FUENTE_DEEPSEEK,
};

const OPENAI_GPT_6_LUNA: ModelPreset = {
  key: 'openai-gpt-6-luna',
  label: 'OpenAI GPT-6 Luna',
  provider: { baseUrl: 'https://api.openai.com/v1', apiFormat: 'responses' },
  providerModel: 'gpt-6-luna',
  // Short-context rates (developers.openai.com/api/docs/pricing). OpenAI
  // bills INPUT at 2x above 272K input tokens for this model — not modeled
  // here, same as the task asked: this preset always uses the short-context
  // price, whatever the actual prompt length.
  prices: { inputPerMToken: 0.1, cachedInputPerMToken: 0.01, outputPerMToken: 0.5 },
  // Verifier use (T3, odd/tasks/verificador.md): "medium" by default.
  reasoning: { param: 'reasoning_effort', defaultEffort: 'medium' },
  maxOutputTokens: 131_072,
  schedule: null,
  pricesVerifiedAt: '2026-10-01',
  sourceUrl: 'https://developers.openai.com/api/docs/pricing',
};

export const PRESETS: Record<string, ModelPreset> = {
  [DEEPSEEK_FLASH.key]: DEEPSEEK_FLASH,
  [DEEPSEEK_V4_PRO.key]: DEEPSEEK_V4_PRO,
  [OPENAI_GPT_6_LUNA.key]: OPENAI_GPT_6_LUNA,
};

export function presetByKey(key: string | null | undefined): ModelPreset | null {
  if (!key) return null;
  return PRESETS[key] ?? null;
}

/** `Precios` (ver `usage.ts`) desde un preset, en Decimal — mismo tipo que
 *  ya espera `precioVigente`/`recordUsage`. */
export function preciosDePreset(preset: ModelPreset): { input: Prisma.Decimal; output: Prisma.Decimal; cachedInput: Prisma.Decimal } {
  return {
    input: new Prisma.Decimal(preset.prices.inputPerMToken),
    output: new Prisma.Decimal(preset.prices.outputPerMToken),
    cachedInput: new Prisma.Decimal(preset.prices.cachedInputPerMToken),
  };
}
