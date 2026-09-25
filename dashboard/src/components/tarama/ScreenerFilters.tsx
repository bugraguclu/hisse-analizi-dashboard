"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import {
  FilterBar,
  FilterChoiceList,
  FilterGroupsMenu,
  FilterMenu,
  FilterPanelSection,
  summarizePicks,
  useFilterBarText,
  type FilterGroupSpec,
  type FilterOption,
} from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ScreenerUniverseOut } from "@/types";
import { boundInputText, presetRule, rangeChipLabel } from "./display";
import { hasTaramaKey, indexLabel, sectorLabel, useTaramaI18n, type TaramaKey } from "./i18n";
import { ScreenerSortMenu } from "./SortMenu";
import {
  CROSS_VALUES,
  EXCLUSIVE_PRESETS,
  FILTER_GROUPS,
  PRESETS,
  RANGE_BY_KEY,
  RANGE_FILTERS,
  REC_VALUES,
  filterRows,
  foldText,
  isPresetActive,
  parseDecimal,
  togglePreset,
  updateRange,
  withFilters,
  type Bounds,
  type CrossFilter,
  type FilterGroup,
  type PresetId,
  type RangeKey,
  type RecFilter,
  type ScreenerState,
} from "./model";

const SEARCH_DEBOUNCE_MS = 250;
const RANGE_DEBOUNCE_MS = 500;

const selectClass =
  "h-8 w-full min-w-0 rounded-md border border-input bg-card px-2 text-[13px] text-foreground outline-none transition-colors focus-visible:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50";

/** Filter updates are functions of the latest state, so debounced edits never overwrite newer ones. */
export type StateUpdate = (update: (prev: ScreenerState) => ScreenerState) => void;

/** Everything the criteria panel owns: bounds, the SMA cross and the analyst rating. */
function criteriaCount(state: ScreenerState, group?: FilterGroup): number {
  const ranges = RANGE_FILTERS.filter((def) => (!group || def.group === group) && state.ranges[def.key]).length;
  const cross = state.cross && (!group || group === "technical") ? 1 : 0;
  const rec = state.rec && (!group || group === "analyst") ? 1 : 0;
  return ranges + cross + rec;
}

/**
 * Search row + the belif-style filter bar: ENDEKS, SEKTÖR, TARAMALAR (quick
 * screens), KRİTERLER (bounds) and SIRALA (order, page size) menus. Every pick applies at once; each
 * option shows how many stocks it would leave, and one that would leave none
 * is dimmed rather than hidden.
 */
