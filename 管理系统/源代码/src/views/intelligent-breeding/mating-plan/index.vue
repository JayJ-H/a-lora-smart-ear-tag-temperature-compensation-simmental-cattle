<template>
  <FcPageShell
    title="选配规则方案排行榜"
    status-label="方案状态"
    :status-value="statusText"
    primary-action-label="生成本轮选配"
    primary-action-icon="ri:git-merge-line"
    secondary-action-label="刷新方案"
    secondary-action-icon="ri:refresh-line"
    @primary-action="announcePlan"
    @secondary-action="loadData"
  >
    <template #metrics>
      <section class="fc-metric-grid">
        <FcMetricTile
          label="候选配对"
          :value="rankedPairs.length"
          note="当前选配方向下的排行配对"
          icon="ri:git-merge-line"
        />
        <FcMetricTile
          label="高兼容配对"
          :value="highCompatibility.length"
          note="兼容度 >= 85"
          icon="ri:medal-line"
          tone="teal"
        />
        <FcMetricTile
          label="近交复核"
          :value="riskRows.length"
          note="需要育种审核的系谱风险配对"
          icon="ri:shield-flash-line"
          tone="warning"
        />
        <FcMetricTile
          label="平均兼容度"
          :value="averageCompatibility"
          unit="分"
          note="rule_based 输出，不是后代 EBV 预测"
          icon="ri:line-chart-line"
          tone="info"
        />
      </section>
    </template>

    <FcPanel title="算法与追溯摘要">
      <div class="trace-grid">
        <section class="trace-block">
          <span>算法类型</span>
          <strong>{{ matingAlgorithm.algorithmType }}</strong>
          <p>{{ matingAlgorithm.summary }}</p>
        </section>
        <section class="trace-block">
          <span>输入快照</span>
          <strong
            >{{ traceSummary.inputSnapshot.femaleCandidateSet.count }} 头母牛 /
            {{ traceSummary.inputSnapshot.bullCandidateSet.count }} 头公牛</strong
          >
          <p
            >搜索空间 {{ traceSummary.inputSnapshot.pairSearchSpace }} 组；输出
            {{ traceSummary.inputSnapshot.outputCount }} 组。</p
          >
        </section>
        <section class="trace-block">
          <span>规则权重</span>
          <strong
            >母牛 {{ traceSummary.weights.femaleBaselineIndex }} / 公牛
            {{ traceSummary.weights.bullBaselineIndex }} / 风险惩罚
            {{ traceSummary.weights.pedigreeOverlapPenalty }}</strong
          >
          <p>{{ matingAlgorithm.methodologyNote }}</p>
        </section>
      </div>
    </FcPanel>

    <FcPanel title="选配方向">
      <div class="direction-grid">
        <button
          v-for="item in matingDirections"
          :key="item.key"
          class="direction-card"
          :class="{ active: activeDirectionKey === item.key }"
          type="button"
          @click="activeDirectionKey = item.key"
        >
          <strong>{{ item.name }}</strong>
          <span>{{ item.description }}</span>
          <small
            >{{ traitLabel(item.primaryTrait) }} {{ directionText(item.primaryDirection) }} ·
            {{ traitLabel(item.secondaryTrait) }}
            {{ directionText(item.secondaryDirection) }}</small
          >
        </button>
        <label class="filter-check">
          <ElSwitch v-model="onlyLowRisk" />
          <span>只看低近交风险配对</span>
        </label>
      </div>
    </FcPanel>

    <FcPanel title="选配方案排行榜">
      <div
        ref="pairGridContainerRef"
        class="pair-grid-viewport"
        @scroll.passive="onPairGridScroll"
        @wheel.passive="onPairGridWheel"
      >
        <section class="pair-grid">
          <article
            v-for="item in visibleRankedPairs"
            :key="pairKey(item)"
            class="pair-card"
            :class="{ 'is-active': selectedPairKey === pairKey(item) }"
            role="button"
            tabindex="0"
            @click="selectPair(item)"
            @keydown.enter.prevent="selectPair(item)"
            @keydown.space.prevent="selectPair(item)"
          >
            <div class="card-head">
              <div>
                <span class="rank">#{{ item.rank }}</span>
                <h3
                  >{{ item.female.cow.cowNumber }} × {{ item.bull?.cow.cowNumber || '待匹配' }}</h3
                >
                <p>{{ activeDirection.name }} · {{ item.reason }}</p>
              </div>
              <div class="value-block">
                <strong>{{ item.compatibility }}</strong>
                <span>兼容度</span>
              </div>
            </div>

            <div class="algorithm-strip">
              <ElTag type="info">{{ item.algorithmType }}</ElTag>
              <span>{{ matingAlgorithm.label }}</span>
            </div>

            <div class="pair-body">
              <div>
                <small>候选母牛</small>
                <b>{{ item.female.cow.cowNumber }}</b>
                <span
                  >基线分 {{ item.female.score }} · 泌乳 {{ item.female.milkScore }} · 组学证据
                  {{ item.female.genomicScore }}</span
                >
              </div>
              <div>
                <small>推荐公牛</small>
                <b>{{ item.bull?.cow.cowNumber || '-' }}</b>
                <span
                  >基线分 {{ item.bull?.score || 0 }} · 系谱完整度
                  {{ item.bull?.pedigreeScore || 0 }} · 后裔
                  {{ item.bull?.breedingEvents || 0 }}</span
                >
              </div>
            </div>

            <div class="trait-strip">
              <span>配对基线指数 {{ item.breedingValue }}</span>
              <ElTag :type="item.inbreedingRisk ? 'danger' : 'success'">
                {{ item.inbreedingRisk ? '近交复核' : '基线低风险' }}
              </ElTag>
            </div>
            <p class="methodology-note"> {{ item.riskAssessment?.label }}：{{ item.methodologyNote }} </p>
          </article>
        </section>
        <div v-if="rankedPairs.length > visibleRankedPairs.length" class="load-more-row">
          <ElButton size="small" plain @click="loadMoreRankedPairs()">
            继续加载 {{ visibleRankedPairs.length }}/{{ rankedPairs.length }}
          </ElButton>
        </div>
      </div>
    </FcPanel>

    <ElDialog v-model="pairDetailVisible" title="选配方案详情" width="940px">
      <div v-if="selectedPairDetail" class="pair-detail-grid">
        <section class="pair-detail-card is-main">
          <div>
            <span>候选配对</span>
            <h3
              >{{ selectedPairDetail.item.female.cow.cowNumber }} ×
              {{ selectedPairDetail.item.bull?.cow.cowNumber || '待匹配' }}</h3
            >
            <p>{{ activeDirection.name }} · {{ selectedPairDetail.item.reason }}</p>
          </div>
          <strong>{{ selectedPairDetail.item.compatibility }}</strong>
        </section>

        <section
          class="pair-detail-card"
          v-for="metric in selectedPairDetail.metrics"
          :key="metric.label"
        >
          <span>{{ metric.label }}</span>
          <strong>{{ metric.value }}</strong>
          <p>{{ metric.note }}</p>
        </section>
      </div>

      <section v-if="selectedPairDetail" class="pair-parent-grid">
        <article class="pair-detail-card">
          <span>候选母牛</span>
          <h3>{{ selectedPairDetail.item.female.cow.cowNumber }}</h3>
          <p
            >基线分 {{ selectedPairDetail.item.female.score }} · 泌乳
            {{ selectedPairDetail.item.female.milkScore }} · 组学证据
            {{ selectedPairDetail.item.female.genomicScore }}</p
          >
        </article>
        <article class="pair-detail-card">
          <span>推荐公牛</span>
          <h3>{{ selectedPairDetail.item.bull?.cow.cowNumber || '-' }}</h3>
          <p
            >基线分 {{ selectedPairDetail.item.bull?.score || 0 }} · 系谱完整度
            {{ selectedPairDetail.item.bull?.pedigreeScore || 0 }} · 后裔
            {{ selectedPairDetail.item.bull?.breedingEvents || 0 }}</p
          >
        </article>
      </section>
    </ElDialog>
  </FcPageShell>
