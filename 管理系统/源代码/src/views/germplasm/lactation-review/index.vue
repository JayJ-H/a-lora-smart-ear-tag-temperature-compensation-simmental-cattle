<template>
  <FcPageShell
    title="泌乳复核"
    status-label="复核批次"
    :status-value="generatedAtText"
    primary-action-label="刷新复核"
    primary-action-icon="ri:refresh-line"
    secondary-action-label="确认选中"
    secondary-action-icon="ri:check-line"
    @primary-action="loadReview"
    @secondary-action="confirmSelected"
  >
    <template #metrics>
      <section class="fc-metric-grid">
        <FcMetricTile
          label="缺整日"
          :value="review.summary.totalMissingDays"
          note="当天没有任何目标班次记录"
          icon="ri:calendar-close-line"
          tone="warning"
        />
        <FcMetricTile
          label="缺班次"
          :value="review.summary.totalMissingShifts"
          note="当天有部分班次，缺指定班次"
          icon="ri:time-line"
        />
        <FcMetricTile
          label="空产量"
          :value="review.summary.totalEmptyValues || 0"
          note="已有牛号、日期、班次但产量为空"
          icon="ri:question-answer-line"
          tone="warning"
        />
        <FcMetricTile
          label="汇总待拆分"
          :value="review.summary.totalSummaryOnly"
          note="有泌乳汇总但缺日明细"
          icon="ri:file-list-3-line"
          tone="info"
        />
        <FcMetricTile
          label="待确认"
          :value="review.summary.pendingCount"
          note="操作员确认后才会写入产奶记录"
          icon="ri:checkbox-circle-line"
          tone="teal"
        />
        <FcMetricTile
          label="涉及牛只"
          :value="review.summary.cowCount"
          note="按牛只档案或牛号关联"
          icon="ri:team-line"
          tone="info"
        />
      </section>
    </template>

    <FcPanel title="复核范围">
      <div class="filter-grid">
        <ElDatePicker
          v-model="dateRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          class="date-range"
        />
        <ElSelect
          v-model="expectedShifts"
          multiple
          collapse-tags
          collapse-tags-tooltip
          placeholder="期望班次"
        >
          <ElOption v-for="shift in shiftOptions" :key="shift" :label="shift" :value="shift" />
        </ElSelect>
        <ElSelect v-model="period" placeholder="查看口径">
          <ElOption label="按日" value="day" />
          <ElOption label="按月" value="month" />
          <ElOption label="按年" value="year" />
        </ElSelect>
        <CowNumberAutocomplete
          v-model="keyword"
          placeholder="搜索牛号、日期、胎次"
          @select="handleCowKeywordSelect"
        />
        <ElButton type="primary" :loading="loading" @click="loadReview">生成复核</ElButton>
      </div>
    </FcPanel>

    <section class="cow-review-layout">
      <FcPanel title="单牛缺失复核卡片" class="review-cow-panel">
        <div
          ref="reviewCowCardContainerRef"
          class="review-cow-card-viewport"
          v-loading="loading"
          @scroll.passive="onReviewCowCardScroll"
          @wheel.passive="onReviewCowCardWheel"
        >
          <div class="review-cow-card-grid">
            <article
              v-for="card in visibleReviewCowCards"
              :key="card.key"
              class="review-cow-card art-card"
              :class="{ 'is-active': selectedCowCard?.key === card.key }"
              role="button"
              tabindex="0"
              @click="selectCowCard(card)"
              @keydown.enter.prevent="selectCowCard(card)"
              @keydown.space.prevent="selectCowCard(card)"
            >
              <div class="review-cow-head">
                <div>
                  <span>牛号 {{ card.cowNumber }}</span>
                  <h3>{{ card.missingCount }} 个缺口</h3>
                  <p>胎次 {{ card.parityText }} · DIM {{ card.dimRange }}</p>
                </div>
                <ElTag :type="confidenceTag(card.confidence)">{{
                  confidenceLabel(card.confidence)
                }}</ElTag>
              </div>
              <div class="review-cow-metrics">
                <div>
                  <span>建议均值</span>
                  <strong>{{ card.avgRecommendedMilk.toFixed(1) }} kg</strong>
                </div>
                <div>
                  <span>首个缺口</span>
                  <strong>{{ card.firstMissingDate }}</strong>
                </div>
                <div>
                  <span>缺失位置</span>
                  <strong>{{ card.positionText }}</strong>
                </div>
              </div>
            </article>
          </div>
          <div v-if="reviewCowCards.length" class="lazy-list-foot">
            <span
              >当前窗口 {{ reviewCowCardStartIndex + 1 }}-{{ reviewCowCardEndIndex }} /
              {{ reviewCowCardTotalCount }} 头牛</span
            >
          </div>
          <div v-if="!reviewCowCards.length && !loading" class="review-empty-diagnostics">
            <FcEmptyState
              icon="ri:checkbox-circle-line"
              :title="review.items.length ? '当前筛选没有待复核牛卡' : '当前范围没有返回缺失记录'"
              :description="emptyReviewDescription"
            />
            <div class="diagnostic-grid">
              <span>日期 {{ dateRange?.[0] || '-' }} 至 {{ dateRange?.[1] || '-' }}</span>
              <span>班次 {{ expectedShifts.join(' / ') || '全天' }}</span>
              <span>接口返回 {{ review.items.length }} 条</span>
              <span>待确认 {{ review.summary.pendingCount }} 条</span>
            </div>
          </div>
        </div>
      </FcPanel>

      <FcPanel title="单牛缺失位置复核" class="review-detail-panel">
        <template #actions>
          <ElButton
            :disabled="!selectedMissingItems.length"
            :loading="confirming"
            type="success"
            @click="confirmCurrentCow"
          >
            确认该牛全部 {{ selectedMissingItems.length }}
          </ElButton>
        </template>
        <div v-if="selectedCowCard" class="cow-review-detail">
          <div class="selected-cow-summary">
            <div>
              <span>当前牛号</span>
              <strong>{{ selectedCowCard.cowNumber }}</strong>
            </div>
            <div>
              <span>缺失位置</span>
              <strong>{{ selectedCowCard.missingCount }} 个</strong>
            </div>
            <div>
              <span>建议均值</span>
              <strong>{{ selectedCowCard.avgRecommendedMilk.toFixed(1) }} kg</strong>
            </div>
          </div>

          <div class="curve-panel art-card-sm" aria-label="泌乳复核曲线">
            <div class="curve-toolbar">
              <span>泌乳曲线</span>
              <strong>{{ selectedCowCurve.length }} 个参考/缺失点</strong>
            </div>
            <div class="curve-chart art-card-xs">
              <svg
                v-if="selectedCowCurve.length"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                role="img"
                aria-label="已有产奶记录与缺失推荐值曲线"
              >
                <polyline
                  v-if="selectedCurvePolyline"
                  class="curve-line"
                  :points="selectedCurvePolyline"
                />
                <g v-for="point in selectedCowCurve" :key="point.key">
                  <line class="curve-guide" :x1="point.x" :x2="point.x" y1="12" y2="94" />
                  <circle
                    class="curve-dot"
                    :class="[`kind-${point.kind}`, { 'is-missing': point.missing }]"
                    :cx="point.x"
                    :cy="point.y"
                    r="2.5"
                  />
                </g>
              </svg>
              <FcEmptyState
                v-else
                icon="ri:line-chart-line"
                title="暂无曲线点"
                description="暂无参考点。"
              />
            </div>
            <div class="curve-label-row">
              <span v-for="point in selectedCowCurve" :key="`${point.key}-label`">
                {{ point.label }}
                <strong>{{ point.valueText }}</strong>
              </span>
            </div>
            <div class="curve-legend">
              <span><i class="legend-existing" />已有记录</span>
              <span><i class="legend-day" />缺整日</span>
              <span><i class="legend-shift" />缺班次</span>
              <span><i class="legend-summary" />汇总待拆分</span>
            </div>
          </div>

          <div
            class="missing-block-list"
            @scroll.passive="onSelectedMissingScroll"
            @wheel.passive="onSelectedMissingWheel"
          >
            <article
              v-for="block in visibleSelectedMissingBlocks"
              :key="block.item.id"
              class="missing-review-block art-card"
              :class="{ 'is-active': selectedMissingItem?.id === block.item.id }"
              role="button"
              tabindex="0"
              @click="selectMissingItem(block.item)"
              @keydown.enter.prevent="selectMissingItem(block.item)"
              @keydown.space.prevent="selectMissingItem(block.item)"
            >
              <div class="missing-block-head">
                <div>
                  <span>缺失位置 {{ block.index + 1 }}</span>
                  <h4>{{ block.item.date }} - {{ block.item.expectedShift }}</h4>
                </div>
                <div class="missing-tags">
                  <ElTag :type="missingKindTag(block.item.missingKind)">
                    {{ missingKindLabel(block.item.missingKind) }}
                  </ElTag>
                  <ElTag :type="confidenceTag(block.item.confidence)">
                    可信度{{ confidenceLabel(block.item.confidence) }}
                  </ElTag>
                </div>
              </div>

              <dl class="missing-meta-grid">
                <div>
                  <dt>胎次</dt>
                  <dd>{{ block.item.parityNo || '-' }}</dd>
                </div>
                <div>
                  <dt>DIM</dt>
                  <dd>{{ block.item.dim || '-' }}</dd>
                </div>
                <div>
                  <dt>已有日奶量</dt>
                  <dd>{{ block.item.existingDailyMilk.toFixed(1) }} kg</dd>
                </div>
                <div>
                  <dt>推荐方法</dt>
                  <dd>{{ methodLabel(block.item.recommendationMethod) }}</dd>
                </div>
              </dl>

              <div v-if="block.item.missingKind === 'summary_only'" class="summary-split-note">
                <strong>汇总待拆日明细</strong>
                <span>{{ block.summaryRangeText }}</span>
                <span>待人工确认。</span>
              </div>

              <div class="recommendation-row">
                <div>
                  <span>建议产奶量</span>
                  <ElInputNumber
                    v-model="editableValues[block.item.id]"
                    :min="0"
                    :precision="1"
                    :step="0.5"
                    controls-position="right"
                    class="value-input"
                  />
                </div>
                <ElButton
                  :loading="confirming"
                  type="primary"
                  plain
                  @click.stop="confirmSingleItem(block.item)"
                >
                  确认该缺口
                </ElButton>
              </div>

              <p class="recommendation-text">{{ block.item.recommendationText }}</p>

              <div class="previous-days-grid">
                <article
                  v-for="day in block.previousDays"
                  :key="`${block.item.id}-${day.date}`"
                  class="art-card-xs"
                >
                  <span>{{ day.date }}</span>
                  <strong>{{ day.valueText }}</strong>
                </article>
              </div>
            </article>
            <div v-if="selectedMissingBlocks.length" class="lazy-list-foot">
              <span>
                当前窗口 {{ selectedMissingBlockStartIndex + 1 }}-{{
                  selectedMissingBlockEndIndex
                }}
                / {{ selectedMissingBlockTotalCount }} 个缺失位置
              </span>
            </div>
          </div>
        </div>
        <FcEmptyState
          v-else
          icon="ri:line-chart-line"
          title="请选择牛卡"
          description="左侧选择牛卡。"
        />
      </FcPanel>
    </section>

    <section class="review-layout">
      <FcPanel title="缺失复核清单" class="review-list-panel">
        <template #actions>
          <ElButton
            :disabled="!selectedRows.length"
            :loading="confirming"
            type="success"
            @click="confirmSelected"
          >
            确认填补 {{ selectedRows.length }}
          </ElButton>
        </template>

        <div
          class="table-scroll"
          @scroll.passive="onReviewTableScroll"
          @wheel.passive="onReviewTableWheel"
        >
          <ElTable
            v-loading="loading"
            :data="visibleFilteredItems"
            height="560"
            row-key="id"
            @selection-change="onSelectionChange"
          >
            <ElTableColumn type="selection" width="52" fixed="left" />
            <ElTableColumn prop="cowNumber" label="牛号" width="120" fixed="left" />
            <ElTableColumn label="缺口类型" width="116">
              <template #default="{ row }">
                <ElTag :type="missingKindTag(row.missingKind)">{{
                  missingKindLabel(row.missingKind)
                }}</ElTag>
              </template>
            </ElTableColumn>
            <ElTableColumn prop="date" label="起始日期" width="120" />
            <ElTableColumn prop="expectedShift" label="班次/口径" width="110">
              <template #default="{ row }">
                <ElTag>{{ row.expectedShift }}</ElTag>
              </template>
            </ElTableColumn>
            <ElTableColumn prop="parityNo" label="胎次" width="80" />
            <ElTableColumn prop="dim" label="DIM" width="80" />
            <ElTableColumn label="已有日奶量" width="120">
              <template #default="{ row }">{{ row.existingDailyMilk.toFixed(1) }} kg</template>
            </ElTableColumn>
            <ElTableColumn label="建议值" width="170">
              <template #default="{ row }">
                <ElInputNumber
                  v-model="editableValues[row.id]"
                  :min="0"
                  :precision="1"
                  :step="0.5"
                  controls-position="right"
                  class="value-input"
                />
              </template>
            </ElTableColumn>
            <ElTableColumn label="推荐方法" min-width="220">
              <template #default="{ row }">
                <div class="method-cell">
                  <span>{{ methodLabel(row.recommendationMethod) }}</span>
                  <small>{{ row.recommendationText }}</small>
                  <small v-if="row.missingKind === 'summary_only'">
                    将按 {{ row.summaryDays || 1 }} 天生成人工确认日明细。
                  </small>
                </div>
              </template>
            </ElTableColumn>
            <ElTableColumn prop="confidence" label="可信度" width="90">
              <template #default="{ row }">
                <ElTag :type="confidenceTag(row.confidence)">{{
                  confidenceLabel(row.confidence)
                }}</ElTag>
              </template>
            </ElTableColumn>
            <ElTableColumn prop="status" label="状态" width="100">
              <template #default="{ row }">
                <ElTag :type="row.status === 'pending' ? 'warning' : 'success'">{{
                  row.status === 'pending' ? '待确认' : '已确认'
                }}</ElTag>
              </template>
            </ElTableColumn>
          </ElTable>
          <div v-if="filteredItems.length" class="lazy-list-foot table-foot">
            <span
              >当前窗口 {{ filteredItemStartIndex + 1 }}-{{ filteredItemEndIndex }} /
              {{ filteredItemTotalCount }} 条记录</span
            >
          </div>
        </div>
      </FcPanel>

      <FcPanel title="月年缺口概览" class="review-summary-panel">
        <div
          class="summary-stack"
          ref="groupedSummaryContainerRef"
          @scroll.passive="onGroupedSummaryScroll"
          @wheel.passive="onGroupedSummaryWheel"
        >
          <article v-for="item in visibleGroupedSummary" :key="item.key" class="review-card art-card-sm">
            <div>
              <span>{{ item.label }}</span>
              <strong>{{ item.count }} 个待处理项</strong>
            </div>
            <ElTag>{{ item.cowCount }} 头牛</ElTag>
          </article>
          <div v-if="groupedSummary.length > visibleGroupedSummary.length" class="load-more-row">
            当前窗口 {{ groupedSummaryStartIndex + 1 }}-{{ groupedSummaryEndIndex }} /
            {{ groupedSummaryTotalCount }} 个概览项
          </div>
          <FcEmptyState
            v-if="!groupedSummary.length"
            icon="ri:checkbox-circle-line"
            title="当前范围没有缺失记录"
            description="暂无待复核记录。"
          />
        </div>
      </FcPanel>
    </section>
  </FcPageShell>