export function ScreenerFilters({
  state,
  onChange,
  data,
}: {
  state: ScreenerState;
  onChange: StateUpdate;
  /** Undefined while the universe is loading. */
  data: ScreenerUniverseOut | undefined;
}) {
  const { t, locale } = useTaramaI18n();
  const text = useFilterBarText();
  const rows = data?.rows;

  // Counts are computed client-side: the whole universe is already here (~630 rows).
  const counts = useMemo(() => {
    if (!rows) return null;
    const count = (next: ScreenerState) => filterRows(rows, next).length;
    return {
      current: count(state),
      index: new Map((data?.indices ?? []).map((option) => [option.code, count({ ...state, index: option.code })])),
      anyIndex: count({ ...state, index: "" }),
      sector: new Map((data?.sectors ?? []).map((option) => [option.key, count({ ...state, sector: option.key })])),
      anySector: count({ ...state, sector: "" }),
      preset: new Map(PRESETS.map((preset) => [preset.id, count(isPresetActive(state, preset) ? state : togglePreset(state, preset))])),
    };
  }, [rows, data, state]);

  const turkishSectors = useMemo(() => new Map((data?.sectors ?? []).map((sector) => [sector.key, sector.name_tr])), [data]);
  const indicesDown = data?.warnings.includes("indices") ?? false;

  // ENDEKS ------------------------------------------------------------------
  const listedIndex = (data?.indices ?? []).some((option) => option.code === state.index);
  const indexOptions: FilterOption[] = [
    { value: "", label: t("filters.allStocks"), count: counts?.anyIndex ?? null },
    ...(data?.indices ?? []).map((option) => ({
      value: option.code,
      label: indexLabel(option.code, locale),
      count: counts?.index.get(option.code) ?? null,
      disabled: indicesDown && option.code !== state.index,
    })),
    // A linked index the data does not list (yet) must still show as picked.
    ...(state.index && !listedIndex ? [{ value: state.index, label: indexLabel(state.index, locale) }] : []),
  ];

  // SEKTÖR ------------------------------------------------------------------
  const listedSector = (data?.sectors ?? []).some((option) => option.key === state.sector);
  const sectorOptions: FilterOption[] = [
    { value: "", label: t("filters.allSectors"), count: counts?.anySector ?? null },
    ...(data?.sectors ?? [])
      .map((sector) => ({
        value: sector.key,
        label: sectorLabel(sector.key, locale, turkishSectors),
        count: counts?.sector.get(sector.key) ?? null,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, locale)),
    ...(state.sector && !listedSector ? [{ value: state.sector, label: sectorLabel(state.sector, locale, turkishSectors) }] : []),
  ];

  // TARAMALAR ---------------------------------------------------------------
  const activePresets = PRESETS.filter((preset) => isPresetActive(state, preset));
  const presetGroups = FILTER_GROUPS.map((group): FilterGroupSpec<PresetId> => {
    const presets = PRESETS.filter((preset) => preset.group === group);
    return {
      id: group,
      label: t(`group.${group}` as TaramaKey),
      options: presets.map((preset) => {
        const note = `preset.${preset.id}.note`;
        return {
          value: preset.id,
          label: t(`preset.${preset.id}` as TaramaKey),
          // The rule itself is on screen (touch has no tooltips); the tooltip adds the why.
          description: presetRule(preset, locale),
          title: hasTaramaKey(note) ? t(note) : undefined,
          exclusive: EXCLUSIVE_PRESETS.has(preset.id),
          count: counts?.preset.get(preset.id) ?? null,
        };
      }),
      selected: presets.filter((preset) => isPresetActive(state, preset)).map((preset) => preset.id),
      // Screens combine; one touching the same field as another replaces it (see togglePreset).
      onChange: (next) =>
        onChange((prev) => {
          let result = prev;
          for (const preset of presets) {
            if (next.includes(preset.id) !== isPresetActive(result, preset)) result = togglePreset(result, preset);
          }
          return result;
        }),
    };
  }).filter((group) => (group.options?.length ?? 0) > 0);

  // KRİTERLER ---------------------------------------------------------------
  const commitRange = (key: RangeKey, bounds: Bounds) => onChange((prev) => updateRange(prev, key, bounds));
  const criteriaGroups: FilterGroupSpec[] = FILTER_GROUPS.map((group, index) => ({
    id: group,
    label: t(`group.${group}` as TaramaKey),
    count: criteriaCount(state, group),
    note: index === 0 ? t("filters.unitHint") : undefined,
    content: (
      <div className="space-y-2 px-[18px] pb-2 pt-1">
        {RANGE_FILTERS.filter((def) => def.group === group).map((def) => (
          <RangeField key={def.key} rangeKey={def.key} bounds={state.ranges[def.key]} onCommit={(bounds) => commitRange(def.key, bounds)} />
        ))}
        {group === "technical" && (
          <ChoiceField<CrossFilter>
            label={t("filters.cross")}
            value={state.cross}
            options={CROSS_VALUES.map((value) => ({ value, label: t(value === "golden" ? "signal.golden" : "signal.death") }))}
            onChange={(cross) => onChange((prev) => withFilters(prev, { cross }))}
          />
        )}
        {group === "analyst" && (
          <ChoiceField<RecFilter>
            label={t("filters.recommendation")}
            value={state.rec}
            options={REC_VALUES.map((value) => ({ value, label: t(`rec.${value}` as TaramaKey) }))}
            onChange={(rec) => onChange((prev) => withFilters(prev, { rec }))}
          />
        )}
      </div>
    ),
  }));
  const criteriaLabels = [
    ...RANGE_FILTERS.flatMap((def) => {
      const bounds = state.ranges[def.key];
      return bounds ? [rangeChipLabel(def, bounds, locale)] : [];
    }),
    ...(state.cross ? [t(state.cross === "golden" ? "signal.golden" : "signal.death")] : []),
    ...(state.rec ? [`${t("filters.recommendation")}: ${t(`rec.${state.rec}` as TaramaKey)}`] : []),
  ];

  const shown = counts?.current ?? null;
  const applyLabel = shown === null ? t("filters.showPlain") : t(shown === 1 ? "filters.showOne" : "filters.show", { count: shown.toLocaleString(locale) });

  return (
    <section aria-label={t("filters.title")} className="space-y-3">
      <SearchField value={state.q} onCommit={(q) => onChange((prev) => withFilters(prev, { q }))} />

      <FilterBar label={t("filters.title")}>
        <FilterMenu label={t("filters.universe")} value={state.index ? indexLabel(state.index, locale) : t("filters.all")} icon="list">
          <FilterChoiceList
            label={t("filters.universe")}
            value={state.index}
            options={indexOptions}
            onChange={(index) => onChange((prev) => withFilters(prev, { index }))}
          />
          {indicesDown ? (
            <FilterPanelSection>
              <p className="text-[11px] leading-snug text-muted-foreground">{t("warn.indices")}</p>
            </FilterPanelSection>
          ) : null}
        </FilterMenu>

        <FilterMenu
          label={t("filters.sector")}
          value={state.sector ? sectorLabel(state.sector, locale, turkishSectors) : t("filters.all")}
          icon="list"
        >
          <FilterChoiceList
            label={t("filters.sector")}
            value={state.sector}
            options={sectorOptions}
            onChange={(sector) => onChange((prev) => withFilters(prev, { sector }))}
          />
        </FilterMenu>

        <FilterGroupsMenu
          label={t("filters.screens")}
          title={t("filters.presets")}
          value={summarizePicks(activePresets.map((preset) => t(`preset.${preset.id}` as TaramaKey)), text)}
          groups={presetGroups}
          // Clears the screens only; the typed criteria are the KRİTERLER panel's.
          onClear={() => onChange((prev) => withFilters(prev, { presets: [] }))}
          clearDisabled={activePresets.length === 0}
          applyLabel={applyLabel}
          empty={shown === 0}
          // Six groups of rules: side by side on wide screens; a taller list on phones and tablets.
          columns
          panelClassName="max-h-[min(36rem,74dvh)] sm:w-[max(100%,22rem)] sm:max-h-[min(36rem,74dvh)]"
        />

        <FilterGroupsMenu
          label={t("filters.criteria")}
          title={t("filters.advanced")}
          value={summarizePicks(criteriaLabels, text)}
          groups={criteriaGroups}
          // Clears the typed criteria only; the quick screens stay.
          onClear={() => onChange((prev) => withFilters(prev, { ranges: {}, cross: "", rec: "" }))}
          clearDisabled={criteriaCount(state) === 0}
          applyLabel={applyLabel}
          empty={shown === 0}
          // Bounds need room for a label and two inputs; the rest of the bar's panels are narrower.
          panelClassName="sm:w-[max(100%,22rem)] sm:max-w-[26rem]"
        />

        <ScreenerSortMenu state={state} onChange={onChange} />
      </FilterBar>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function SearchField({ value, onCommit }: { value: string; onCommit: (q: string) => void }) {
  const { t } = useTaramaI18n();
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Follow outside changes (back/forward, a cleared filter) unless they only echo what was typed.
  if (value !== synced) {
    setSynced(value);
    if (foldText(draft.trim()) !== foldText(value.trim())) setDraft(value);
  }
  useEffect(() => () => clearTimeout(timer.current), []);

  function update(next: string) {
    setDraft(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onCommit(next.trim()), SEARCH_DEBOUNCE_MS);
  }

  function clear() {
    setDraft("");
    clearTimeout(timer.current);
    onCommit("");
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {t("filters.searchLabel")}
      </label>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        id={id}
        type="search"
        value={draft}
        maxLength={40}
        autoComplete="off"
        spellCheck={false}
        placeholder={t("filters.search")}
        onChange={(event) => update(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && draft) {
            event.preventDefault();
            clear();
          } else if (event.key === "Enter") {
            clearTimeout(timer.current);
            onCommit(draft.trim());
          }
        }}
        className="h-9 pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden"
      />
      {draft && (
        <button
          type="button"
          onClick={clear}
          aria-label={t("filters.clearSearch")}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Criteria fields (inside the KRİTERLER panel)
// ---------------------------------------------------------------------------

function ChoiceField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: Exclude<T, "">; label: string }>;
  onChange: (value: T) => void;
}) {
  const { t } = useTaramaI18n();
  const id = useId();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,11rem)] items-center gap-2">
      <label htmlFor={id} className="text-pretty text-[12px] leading-snug text-foreground">
        {label}
      </label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value as T)} className={cn(selectClass, "h-7 text-[12px]")}>
        <option value="">{t("filters.any")}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function RangeField({ rangeKey, bounds, onCommit }: { rangeKey: RangeKey; bounds: Bounds | undefined; onCommit: (bounds: Bounds) => void }) {
  const { t } = useTaramaI18n();
  const baseId = useId();
  const label = t(`range.${rangeKey}` as TaramaKey);
  const min = bounds?.min;
  const max = bounds?.max;
  const [draft, setDraft] = useState<[string, string]>(() => [boundInputText(min), boundInputText(max)]);
  const [synced, setSynced] = useState<[number | undefined, number | undefined]>([min, max]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Adopt outside changes (quick screen, chip removed, back/forward) — but keep what the
  // user is typing when it already means the committed value ("1," while typing "1,5").
  if (synced[0] !== min || synced[1] !== max) {
    setSynced([min, max]);
    setDraft([
      (parseDecimal(draft[0]) ?? undefined) === min ? draft[0] : boundInputText(min),
      (parseDecimal(draft[1]) ?? undefined) === max ? draft[1] : boundInputText(max),
    ]);
  }
  useEffect(() => () => clearTimeout(timer.current), []);

  const parsed = draft.map((text) => (text.trim() ? parseDecimal(text) : null)) as [number | null, number | null];
  const invalid = draft.map((text, i) => text.trim() !== "" && parsed[i] === null) as [boolean, boolean];
  const inverted = parsed[0] !== null && parsed[1] !== null && parsed[0] > parsed[1];

  function commit(next: [string, string]) {
    const values = next.map((text) => (text.trim() ? parseDecimal(text) : null));
    // Leave the committed filter alone while a field holds something unparseable.
    if (next.some((text, i) => text.trim() !== "" && values[i] === null)) return;
    onCommit({ min: values[0] ?? undefined, max: values[1] ?? undefined });
  }

  function update(index: 0 | 1, text: string) {
    const next: [string, string] = index === 0 ? [text, draft[1]] : [draft[0], text];
    setDraft(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(next), RANGE_DEBOUNCE_MS);
  }

  function flush() {
    clearTimeout(timer.current);
    commit(draft);
  }

  const def = RANGE_BY_KEY.get(rangeKey);
  const errorId = `${baseId}-error`;
  const error = invalid[0] || invalid[1] ? t("filters.invalidNumber") : inverted ? t("filters.invalidRange") : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,11rem)] items-center gap-x-2 gap-y-1">
      <label htmlFor={`${baseId}-min`} className="text-pretty text-[12px] leading-snug text-foreground">
        {label}
      </label>
      <div className="flex items-center gap-1" data-unit={def?.unit}>
        {([0, 1] as const).map((index) => (
          <Input
            key={index}
            id={`${baseId}-${index === 0 ? "min" : "max"}`}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder={t(index === 0 ? "filters.min" : "filters.max")}
            aria-label={`${label} ${t(index === 0 ? "filters.min" : "filters.max")}`}
            aria-invalid={invalid[index] || inverted || undefined}
            aria-describedby={error ? errorId : undefined}
            value={draft[index]}
            onChange={(event) => update(index, event.target.value)}
            onBlur={flush}
            onKeyDown={(event) => {
              if (event.key === "Enter") flush();
            }}
            className="h-7 px-2 text-right font-mono text-[12px] tabular-nums md:text-[12px]"
          />
        ))}
      </div>
      {error && (
        <p id={errorId} role="alert" className="col-span-2 text-right text-[11px] text-down">
          {error}
        </p>
      )}
    </div>
  );
}