</template>

<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { ElMessage } from 'element-plus'
  import FcPageShell from '@/components/business/fluent-console/FcPageShell.vue'
  import FcMetricTile from '@/components/business/fluent-console/FcMetricTile.vue'
  import FcPanel from '@/components/business/fluent-console/FcPanel.vue'
  import { useLazyGridRenderWindow } from '@/hooks'
  import {
    average,
    buildBullCandidateRows,
    buildFemaleCandidateRows,
    loadBreedingDecisionSnapshot,
    type CandidateScoreRow,
    type PlatformSnapshot
  } from '@/views/breeding-platform/platform-data'
  import {
    buildMatingRankings,
    getTraitLabel,
    loadBreedingTraitOptions,
    matingDirections,
    traitOptions as fallbackTraitOptions,
    type SortDirection,
    type TraitOption
  } from '../shared'
  import {
    matingCowIds,
    matingRankingSnapshot,
    persistBreedingDecisionRun
  } from '../decision-audit'
  import { MATING_RULE_ALGORITHM, buildMatingTraceSummary } from '../algorithm-metadata'

  const snapshot = ref<PlatformSnapshot>({
    cows: [],
    sensors: [],
    milkRecords: [],
    breedingRecords: [],
    alerts: [],
    healthScores: []
  })
  const femaleRows = ref<CandidateScoreRow[]>([])
  const bullRows = ref<CandidateScoreRow[]>([])
  const traitOptions = ref<TraitOption[]>(fallbackTraitOptions)
  const activeDirectionKey = ref('milk-yield')
  const onlyLowRisk = ref(false)
  const selectedPairKey = ref('')
  const pairDetailVisible = ref(false)
  const matingAlgorithm = MATING_RULE_ALGORITHM

  const activeDirection = computed(
    () =>
      matingDirections.find((item) => item.key === activeDirectionKey.value) || matingDirections[0]
  )
  const rankedPairs = computed(() =>
    buildMatingRankings(femaleRows.value, bullRows.value, activeDirection.value, onlyLowRisk.value)
  )
  const traceSummary = computed(() =>
    buildMatingTraceSummary({
      rows: rankedPairs.value,
      femaleRows: femaleRows.value,
      bullRows: bullRows.value,
      direction: activeDirection.value,
      onlyLowRisk: onlyLowRisk.value
    })
  )
  const {
    containerRef: pairGridContainerRef,
    visibleItems: visibleRankedPairs,
    loadMore: loadMoreRankedPairs,
    handleScroll: onPairGridScroll,
    handleWheel: onPairGridWheel
  } = useLazyGridRenderWindow(rankedPairs, {
    rowCount: 2,
    minItemWidth: 420,
    gap: 14,
    fallbackColumns: 2,
    mode: 'fixed-window'
  })
  const highCompatibility = computed(() =>
    rankedPairs.value.filter((row) => row.compatibility >= 85)
  )
  const riskRows = computed(() => rankedPairs.value.filter((row) => row.inbreedingRisk))
  const averageCompatibility = computed(() =>
    Math.round(average(rankedPairs.value.map((row) => row.compatibility)))
  )
  const statusText = computed(() => {
    if (!rankedPairs.value.length) return '待生成'
    return riskRows.value.length ? '含复核项' : '可进入执行'
  })
  const selectedPairDetail = computed(() => {
    const item = rankedPairs.value.find((row) => pairKey(row) === selectedPairKey.value)
    if (!item) return null
    return {
      item,
      metrics: [
        {
          label: '兼容度',
          value: item.compatibility,
          note: '综合目标方向、双亲基线指数、谱系编号重叠惩罚和低风险加分计算。'
        },
        {
          label: '配对基线指数',
          value: item.breedingValue,
          note: '规则加权分，不是后代 EBV 或 GBLUP 预测。'
        },
        {
          label: '近交风险',
          value: item.inbreedingRisk ? '需复核' : '基线低风险',
          note: item.methodologyNote
        },
        {
          label: '选配方向',
          value: activeDirection.value.name,
          note: `${traitLabel(activeDirection.value.primaryTrait)} ${directionText(activeDirection.value.primaryDirection)}，${traitLabel(activeDirection.value.secondaryTrait)} ${directionText(activeDirection.value.secondaryDirection)}。`
        }
      ]
    }
  })

  const directionText = (direction: SortDirection) => (direction === 'desc' ? '高排' : '低排')
  const traitLabel = (trait: string) => getTraitLabel(trait, traitOptions.value)
  const pairKey = (item: { female: CandidateScoreRow; bull?: CandidateScoreRow | null }) =>
    `${item.female.cow.id}-${item.bull?.cow.id || 'none'}`

  const selectPair = (item: { female: CandidateScoreRow; bull?: CandidateScoreRow | null }) => {
    selectedPairKey.value = pairKey(item)
    pairDetailVisible.value = true
  }

  const announcePlan = async () => {
    try {
      const rows = rankedPairs.value
      const traceabilitySummary = traceSummary.value
      const runId = await persistBreedingDecisionRun({
        runType: 'mating_plan',
        title: '本轮规则选配方案排行榜',
        algorithmMetadata: matingAlgorithm,
        parameters: {
          directionKey: activeDirection.value.key,
          directionName: activeDirection.value.name,
          primaryTrait: activeDirection.value.primaryTrait,
          primaryDirection: activeDirection.value.primaryDirection,
          secondaryTrait: activeDirection.value.secondaryTrait,
          secondaryDirection: activeDirection.value.secondaryDirection,
          onlyLowRisk: onlyLowRisk.value,
          algorithmType: matingAlgorithm.algorithmType,
          algorithmVersion: matingAlgorithm.algorithmVersion,
          weights: traceabilitySummary.weights,
          rowCount: rows.length
        },
        resultSnapshot: {
          traceabilitySummary,
          rankedPairs: matingRankingSnapshot(rows),
          topPairs: rows.slice(0, 5).map((item) => ({
            rank: item.rank,
            femaleCowNumber: item.female.cow.cowNumber,
            bullCowNumber: item.bull?.cow.cowNumber || '',
            compatibility: item.compatibility
          }))
        },
        cowIds: matingCowIds(rows),
        sourceRecordIds: {
          milk_records: snapshot.value.milkRecords
            .map((row) => String(row.id || ''))
            .filter(Boolean),
          breeding_records: snapshot.value.breedingRecords
            .map((row) => String(row.id || ''))
            .filter(Boolean),
          phenotype_records: (snapshot.value.phenotypeRecords || [])
            .map((row) => String(row.id || ''))
            .filter(Boolean),
          omics_samples: (snapshot.value.omicsSamples || [])
            .map((row) => String(row.id || ''))
            .filter(Boolean),
          breeding_analyses: (snapshot.value.breedingAnalyses || [])
            .map((row) => String(row.id || ''))
            .filter(Boolean)
        }
      })
      ElMessage.success(`已生成 ${rows.length} 组选配方案排行榜，运行记录 ${runId}`)
    } catch (error) {
      ElMessage.error('选配方案运行记录写入失败')
      console.error(error)
    }
  }

  const loadData = async () => {
    const [loadedSnapshot, loadedTraits] = await Promise.all([
      loadBreedingDecisionSnapshot(),
      loadBreedingTraitOptions()
    ])
    snapshot.value = loadedSnapshot
    traitOptions.value = loadedTraits.length ? loadedTraits : fallbackTraitOptions
    femaleRows.value = buildFemaleCandidateRows(snapshot.value)
    bullRows.value = buildBullCandidateRows(snapshot.value)
  }

  loadData()
