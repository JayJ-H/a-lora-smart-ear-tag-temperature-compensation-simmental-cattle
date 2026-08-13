<template>
  <ElAutocomplete
    v-model="model"
    class="cow-number-autocomplete w-full"
    clearable
    :debounce="80"
    :fit-input-width="true"
    popper-class="cow-number-autocomplete-popper"
    :placeholder="placeholder"
    :fetch-suggestions="querySuggestions"
    :trigger-on-focus="true"
    @focus="refreshIfStale"
    @select="handleSelect"
    @blur="$emit('blur')"
  >
    <template #default="{ item }">
      <div class="cow-autocomplete-option">
        <div class="cow-autocomplete-main">
          <div class="cow-autocomplete-title">
            <strong>{{ item.cowNumber }}</strong>
            <small v-if="item.cowName">{{ item.cowName }}</small>
          </div>
          <div class="cow-autocomplete-tags">
            <em v-if="item.status">{{ item.status }}</em>
            <em v-if="item.currentPen" class="is-pen">{{ item.currentPen }}</em>
          </div>
        </div>
        <span>{{ item.summary || item.cowId || '无更多档案信息' }}</span>
        <small v-if="item.aliasSummary" class="cow-autocomplete-alias">{{ item.aliasSummary }}</small>
      </div>
    </template>
  </ElAutocomplete>
</template>