</template>

<script setup lang="ts">
  import { computed, onMounted, reactive, ref } from 'vue'
  import { ElMessage } from 'element-plus'
  import FcPageShell from '@/components/business/fluent-console/FcPageShell.vue'
  import FcMetricTile from '@/components/business/fluent-console/FcMetricTile.vue'
  import FcPanel from '@/components/business/fluent-console/FcPanel.vue'
  import FcEmptyState from '@/components/business/fluent-console/FcEmptyState.vue'
  import CowNumberAutocomplete from '@/components/business/cow/CowNumberAutocomplete.vue'
  import { useUserStore } from '@/store/modules/user'
  import { useLazyGridRenderWindow, useLazyRenderWindow } from '@/hooks'
  import { formatDateOnly } from '@/utils/date-display'
  import {
    type MilkMissingReviewItem,
    type MilkMissingReviewResult,
    type MilkReviewPeriod
  } from '@/services/milk-production-statistics'
  import { confirmMilkMissingReview, getMilkMissingReview } from '@/api/milk-review'
  import { getMilkShiftOptions } from '@/services/platform-dictionary'

  defineOptions({ name: 'LactationMissingReview' })

  const emptyReview = (): MilkMissingReviewResult => ({
    items: [],
    summary: {
      totalMissingDays: 0,
      totalMissingShifts: 0,
      totalEmptyValues: 0,
      totalSummaryOnly: 0,
      pendingCount: 0,
      confirmedCount: 0,
      cowCount: 0,
      monthCount: 0,
      yearCount: 0,
      avgRecommendedMilk: 0
    },
    generatedAt: ''
  })

  const userStore = useUserStore()
  const loading = ref(false)
  const confirming = ref(false)
  const review = ref<MilkMissingReviewResult>(emptyReview())
  function dateKey(date: Date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  function addDays(date: Date, days: number) {
    const next = new Date(date)
    next.setDate(next.getDate() + days)
    return next
  }

  function defaultReviewDateRange() {
    const end = addDays(new Date(), -1)
    const start = addDays(end, -29)
    return [dateKey(start), dateKey(end)]
  }

  const dateRange = ref<string[]>(defaultReviewDateRange())
  const period = ref<MilkReviewPeriod>('day')
  const keyword = ref('')
  const expectedShifts = ref(['早班', '晚班'])
  const shiftOptions = ref(['早班', '中班', '晚班', '夜班', '半夜班', '1', '2', '3', '4'])
  const selectedRows = ref<MilkMissingReviewItem[]>([])
  const editableValues = reactive<Record<string, number>>({})
  const selectedCowCardKey = ref('')
  const selectedMissingItemId = ref('')

  interface ReviewCowCard {
    key: string
    cowId: string
    cowNumber: string
    missingCount: number
    parityText: string
    dimRange: string
    firstMissingDate: string
    positionText: string
    confidence: MilkMissingReviewItem['confidence']
    avgRecommendedMilk: number
    items: MilkMissingReviewItem[]
  }

  interface PreviousMilkDay {
    date: string
    value: number | null
    valueText: string
  }

  interface MissingReviewBlock {
    index: number
    item: MilkMissingReviewItem
    previousDays: PreviousMilkDay[]
    summaryRangeText: string
  }

  const filteredItems = computed(() => {
    const key = keyword.value.trim().toLowerCase()
    const rows = review.value.items.filter((item) => item.status === 'pending')
    if (!key) return rows
    return rows.filter((item) => {
      return [
        item.cowNumber,
        item.cowName,
        item.date,
        missingKindLabel(item.missingKind),
        item.expectedShift,
        item.monthKey,
        item.yearKey,
        String(item.parityNo),
        String(item.dim)
      ].some((value) =>
        String(value || '')
          .toLowerCase()
          .includes(key)
      )
    })
  })

  const generatedAtText = computed(() => {
    if (!review.value.generatedAt) return '未生成'
    return formatDateOnly(review.value.generatedAt)
  })

  const emptyReviewDescription = computed(() => {
    if (review.value.items.length && !filteredItems.value.length) {
      return '接口有返回记录，但当前关键词或状态筛选后没有待确认项。'
    }
    if (review.value.summary.confirmedCount > 0 && !review.value.summary.pendingCount) {
      return '当前范围内缺口已确认，调整日期或扩大范围可继续核对。'
    }
    return '后端没有发现可复核缺口；请核对泌乳期、班次口径和产奶明细是否已经入库。'
  })

  const groupedSummary = computed(() => {
    const map = new Map<string, { key: string; label: string; count: number; cows: Set<string> }>()
    filteredItems.value.forEach((item) => {
      const key =
        period.value === 'year'
          ? item.yearKey
          : period.value === 'month'
            ? item.monthKey
            : item.date
      const current = map.get(key) || { key, label: key, count: 0, cows: new Set<string>() }
      current.count += 1
      current.cows.add(item.cowId || item.cowNumber)
      map.set(key, current)
    })
    return Array.from(map.values())
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((item) => ({
        key: item.key,
        label: item.label,
        count: item.count,
        cowCount: item.cows.size
      }))
  })

  const reviewCowCards = computed<ReviewCowCard[]>(() => {
    const grouped = new Map<string, MilkMissingReviewItem[]>()
    filteredItems.value.forEach((item) => {
      const key = item.cowId || item.cowNumber
      if (!key) return
      grouped.set(key, [...(grouped.get(key) || []), item])
    })
    return Array.from(grouped.entries())
      .map(([key, items]) => {
        const sorted = [...items].sort(
          (left, right) =>
            left.date.localeCompare(right.date) ||
            left.expectedShift.localeCompare(right.expectedShift)
        )
        const dims = sorted.map((item) => item.dim).filter((value) => Number.isFinite(value))
        const confidence: MilkMissingReviewItem['confidence'] = sorted.some(
          (item) => item.confidence === 'low'
        )
          ? 'low'
          : sorted.some((item) => item.confidence === 'medium')
            ? 'medium'
            : 'high'
        return {
          key,
          cowId: sorted[0].cowId,
          cowNumber: sorted[0].cowNumber,
          missingCount: sorted.length,
          parityText:
            Array.from(new Set(sorted.map((item) => item.parityNo).filter(Boolean))).join(' / ') ||
            '-',
          dimRange: dims.length ? `${Math.min(...dims)}-${Math.max(...dims)}` : '-',
          firstMissingDate: sorted[0].date,
          positionText: Array.from(
            new Set(sorted.slice(0, 3).map((item) => `${item.date} ${item.expectedShift}`))
          ).join('、'),
          confidence,
          avgRecommendedMilk: average(
            sorted.map((item) => editableValues[item.id] ?? item.recommendedMilk)
          ),
          items: sorted
        }
      })
      .sort(
        (left, right) =>
          right.missingCount - left.missingCount ||
          left.firstMissingDate.localeCompare(right.firstMissingDate)
      )
  })
  const {
    containerRef: reviewCowCardContainerRef,
    visibleItems: visibleReviewCowCards,
    startIndex: reviewCowCardStartIndex,
    endIndex: reviewCowCardEndIndex,
    totalCount: reviewCowCardTotalCount,
    handleScroll: onReviewCowCardScroll,
    handleWheel: onReviewCowCardWheel
  } = useLazyGridRenderWindow(reviewCowCards, {
    rowCount: 2,
    minItemWidth: 260,
    gap: 12,
    fallbackColumns: 3,
    mode: 'fixed-window'
  })
  const {
    visibleItems: visibleFilteredItems,
    startIndex: filteredItemStartIndex,
    endIndex: filteredItemEndIndex,
    totalCount: filteredItemTotalCount,
    handleScroll: onReviewTableScroll,
    handleWheel: onReviewTableWheel
  } = useLazyRenderWindow(filteredItems, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })

  const selectedCowCard = computed(
    () =>
      reviewCowCards.value.find((card) => card.key === selectedCowCardKey.value) ||
      reviewCowCards.value[0] ||
      null
  )
  const selectedMissingItems = computed(() => selectedCowCard.value?.items || [])
  const selectedMissingItem = computed(
    () =>
      selectedMissingItems.value.find((item) => item.id === selectedMissingItemId.value) ||
      selectedMissingItems.value[0] ||
      null
  )
  function previousDaysForItem(item: MilkMissingReviewItem | null): PreviousMilkDay[] {
    if (!item) return []
    if (Array.isArray(item.previousDays) && item.previousDays.length) {
      return item.previousDays.map((day) => ({
        date: String(day.date || ''),
        value: Number.isFinite(Number(day.value)) ? Number(day.value) : null,
        valueText: String(day.valueText || '缺记录')
      }))
    }
    const start = new Date(`${item.date}T00:00:00`).getTime()
    if (!Number.isFinite(start)) return []
    return Array.from({ length: 5 }, (_, index) => {
      const time = start - (5 - index) * 86400000
      const date = new Date(time).toISOString().slice(0, 10)
      return {
        date,
        value: null,
        valueText: '无产奶记录'
      }
    })
  }
  const selectedMissingBlocks = computed<MissingReviewBlock[]>(() =>
    selectedMissingItems.value.map((item, index) => ({
      index,
      item,
      previousDays: previousDaysForItem(item),
      summaryRangeText: summaryRangeText(item)
    }))
  )
  const {
    visibleItems: visibleSelectedMissingBlocks,
    startIndex: selectedMissingBlockStartIndex,
    endIndex: selectedMissingBlockEndIndex,
    totalCount: selectedMissingBlockTotalCount,
    handleScroll: onSelectedMissingScroll,
    handleWheel: onSelectedMissingWheel
  } = useLazyRenderWindow(selectedMissingBlocks, {
    initialCount: 6,
    batchSize: 6,
    mode: 'fixed-window'
  })
  const groupedSummaryContainerRef = ref<HTMLElement | null>(null)
  const {
    visibleItems: visibleGroupedSummary,
    startIndex: groupedSummaryStartIndex,
    endIndex: groupedSummaryEndIndex,
    totalCount: groupedSummaryTotalCount,
    handleScroll: onGroupedSummaryScroll,
    handleWheel: onGroupedSummaryWheel
  } = useLazyRenderWindow(groupedSummary, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })
  const selectedCowCurve = computed(() => {
    const card = selectedCowCard.value
    if (!card) return []
    const previousMap = new Map<string, PreviousMilkDay>()
    selectedMissingItems.value.forEach((item) => {
      previousDaysForItem(item).forEach((day) => {
        if (!previousMap.has(day.date)) previousMap.set(day.date, day)
      })
    })
    const previous = Array.from(previousMap.values())
      .sort((left, right) => left.date.localeCompare(right.date))
      .slice(-8)
      .map((day) => ({
        key: `previous-${day.date}`,
        label: day.date.slice(5),
        value: day.value,
        valueText: day.valueText,
        missing: false,
        kind: 'existing' as const
      }))
    const missingPoints = selectedMissingItems.value.map((item) => {
      const targetValue = editableValues[item.id] ?? item.recommendedMilk
      return {
        key: item.id,
        label:
          item.missingKind === 'summary_only'
            ? `${item.date.slice(5)} 汇总`
            : `${item.date.slice(5)} ${item.expectedShift}`,
        value: targetValue,
        valueText: `${targetValue.toFixed(1)} kg`,
        missing: true,
        kind: item.missingKind
      }
    })
    const points = [...previous, ...missingPoints]
    const max = Math.max(1, ...points.map((point) => Number(point.value || 0)))
    return points.map((point, index) => ({
      ...point,
      x: points.length <= 1 ? 50 : Math.round((index / (points.length - 1)) * 92 + 4),
      y: Math.round(94 - (Number(point.value || 0) / max) * 76)
    }))
  })
  const selectedCurvePolyline = computed(() =>
    selectedCowCurve.value
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      .map((point) => `${point.x},${point.y}`)
      .join(' ')
  )

  onMounted(async () => {
    const options = await getMilkShiftOptions().catch(() => [])
    if (options.length) {
      shiftOptions.value = options.map((item) => item.value)
      expectedShifts.value = expectedShifts.value.filter((shift) =>
        shiftOptions.value.includes(shift)
      )
      if (!expectedShifts.value.length) expectedShifts.value = shiftOptions.value.slice(0, 2)
    }
    await loadReview()
  })

  async function loadReview() {
    loading.value = true
    try {
      const [startDate, endDate] = dateRange.value || []
      const result: MilkMissingReviewResult = await getMilkMissingReview({
        startDate,
        endDate,
        period: period.value,
        expectedShifts: expectedShifts.value
      })
      review.value = result
      Object.keys(editableValues).forEach((key) => delete editableValues[key])
      result.items.forEach((item) => {
        editableValues[item.id] = item.recommendedMilk
      })
      selectedRows.value = []
      selectedCowCardKey.value = ''
      selectedMissingItemId.value = ''
      ElMessage.success(`已生成 ${result.summary.pendingCount} 条待确认缺失记录`)
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : '生成泌乳缺失复核失败')
    } finally {
      loading.value = false
    }
  }

  async function confirmSelected() {
    await confirmItems(selectedRows.value)
  }

  async function confirmCurrentCow() {
    await confirmItems(selectedMissingItems.value)
  }

  async function confirmSingleItem(item: MilkMissingReviewItem) {
    await confirmItems([item])
  }

  async function confirmItems(items: MilkMissingReviewItem[]) {
    if (!items.length) {
      ElMessage.warning('请先选择需要确认填补的缺失记录')
      return
    }
    confirming.value = true
    try {
      const operatorName = String(userStore.getUserInfo?.userName || '泌乳复核员')
      const [startDate, endDate] = dateRange.value || []
      const selectedValues = Object.fromEntries(
        items.map((item) => [item.id, editableValues[item.id] ?? item.recommendedMilk])
      )
      const invalidItems = items.filter((item) => {
        const value = Number(selectedValues[item.id])
        return !Number.isFinite(value) || value <= 0
      })
      if (invalidItems.length) {
        const names = invalidItems
          .slice(0, 3)
          .map((item) => `${item.cowNumber} ${item.date} ${item.expectedShift}`)
          .join('、')
        ElMessage.warning(
          `${names}${invalidItems.length > 3 ? '等' : ''}需要先填写大于 0 的确认产奶量`
        )
        return
      }
      const payload = {
        itemIds: items.map((item) => item.id),
        values: selectedValues,
        operatorName,
        startDate,
        endDate,
        expectedShifts: expectedShifts.value
      }
      const result = await confirmMilkMissingReview(payload)
      ElMessage.success(`已确认填补 ${result.confirmed} 条产奶记录`)
      await loadReview()
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : '确认填补失败')
    } finally {
      confirming.value = false
    }
  }

  function onSelectionChange(rows: MilkMissingReviewItem[]) {
    selectedRows.value = rows
  }

  function selectCowCard(card: ReviewCowCard) {
    selectedCowCardKey.value = card.key
    selectedRows.value = [...card.items]
    selectedMissingItemId.value = card.items[0]?.id || ''
  }

  function handleCowKeywordSelect(item: { cowNumber: string; cowId?: string }) {
    keyword.value = item.cowNumber
    const card =
      reviewCowCards.value.find((row) => row.cowId === item.cowId) ||
      reviewCowCards.value.find((row) => row.cowNumber === item.cowNumber)
    if (card) selectCowCard(card)
  }

  function selectMissingItem(item: MilkMissingReviewItem) {
    selectedMissingItemId.value = item.id
    selectedRows.value = [item]
  }

  function methodLabel(method: MilkMissingReviewItem['recommendationMethod']) {
    const map: Record<MilkMissingReviewItem['recommendationMethod'], string> = {
      lactation_305_curve: '305天泌乳曲线',
      curve_interpolation: '同牛曲线插值',
      recent_average: '近期平均',
      neighbor_average: '邻近均值',
      summary_profile: '汇总资料拆分',
      cow_average: '个体均值',
      manual_required: '人工核对'
    }
    return map[method]
  }

  function missingKindLabel(kind: MilkMissingReviewItem['missingKind']) {
    const map: Record<MilkMissingReviewItem['missingKind'], string> = {
      day: '缺整日',
      shift: '缺班次',
      empty_value: '空产量',
      summary_only: '汇总待拆分'
    }
    return map[kind]
  }

  function missingKindTag(kind: MilkMissingReviewItem['missingKind']) {
    if (kind === 'summary_only') return 'info'
    if (kind === 'empty_value') return 'warning'
    return kind === 'day' ? 'warning' : 'success'
  }

  function confidenceLabel(confidence: MilkMissingReviewItem['confidence']) {
    return confidence === 'high' ? '高' : confidence === 'medium' ? '中' : '低'
  }

  function confidenceTag(confidence: MilkMissingReviewItem['confidence']) {
    return confidence === 'high' ? 'success' : confidence === 'medium' ? 'warning' : 'info'
  }

  function normalizeDate(value: unknown) {
    const text = String(value || '').trim()
    if (!text) return ''
    const time = new Date(text).getTime()
    return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : text.slice(0, 10)
  }

  function average(values: number[]) {
    const valid = values.filter(Number.isFinite)
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0
  }

  function summaryRangeText(item: MilkMissingReviewItem) {
    if (item.missingKind !== 'summary_only') return ''
    const days = Math.max(1, Number(item.summaryDays || 1))
    const start = normalizeDate(item.date || item.lactationStartDate)
    const startTime = new Date(`${start}T00:00:00`).getTime()
    if (!Number.isFinite(startTime)) return `建议拆分 ${days} 天日明细`
    const end = new Date(startTime + (days - 1) * 86400000).toISOString().slice(0, 10)
    return `${start} 至 ${end}，共 ${days} 天`
  }