</script>

<style scoped lang="scss">
  .fc-metric-grid,
  .trace-grid,
  .direction-grid,
  .pair-grid {
    display: grid;
    gap: 14px;
  }

  .fc-metric-grid {
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  }

  .trace-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .direction-grid {
    grid-template-columns: repeat(auto-fit, minmax(156px, 1fr));
    align-items: stretch;
  }

  .trace-block {
    display: grid;
    gap: 8px;
    min-width: 0;
    padding: 14px;
    border: 1px solid rgba(15, 23, 42, 0.08);
    border-radius: 8px;
    background: #f8fafc;
  }

  .trace-block span,
  .algorithm-strip span,
  .methodology-note {
    color: #64748b;
    font-size: 12px;
  }

  .trace-block strong {
    color: #111827;
    font-size: 15px;
    line-height: 1.4;
  }

  .direction-card {
    display: grid;
    gap: 6px;
    padding: 11px 12px;
    text-align: left;
    border: 1px solid rgba(15, 23, 42, 0.08);
    border-radius: 8px;
    background: #fff;
    cursor: pointer;
  }

  .direction-card.active {
    border-color: rgba(37, 99, 235, 0.55);
    box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.18);
  }

  .direction-card strong {
    color: #111827;
    font-size: 14px;
  }

  .direction-card span,
  .direction-card small {
    color: #64748b;
    line-height: 1.5;
  }

  .filter-check {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px;
    align-items: center;
    padding: 12px 14px;
    border: 1px solid rgba(15, 23, 42, 0.08);
    border-radius: 8px;
    background: #fff;
    color: #52616f;
  }

  .pair-grid {
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  }

  .pair-grid-viewport {
    max-height: min(76vh, 760px);
    overflow: auto;
    padding: 2px 4px 10px;
  }

  .pair-card {
    display: grid;
    gap: 11px;
    padding: 12px;
    border: 1px solid rgba(15, 23, 42, 0.08);
    border-left: 4px solid #7c3aed;
    border-radius: 8px;
    background: #fff;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
    cursor: pointer;
    transition:
      border-color 180ms cubic-bezier(0.16, 1, 0.3, 1),
      box-shadow 180ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .pair-card:hover,
  .pair-card:focus-visible,
  .pair-card.is-active:hover,
  .pair-card.is-active:focus-visible {
    outline: none;
    border-color: rgba(124, 58, 237, 0.48);
    box-shadow: inset 0 0 0 1px rgba(124, 58, 237, 0.16) !important;
  }

  .pair-card.is-active {
    border-color: rgba(124, 58, 237, 0.48);
    box-shadow: inset 0 0 0 1px rgba(124, 58, 237, 0.16);
  }

  .card-head,
  .trait-strip {
    display: flex;
    justify-content: space-between;
    gap: 14px;
  }

  .algorithm-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .rank {
    color: #7c3aed;
    font-weight: 800;
  }

  h3 {
    margin: 4px 0;
    color: #111827;
    font-size: 17px;
  }

  p {
    margin: 0;
    color: #64748b;
    line-height: 1.6;
  }

  .value-block {
    min-width: 82px;
    text-align: right;
  }

  .value-block strong {
    display: block;
    color: #7c3aed;
    font-size: 24px;
    line-height: 1;
  }

  .value-block span,
  small {
    color: #64748b;
    font-size: 12px;
  }

  .pair-body {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .pair-body div,
  .trait-strip {
    padding: 10px;
    border-radius: 8px;
    background: #f8fafc;
  }

  .pair-body b {
    display: block;
    margin: 4px 0;
    color: #111827;
    font-size: 15px;
  }

  .pair-body span,
  .trait-strip span {
    color: #334155;
    font-weight: 700;
  }

  .trait-strip {
    align-items: center;
  }

  .methodology-note {
    padding: 10px 12px;
    border-radius: 8px;
    background: rgba(245, 158, 11, 0.09);
    line-height: 1.5;
  }

  .pair-detail-grid,
  .pair-parent-grid {
    display: grid;
    gap: 12px;
  }

  .pair-detail-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-bottom: 14px;
  }

  .pair-parent-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .pair-detail-card {
    min-width: 0;
    padding: 14px;
    border: 1px solid rgba(15, 23, 42, 0.08);
    border-radius: 8px;
    background: #fff;
    box-shadow: none;
  }

  .pair-detail-card.is-main {
    display: flex;
    grid-column: span 2;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
    border-left: 4px solid #7c3aed;
  }

  .pair-detail-card span {
    color: #64748b;
    font-size: 12px;
    font-weight: 680;
  }

  .pair-detail-card h3,
  .pair-detail-card strong {
    display: block;
    margin: 6px 0 0;
    color: #111827;
    font-size: 18px;
    font-weight: 780;
  }

  .pair-detail-card p {
    margin-top: 8px;
  }

  .load-more-row {
    display: flex;
    justify-content: center;
    padding: 14px 0 4px;
  }

  @media (max-width: 1280px) {
    .fc-metric-grid,
    .trace-grid,
    .pair-grid,
    .pair-detail-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .direction-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 760px) {
    .fc-metric-grid,
    .trace-grid,
    .direction-grid,
    .pair-grid,
    .pair-body,
    .pair-detail-grid,
    .pair-parent-grid {
      grid-template-columns: 1fr;
    }

    .pair-detail-card.is-main {
      grid-column: auto;
    }
  }
</style>