<script setup lang="ts">
  import { ref } from 'vue'
  import * as databaseService from '@/services/数据库'

  interface CowSuggestion {
    value: string
    cowId: string
    cowNumber: string
    cowName: string
    earTagNumber: string
    status: string
    currentPen: string
    aliases: string[]
    aliasSummary: string
    searchText: string
    summary: string
  }

  const props = withDefaults(
    defineProps<{
      placeholder?: string
      allowNew?: boolean
      maxSuggestions?: number
    }>(),
    {
      placeholder: '请输入或选择牛号',
      allowNew: false,
      maxSuggestions: 30
    }
  )

  const emit = defineEmits<{
    blur: []
    select: [item: CowSuggestion]
  }>()

  const model = defineModel<string>({ default: '' })
  const cows = ref<CowSuggestion[]>([])
  const lastLoadedAt = ref(0)
  const suggestionCache = new Map<string, { rows: CowSuggestion[]; loadedAt: number }>()

  async function loadCows(query = '') {
    const rows = await databaseService
      .searchCowSuggestions(query, { limit: props.maxSuggestions, silent: true })
      .catch(() => [])
    cows.value = uniqueCowSuggestions(rows.map(mapCow).filter((item) => item.cowNumber))
    lastLoadedAt.value = Date.now()
    return cows.value
  }

  function refreshIfStale() {
    if (!lastLoadedAt.value || Date.now() - lastLoadedAt.value > 30000) {
      void loadCows(model.value || '')
    }
  }

  function querySuggestions(query: string, callback: (items: CowSuggestion[]) => void) {
    void querySuggestionsAsync(query, callback)
  }

  async function querySuggestionsAsync(query: string, callback: (items: CowSuggestion[]) => void) {
    const key = normalize(query).toLowerCase()
    const cacheKey = key || '__empty__'
    const cached = suggestionCache.get(cacheKey)
    if (cached && Date.now() - cached.loadedAt < 30000) {
      callback(withAllowNew(query, key, cached.rows))
      return
    }
    const rows = await loadCows(query)
    const matched = rows
      .filter((item) => !key || item.searchText.includes(key))
      .sort((left, right) => scoreSuggestion(right, key) - scoreSuggestion(left, key))
      .slice(0, props.maxSuggestions)
    suggestionCache.set(cacheKey, { rows: matched, loadedAt: Date.now() })
    callback(withAllowNew(query, key, matched))
  }

  function withAllowNew(query: string, key: string, rows: CowSuggestion[]) {
    if (rows.length || !props.allowNew || !key) return rows
    return [
      {
        value: query,
        cowId: '',
        cowNumber: query,
        cowName: '',
        earTagNumber: '',
        status: '新建牛号',
        currentPen: '',
        aliases: [query],
        aliasSummary: '',
        searchText: normalize(query).toLowerCase(),
        summary: '作为新牛号录入'
      }
    ]
  }

  function handleSelect(item: Record<string, any>) {
    const selected = item as CowSuggestion
    model.value = selected.cowNumber
    emit('select', selected)
  }

  function mapCow(row: any): CowSuggestion {
    const cowNumber = normalize(
      row.cowNumber || row.cow_number || row.animalNumber || row.animal_number || row.number
    )
    const earTagNumber = normalize(
      row.earTagNumber || row.ear_tag_number || row.earTag || row.ear_tag
    )
    const cowName = normalize(
      row.cowName || row.cow_name || row.name || row.nickName || row.nickname
    )
    const status = normalize(row.status || row.productionStage || row.production_stage)
    const currentPen = normalize(
      row.currentPenName ||
        row.current_pen_name ||
        row.currentPen ||
        row.current_pen ||
        row.currentUnitId ||
        row.current_unit_id ||
        row.currentPenId ||
        row.current_pen_id
    )
    const cowId = normalize(row.id || row.cowId || row.cow_id || row.animalId || row.animal_id)
    const aliases = uniqueTextValues([
      cowId,
      cowNumber,
      earTagNumber,
      cowName,
      normalize(row.rfid || row.rfidCode || row.rfid_code),
      normalize(row.deviceId || row.device_id),
      ...(Array.isArray(row.aliases) ? row.aliases : [])
    ])
    const aliasSummary =
      normalize(row.aliasSummary || row.alias_summary) ||
      aliases
        .filter((item) => ![cowId, cowNumber, earTagNumber, cowName, status, currentPen].includes(item))
        .slice(0, 4)
        .join(' / ')
    return {
      value: cowNumber,
      cowId,
      cowNumber,
      cowName,
      earTagNumber,
      status,
      currentPen,
      aliases,
      aliasSummary,
      searchText: uniqueTextValues([cowNumber, earTagNumber, cowName, status, currentPen, ...aliases])
        .join(' ')
        .toLowerCase(),
      summary: [
        earTagNumber ? `耳号 ${earTagNumber}` : '',
        aliases.find((item) => item && ![cowId, cowNumber, earTagNumber, cowName].includes(item))
          ? `标识 ${aliases.find((item) => ![cowId, cowNumber, earTagNumber, cowName].includes(item))}`
          : '',
        status,
        currentPen ? `圈舍 ${currentPen}` : ''
      ]
        .filter(Boolean)
        .join(' / ')
    }
  }

  function uniqueCowSuggestions(rows: CowSuggestion[]) {
    const byKey = new Map<string, CowSuggestion>()
    rows.forEach((row) => {
      const key = row.cowId || row.cowNumber || row.earTagNumber
      if (!key) return
      const existing = byKey.get(key)
      if (!existing) {
        byKey.set(key, row)
        return
      }
      const aliases = uniqueTextValues([...existing.aliases, ...row.aliases])
      const aliasSummary = uniqueTextValues([existing.aliasSummary, row.aliasSummary])
        .join(' / ')
        .split(' / ')
        .filter(Boolean)
        .slice(0, 4)
        .join(' / ')
      byKey.set(key, {
        ...existing,
        cowNumber: existing.cowNumber || row.cowNumber,
        cowName: existing.cowName || row.cowName,
        earTagNumber: existing.earTagNumber || row.earTagNumber,
        status: existing.status || row.status,
        currentPen: existing.currentPen || row.currentPen,
        aliases,
        aliasSummary,
        searchText: uniqueTextValues([
          existing.searchText,
          row.searchText,
          existing.cowNumber || row.cowNumber,
          existing.earTagNumber || row.earTagNumber,
          existing.cowName || row.cowName,
          existing.currentPen || row.currentPen,
          ...aliases
        ])
          .join(' ')
          .toLowerCase()
      })
    })
    return Array.from(byKey.values()).sort((left, right) =>
      left.cowNumber.localeCompare(right.cowNumber, 'zh-CN', { numeric: true })
    )
  }

  function scoreSuggestion(item: CowSuggestion, key: string) {
    if (!key) return 0
    if (item.cowNumber.toLowerCase() === key) return 100
    if (item.cowNumber.toLowerCase().startsWith(key)) return 80
    if (item.earTagNumber.toLowerCase().startsWith(key)) return 70
    if (item.aliases.some((alias) => alias.toLowerCase() === key)) return 65
    if (item.searchText.includes(key)) return 30
    return 0
  }

  function uniqueTextValues(values: unknown[]) {
    return Array.from(new Set(values.map(normalize).filter(Boolean)))
  }

  function normalize(value: unknown) {
    return value == null ? '' : String(value).trim()
  }