</script>

<style scoped lang="scss">
  .fc-metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 14px;
  }

  .filter-grid {
    display: grid;
    grid-template-columns:
      minmax(240px, 1.2fr) minmax(180px, 0.8fr) minmax(140px, 0.5fr)
      minmax(180px, 0.8fr) auto;
    gap: 12px;
    align-items: center;
  }

  .filter-grid > * {
    min-width: 0;
  }

  .filter-grid :deep(.cow-number-autocomplete),
  .filter-grid :deep(.el-select),
  .filter-grid :deep(.el-input),
  .filter-grid :deep(.el-date-editor) {
    width: 100%;
    min-width: 0;
  }

  .date-range {
    width: 100%;
  }

  .review-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 340px;
    gap: 18px;
    align-items: stretch;
    --lactation-list-height: 620px;
  }

  .cow-review-layout {
    display: grid;
    grid-template-columns: minmax(280px, 0.72fr) minmax(420px, 1.28fr);
    gap: 16px;
    align-items: stretch;
    --lactation-review-height: 642px;
  }

  .cow-review-layout > :deep(.fc-panel),
  .review-layout > :deep(.fc-panel) {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .review-cow-panel,
  .review-detail-panel {
    display: flex;
    flex-direction: column;
    height: var(--lactation-review-height);
    min-height: 0;
  }

  .review-cow-panel .review-cow-card-viewport,
  .review-detail-panel .cow-review-detail {
    flex: 1 1 auto;
    min-height: 0;
  }

  .review-list-panel,
  .review-summary-panel {
    display: flex;
    flex-direction: column;
    height: calc(var(--lactation-list-height) + 78px);
    min-height: 0;
  }

  .review-list-panel .table-scroll,
  .review-summary-panel .summary-stack {
    flex: 1 1 auto;
    min-height: 0;
  }

  .review-cow-card-viewport,
  .review-cow-card-grid,
  .cow-review-detail,
  .missing-block-list,
  .previous-days-grid {
    display: grid;
    gap: 12px;
  }

  .review-cow-card-viewport {
    height: 100%;
    max-height: none;
    overflow-y: auto;
    padding: 2px 6px 2px 2px;
    overscroll-behavior: contain;
  }

  .review-cow-card-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .review-cow-card {
    display: grid;
    gap: 10px;
    min-width: 0;
    min-height: 224px;
    overflow: hidden;
    padding: 12px;
    cursor: pointer;
    border-left: 4px solid var(--fluent-amber);
    transition:
      border-color 0.18s ease,
      box-shadow 0.18s ease,
      background-color 0.18s ease,
      transform 0.18s ease;
  }

  .review-cow-card:hover,
  .review-cow-card:focus-visible,
  .review-cow-card.is-active {
    outline: none;
    background: rgb(var(--fluent-primary-rgb) / 5%);
    border-color: rgb(var(--fluent-primary-rgb) / 38%);
    transform: var(--fluent-card-hover-transform);
  }

  .review-cow-head {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
    min-width: 0;
  }

  .review-cow-head > div {
    min-width: 0;
  }

  .review-cow-head span,
  .review-cow-metrics span,
  .selected-cow-summary span,
  .missing-block-head span,
  .recommendation-row span,
  .previous-days-grid span {
    color: var(--fluent-muted);
    font-size: 12px;
    font-weight: 680;
  }

  .review-cow-head h3 {
    margin: 5px 0 0;
    color: var(--fluent-text);
    font-size: 17px;
    font-weight: 780;
  }

  .review-cow-head p,
  .recommendation-text {
    margin: 6px 0 0;
    color: var(--fluent-text-soft);
    font-size: 13px;
    line-height: 1.5;
  }

  .review-cow-head span,
  .review-cow-head h3,
  .review-cow-head p {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .review-cow-metrics,
  .selected-cow-summary,
  .previous-days-grid {
    grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  }

  .review-cow-metrics div,
  .previous-days-grid article,
  .selected-cow-summary div {
    min-width: 0;
    padding: 9px;
    background: #f8fafc;
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius-sm);
  }

  .review-cow-metrics strong,
  .selected-cow-summary strong,
  .previous-days-grid strong {
    display: block;
    margin-top: 4px;
    color: var(--fluent-text);
    font-size: 14px;
    font-weight: 760;
    overflow-wrap: anywhere;
  }

  .review-empty-diagnostics {
    display: grid;
    gap: 10px;
  }

  .diagnostic-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 8px;
  }

  .diagnostic-grid span {
    padding: 8px 10px;
    color: var(--fluent-text-soft);
    font-size: 12px;
    font-weight: 680;
    background: var(--fluent-surface-subtle);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius-sm);
  }

  .curve-panel {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 12px;
  }

  .curve-toolbar,
  .curve-legend,
  .lazy-list-foot {
    display: flex;
    gap: 10px;
    align-items: center;
    justify-content: space-between;
    min-width: 0;
  }

  .curve-toolbar span,
  .lazy-list-foot span {
    color: var(--fluent-muted);
    font-size: 12px;
    font-weight: 700;
  }

  .curve-toolbar strong {
    color: var(--fluent-text);
    font-size: 13px;
    font-weight: 780;
  }

  .curve-chart {
    min-width: 0;
    height: 168px;
    padding: 10px;
    overflow-x: auto;
  }

  .curve-chart svg {
    width: max(100%, 720px);
    height: 100%;
  }

  .curve-line {
    fill: none;
    stroke: rgb(var(--fluent-primary-rgb) / 76%);
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.4;
    vector-effect: non-scaling-stroke;
  }

  .curve-guide {
    stroke: rgb(36 36 36 / 8%);
    stroke-width: 0.6;
    vector-effect: non-scaling-stroke;
  }

  .curve-dot {
    fill: rgb(var(--fluent-primary-rgb));
    stroke: #fff;
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }

  .curve-dot.is-missing {
    fill: rgb(209 52 56);
  }

  .curve-dot.kind-shift {
    fill: rgb(16 124 16);
  }

  .curve-dot.kind-summary_only {
    fill: rgb(0 120 212);
  }

  .curve-label-row {
    display: flex;
    gap: 8px;
    min-width: 0;
    padding-bottom: 2px;
    overflow-x: auto;
  }

  .curve-label-row span {
    display: grid;
    flex: 0 0 86px;
    gap: 2px;
    color: var(--fluent-muted);
    font-size: 11px;
    line-height: 1.25;
  }

  .curve-label-row strong {
    overflow: hidden;
    color: var(--fluent-text);
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .curve-legend {
    flex-wrap: wrap;
    justify-content: flex-start;
  }

  .curve-legend span {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    color: var(--fluent-text-soft);
    font-size: 12px;
    font-weight: 680;
  }

  .curve-legend i {
    width: 9px;
    height: 9px;
    border-radius: 999px;
  }

  .legend-existing {
    background: rgb(var(--fluent-primary-rgb));
  }

  .legend-day {
    background: rgb(209 52 56);
  }

  .legend-shift {
    background: rgb(16 124 16);
  }

  .legend-summary {
    background: rgb(0 120 212);
  }

  .lazy-list-foot {
    padding: 10px 2px 2px;
    border-top: 1px dashed var(--fluent-border);
  }

  .table-foot {
    position: sticky;
    left: 0;
    min-width: 340px;
    background: var(--fluent-surface);
  }

  .missing-block-list {
    max-height: 284px;
    overflow-y: auto;
    padding: 2px 6px 2px 2px;
    overscroll-behavior: contain;
  }

  .missing-review-block {
    display: grid;
    grid-template-columns: minmax(190px, 0.72fr) minmax(250px, 1fr) minmax(220px, 0.82fr);
    gap: 12px;
    align-items: stretch;
    min-width: 0;
    min-height: 206px;
    padding: 12px;
    cursor: pointer;
    border-left: 4px solid var(--fluent-amber);
    transition:
      border-color 0.18s ease,
      box-shadow 0.18s ease,
      background-color 0.18s ease,
      transform 0.18s ease;
  }

  .missing-review-block:hover,
  .missing-review-block:focus-visible,
  .missing-review-block.is-active {
    outline: none;
    background: rgb(var(--fluent-primary-rgb) / 5%);
    border-color: rgb(var(--fluent-primary-rgb) / 38%);
    transform: var(--fluent-card-hover-transform);
  }

  .missing-block-head,
  .recommendation-row {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
    min-width: 0;
  }

  .missing-block-head {
    display: grid;
    grid-template-columns: 1fr;
    align-content: start;
    padding-right: 4px;
  }

  .missing-block-head h4 {
    margin: 5px 0 0;
    overflow: hidden;
    color: var(--fluent-text);
    font-size: 16px;
    font-weight: 780;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .missing-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: flex-start;
  }

  .missing-meta-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin: 0;
  }

  .missing-meta-grid div {
    min-width: 0;
    padding: 10px;
    background: rgb(255 255 255 / 54%);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius-sm);
  }

  .missing-meta-grid dt {
    color: var(--fluent-muted);
    font-size: 12px;
    font-weight: 680;
  }

  .missing-meta-grid dd {
    margin: 5px 0 0;
    overflow: hidden;
    color: var(--fluent-text);
    font-size: 13px;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .summary-split-note {
    display: grid;
    grid-column: 1 / -1;
    gap: 4px;
    padding: 10px 12px;
    color: var(--fluent-text-soft);
    font-size: 13px;
    background: rgb(var(--fluent-primary-rgb) / 8%);
    border: 1px solid rgb(var(--fluent-primary-rgb) / 18%);
    border-radius: var(--fluent-radius-sm);
  }

  .summary-split-note strong {
    color: var(--fluent-text);
    font-size: 14px;
  }

  .recommendation-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-content: space-between;
    justify-items: stretch;
  }

  .recommendation-row .el-button {
    width: 100%;
  }

  .recommendation-row > div {
    display: grid;
    gap: 6px;
  }

  .recommendation-text {
    grid-column: 1 / -1;
    padding: 8px 10px;
    margin: 0;
    background: rgb(248 250 252 / 74%);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius-sm);
    display: -webkit-box;
    max-height: 56px;
    overflow: hidden;
    color: var(--fluent-text-soft);
    font-size: 12px;
    line-height: 1.45;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .previous-days-grid {
    grid-template-columns: 1fr;
    max-height: 154px;
    overflow: auto;
  }

  .table-scroll {
    max-width: 100%;
    height: 100%;
    overflow: auto;
  }

  .value-input {
    width: 138px;
  }

  .method-cell {
    display: grid;
    gap: 4px;
    line-height: 1.35;
  }

  .method-cell span {
    color: var(--fluent-text);
    font-weight: 700;
  }

  .method-cell small {
    color: var(--fluent-muted);
  }

  .summary-stack {
    display: grid;
    gap: 12px;
    height: 100%;
    overflow: auto;
    align-content: start;
  }

  .review-card {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    min-width: 0;
    padding: 14px;
    transition: border-color 0.18s ease;
  }

  .review-card:hover {
    background: rgb(var(--fluent-primary-rgb) / 5%);
    border-color: rgb(var(--fluent-primary-rgb) / 34%);
  }

  .review-card span,
  .review-card strong {
    display: block;
  }

  .review-card span {
    color: var(--fluent-muted);
    font-size: 12px;
    font-weight: 650;
  }

  .review-card strong {
    margin-top: 4px;
    color: var(--fluent-text);
    font-size: 16px;
    font-weight: 760;
  }

  @media (max-width: 1200px) {
    .fc-metric-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .filter-grid,
    .cow-review-layout,
    .review-layout {
      grid-template-columns: 1fr;
    }

    .review-cow-card-viewport,
    .missing-block-list {
      height: auto;
      max-height: none;
    }

    .review-cow-card-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .missing-review-block {
      grid-template-columns: 1fr;
      min-height: auto;
    }

    .table-scroll,
    .summary-stack {
      height: auto;
      max-height: 620px;
    }

    .review-cow-panel,
    .review-detail-panel,
    .review-list-panel,
    .review-summary-panel {
      min-height: 0;
    }

  }

  @media (max-width: 760px) {
    .review-cow-card-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 640px) {
    .fc-metric-grid {
      grid-template-columns: 1fr;
    }

    .selected-cow-summary,
    .review-cow-metrics,
    .previous-days-grid,
    .missing-meta-grid {
      grid-template-columns: 1fr;
    }

    .missing-block-head,
    .recommendation-row,
    .curve-toolbar {
      display: grid;
    }

    .missing-review-block {
      grid-template-columns: 1fr;
    }
  }
</style>