</script>

<style scoped>
  .cow-autocomplete-option {
    display: grid;
    gap: 2px;
    width: 100%;
    min-width: 0;
    padding: 4px 0;
  }

  .cow-number-autocomplete {
    width: 100%;
    min-width: 0;
  }

  .cow-number-autocomplete :deep(.el-input__wrapper) {
    min-width: 0;
  }

  .cow-number-autocomplete :deep(.el-input__inner) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cow-autocomplete-main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
    min-width: 0;
  }

  .cow-autocomplete-title {
    display: flex;
    gap: 8px;
    align-items: baseline;
    min-width: 0;
  }

  .cow-autocomplete-option strong {
    min-width: 0;
    overflow: hidden;
    color: #0f172a;
    font-size: 13px;
    line-height: 18px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cow-autocomplete-title small,
  .cow-autocomplete-alias {
    min-width: 0;
    overflow: hidden;
    color: #789089;
    font-size: 11px;
    line-height: 16px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cow-autocomplete-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    align-items: center;
    justify-content: flex-end;
    max-width: 188px;
    min-width: 0;
  }

  .cow-autocomplete-option em {
    flex: 0 0 auto;
    max-width: 82px;
    padding: 1px 6px;
    overflow: hidden;
    color: #047857;
    font-size: 11px;
    font-style: normal;
    line-height: 16px;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: #ecfdf5;
    border: 1px solid #bbf7d0;
    border-radius: 999px;
  }

  .cow-autocomplete-option em.is-pen {
    color: #0369a1;
    background: #eff6ff;
    border-color: #bfdbfe;
  }

  .cow-autocomplete-option span {
    display: block;
    min-width: 0;
    overflow: hidden;
    color: #64748b;
    font-size: 12px;
    line-height: 16px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cow-autocomplete-alias {
    display: block;
    color: #8a9b95;
  }

  :global(.cow-number-autocomplete-popper) {
    z-index: 3600 !important;
    max-width: min(620px, calc(100vw - 28px));
    overflow: hidden;
    border: 1px solid rgb(54 103 88 / 20%);
    border-radius: 12px;
    box-shadow:
      0 22px 58px rgb(38 83 70 / 16%),
      inset 0 1px 0 rgb(255 255 255 / 74%);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
  }

  :global(.cow-number-autocomplete-popper .el-autocomplete-suggestion__wrap) {
    max-height: 318px;
    padding: 6px;
  }

  :global(.cow-number-autocomplete-popper .el-autocomplete-suggestion li) {
    min-width: 0;
    padding: 8px 10px;
    line-height: normal;
    border-radius: 10px;
  }

  :global(.cow-number-autocomplete-popper .el-autocomplete-suggestion li:hover),
  :global(.cow-number-autocomplete-popper .el-autocomplete-suggestion li.highlighted) {
    background: rgb(240 253 244 / 86%);
  }

  @media (max-width: 520px) {
    .cow-autocomplete-main {
      grid-template-columns: minmax(0, 1fr);
      gap: 4px;
    }

    .cow-autocomplete-title {
      align-items: flex-start;
      flex-direction: column;
      gap: 2px;
    }

    .cow-autocomplete-tags {
      justify-content: flex-start;
      max-width: 100%;
    }
  }
</style>
