<template>
  <FcPageShell
    title="候选种公牛基线指数排行榜"
    status-label="筛选状态"
    :status-value="statusText"
    primary-action-label="导出种公牛榜单"
    primary-action-icon="ri:download-2-line"
    secondary-action-label="刷新数据"
    secondary-action-icon="ri:refresh-line"
    @primary-action="announceSelection"
    @secondary-action="loadData"
  >
    <template #metrics>
      <section class="fc-metric-grid">
        <FcMetricTile
          label="候选种公牛"
          :value="bullRows.length"
          note="进入当前基线指数排行的公牛数量"
          icon="ri:user-star-line"
        />
        <FcMetricTile
          label="核心种公牛"
          :value="eliteRows.length"
          note="综合评分 >= 85"
          icon="ri:medal-2-line"
          tone="teal"
        />
        <FcMetricTile
          label="低风险推荐"
          :value="lowRiskRows.length"
          note="已匹配到低近交风险母牛"
          icon="ri:shield-check-line"
          tone="warning"
        />
        <FcMetricTile
          label="平均基线指数"
          :value="averageBreedingValue"
          unit="分"
          note="baseline/rule_based 输出，不是 EBV 或 GBLUP"
          icon="ri:line-chart-line"
          tone="info"
        />
      </section>
    </template>

    <FcPanel title="算法与追溯摘要">
      <div class="trace-grid">
        <section class="trace-block">
          <span>算法类型</span>
          <strong>{{ breedingAlgorithm.algorithmType }}</strong>
          <p>{{ breedingAlgorithm.summary }}</p>
        </section>
        <section class="trace-block">
          <span>输入快照</span>
          <strong
            >{{ traceSummary.inputSnapshot.candidateSet.count }} 头公牛 /
            {{ traceSummary.inputSnapshot.mateCandidateSet.count }} 头母牛</strong
          >
          <p
            >输出
            {{ traceSummary.inputSnapshot.outputCount }}
            条；候选集合来自当前平台表型、泌乳、健康、谱系和组学证据分。</p
          >
        </section>
        <section class="trace-block">
          <span>排序权重</span>
          <strong
            >主性状 {{ traceSummary.weights.primaryTrait }} / 第二性状
            {{ traceSummary.weights.secondaryTrait }} / 组学证据
            {{ traceSummary.weights.genomicEvidence }}</strong
          >
          <p>{{ breedingAlgorithm.methodologyNote }}</p>
        </section>
      </div>
    </FcPanel>

    <FcPanel title="种公牛排行条件">
      <div class="filter-grid">
        <label class="filter-item">
          <span>主性状</span>
          <ElSelect v-model="primaryTrait" size="large">
            <ElOptionGroup
              v-for="group in traitOptionGroups"
              :key="group.label"
              :label="group.label"
            >
              <ElOption
                v-for="item in group.options"
                :key="item.value"
                :label="getTraitSelectLabel(item)"
                :value="item.value"
              />
            </ElOptionGroup>
          </ElSelect>
        </label>
        <label class="filter-item">
          <span>主性状排序</span>
          <ElSegmented v-model="primaryDirection" :options="directionOptions" size="large" />
        </label>
        <label class="filter-item">
          <span>第二性状</span>
          <ElSelect v-model="secondaryTrait" size="large">
            <ElOptionGroup
              v-for="group in traitOptionGroups"
              :key="`secondary-${group.label}`"
              :label="group.label"
            >
              <ElOption
                v-for="item in group.options"
                :key="item.value"
                :label="getTraitSelectLabel(item)"
                :value="item.value"
              />
            </ElOptionGroup>
          </ElSelect>
        </label>
        <label class="filter-item">
          <span>第二性状排序</span>
          <ElSegmented v-model="secondaryDirection" :options="directionOptions" size="large" />
        </label>
        <label class="filter-check">
          <ElSwitch v-model="onlyLowRisk" />
          <span>只看低近交风险推荐</span>
        </label>
      </div>
    </FcPanel>

    <FcPanel title="候选种公牛排行榜">
      <div
        ref="rankingGridContainerRef"
        class="ranking-grid-viewport"
        @scroll.passive="onRankingGridScroll"
        @wheel.passive="onRankingGridWheel"
      >
        <section class="ranking-grid">
          <article
            v-for="item in visibleRankedRows"
            :key="item.row.cow.id"
            class="candidate-card"
            :class="{ 'is-active': selectedCandidateCowId === item.row.cow.id }"
            role="button"
            tabindex="0"
            @click="selectCandidate(item.row.cow.id)"
            @keydown.enter.prevent="selectCandidate(item.row.cow.id)"
            @keydown.space.prevent="selectCandidate(item.row.cow.id)"
          >
            <div class="card-head">
              <div>
                <span class="rank">#{{ item.rank }}</span>
                <h3>{{ item.row.cow.cowNumber }}</h3>
                <p>{{ penName(item.row.cow) }} · {{ item.row.candidateTag }}</p>
              </div>
              <div class="value-block">
                <strong>{{ item.breedingValue }}</strong>
                <span>基线指数</span>
              </div>
            </div>

            <div class="algorithm-strip">
              <ElTag type="info">{{ item.algorithmType }}</ElTag>
              <span>{{ breedingAlgorithm.label }}</span>
            </div>

            <div class="trait-strip">
              <span
                >{{ primaryLabel }}
                {{ formatTraitValue(item.primaryValue, primaryTrait, traitOptions) }}</span
              >
              <span
                >{{ secondaryLabel }}
                {{ formatTraitValue(item.secondaryValue, secondaryTrait, traitOptions) }}</span
              >
            </div>

            <div class="score-grid">
              <span
                >系谱 <b>{{ item.row.pedigreeScore }}</b></span
              >
              <span
                >组学证据 <b>{{ item.row.genomicScore }}</b></span
              >
              <span
                >健康 <b>{{ item.row.healthScore }}</b></span
              >
              <span
                >后裔 <b>{{ item.row.breedingEvents }}</b></span
              >
            </div>

            <div class="mate-box" v-if="item.mate">
              <div>
                <small>推荐母牛</small>
                <strong>{{ item.mate.row.cow.cowNumber }}</strong>
                <p>{{ item.mate.reason }}</p>
              </div>
              <ElTag :type="item.mate.inbreedingRisk ? 'danger' : 'success'">
                兼容度 {{ item.mate.compatibility }}
              </ElTag>
            </div>
            <p v-if="item.mate" class="methodology-note">
              {{ item.mate.riskAssessment.label }}：{{ item.mate.methodologyNote }}
            </p>

            <p class="summary">{{ item.row.decisionSummary }}</p>
          </article>
        </section>
        <div v-if="rankedRows.length > visibleRankedRows.length" class="load-more-row">
          <ElButton size="small" plain @click="loadMoreRankedRows()">
            继续加载 {{ visibleRankedRows.length }}/{{ rankedRows.length }}
          </ElButton>
        </div>
      </div>
    </FcPanel>

    <ElDialog v-model="candidateDetailVisible" title="候选种公牛详情" width="920px">
      <div v-if="selectedCandidateDetail" class="candidate-detail-grid">
        <section class="candidate-detail-card is-main">
          <div>
            <span>候选种公牛</span>
            <h3>{{ selectedCandidateDetail.item.row.cow.cowNumber }}</h3>
            <p
              >{{ penName(selectedCandidateDetail.item.row.cow) }} ·
              {{ selectedCandidateDetail.item.row.candidateTag }}</p
            >
          </div>
          <strong>{{ selectedCandidateDetail.item.breedingValue }}</strong>
        </section>

        <section
          class="candidate-detail-card"
          v-for="metric in selectedCandidateDetail.metrics"
          :key="metric.label"
        >
          <span>{{ metric.label }}</span>
          <strong>{{ metric.value }}</strong>
          <p>{{ metric.note }}</p>
        </section>
      </div>

      <section v-if="selectedCandidateDetail?.item.mate" class="mate-detail-card">
        <div>
          <span>推荐母牛</span>
          <h3>{{ selectedCandidateDetail.item.mate.row.cow.cowNumber }}</h3>
          <p>{{ selectedCandidateDetail.item.mate.reason }}</p>
        </div>
        <ElTag :type="selectedCandidateDetail.item.mate.inbreedingRisk ? 'danger' : 'success'">
          兼容度 {{ selectedCandidateDetail.item.mate.compatibility }}
        </ElTag>
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
    formatTraitValue,
    getTraitLabel,
    getTraitSelectLabel,
    groupBreedingTraitOptions,
    loadBreedingTraitOptions,
    rankCandidates,
    traitOptions as fallbackTraitOptions,
    type SortDirection,
    type TraitKey,
    type TraitOption
  } from '../shared'
  import {
    candidateCowIds,
    persistBreedingDecisionRun,
    rankedCandidateSnapshot,
    traitParameterSnapshot
  } from '../decision-audit'
  import { BREEDING_BASELINE_ALGORITHM, buildCandidateTraceSummary } from '../algorithm-metadata'

  const snapshot = ref<PlatformSnapshot>({
    cows: [],
    sensors: [],
    milkRecords: [],
    breedingRecords: [],
    alerts: [],
    healthScores: []
  })
  const bullRows = ref<CandidateScoreRow[]>([])
  const femaleRows = ref<CandidateScoreRow[]>([])
  const traitOptions = ref<TraitOption[]>(fallbackTraitOptions)
  const primaryTrait = ref<TraitKey>('score')
  const primaryDirection = ref<SortDirection>('desc')
  const secondaryTrait = ref<TraitKey>('pedigreeScore')
  const secondaryDirection = ref<SortDirection>('desc')
  const onlyLowRisk = ref(false)
  const selectedCandidateCowId = ref('')
  const candidateDetailVisible = ref(false)
  const directionOptions = [
    { label: '高值优先', value: 'desc' },
    { label: '低值优先', value: 'asc' }
  ]
  const breedingAlgorithm = BREEDING_BASELINE_ALGORITHM

  const rankedRows = computed(() =>
    rankCandidates(
      bullRows.value,
      femaleRows.value,
      primaryTrait.value,
      primaryDirection.value,
      secondaryTrait.value,
      secondaryDirection.value,
      onlyLowRisk.value
    )
  )
  const traceSummary = computed(() =>
    buildCandidateTraceSummary({
      rows: rankedRows.value,
      candidateRows: bullRows.value,
      mateRows: femaleRows.value,
      primaryTrait: primaryTrait.value,
      primaryDirection: primaryDirection.value,
      secondaryTrait: secondaryTrait.value,
      secondaryDirection: secondaryDirection.value,
      onlyLowRisk: onlyLowRisk.value
    })
  )
  const {
    containerRef: rankingGridContainerRef,
    visibleItems: visibleRankedRows,
    loadMore: loadMoreRankedRows,
    handleScroll: onRankingGridScroll,
    handleWheel: onRankingGridWheel
  } = useLazyGridRenderWindow(rankedRows, {
    rowCount: 2,
    minItemWidth: 320,
    gap: 14,
    fallbackColumns: 3,
    mode: 'fixed-window'
  })
  const traitOptionGroups = computed(() => groupBreedingTraitOptions(traitOptions.value))
  const eliteRows = computed(() => bullRows.value.filter((row) => row.score >= 85))
  const lowRiskRows = computed(() =>
    rankedRows.value.filter((row) => row.mate && !row.mate.inbreedingRisk)
  )
  const averageBreedingValue = computed(() =>
    Math.round(average(rankedRows.value.map((row) => row.breedingValue)))
  )
  const primaryLabel = computed(() => getTraitLabel(primaryTrait.value, traitOptions.value))
  const secondaryLabel = computed(() => getTraitLabel(secondaryTrait.value, traitOptions.value))
  const statusText = computed(() => (rankedRows.value.length ? '可进入选配' : '待补齐数据'))
  const selectedCandidateDetail = computed(() => {
    const item = rankedRows.value.find((row) => row.row.cow.id === selectedCandidateCowId.value)
    if (!item) return null
    return {
      item,
      metrics: [
        {
          label: '基线指数',
          value: item.breedingValue,
          note: '由主性状、第二性状、系谱完整度、组学证据分、健康和后裔记录按基线权重排序。'
        },
        {
          label: primaryLabel.value,
          value: formatTraitValue(item.primaryValue, primaryTrait.value, traitOptions.value),
          note: `当前按${primaryLabel.value}${primaryDirection.value === 'desc' ? '高值优先' : '低值优先'}排序。`
        },
        {
          label: secondaryLabel.value,
          value: formatTraitValue(item.secondaryValue, secondaryTrait.value, traitOptions.value),
          note: `第二性状按${secondaryDirection.value === 'desc' ? '高值优先' : '低值优先'}辅助筛选。`
        },
        {
          label: '系谱完整度',
          value: item.row.pedigreeScore,
          note: '近交风险仍是谱系编号重叠的基线估算，不是亲缘矩阵/F 值。'
        },
        {
          label: '组学证据分',
          value: item.row.genomicScore,
          note: '来自本地组学样本和候选标记证据，不等同于基因组育种值。'
        },
        {
          label: '后裔/繁殖记录',
          value: `${item.row.breedingEvents} 条`,
          note: item.row.decisionSummary
        }
      ]
    }
  })

  const penName = (cow: CandidateScoreRow['cow']) => {
    const record = cow as unknown as Record<string, unknown>
    return String(record.penName || record.pen || '未分栏')
  }

  const announceSelection = async () => {
    try {
      const rows = rankedRows.value
      const traceabilitySummary = traceSummary.value
      const runId = await persistBreedingDecisionRun({
        runType: 'bull_ranking',
        title: '候选种公牛基线指数排行榜',
        algorithmMetadata: breedingAlgorithm,
        parameters: {
          ...traitParameterSnapshot(
            primaryTrait.value,
            primaryDirection.value,
            secondaryTrait.value,
            secondaryDirection.value,
            onlyLowRisk.value
          ),
          algorithmType: breedingAlgorithm.algorithmType,
          algorithmVersion: breedingAlgorithm.algorithmVersion,
          weights: traceabilitySummary.weights,
          rowCount: rows.length
        },
        resultSnapshot: {
          traceabilitySummary,
          rankedRows: rankedCandidateSnapshot(rows),
          topCowNumbers: rows.slice(0, 5).map((item) => item.row.cow.cowNumber)
        },
        cowIds: candidateCowIds(rows),
        sourceRecordIds: {
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
      ElMessage.success(`已生成 ${rows.length} 头候选种公牛基线指数排行榜，运行记录 ${runId}`)
    } catch (error) {
      ElMessage.error('种公牛榜单运行记录写入失败')
      console.error(error)
    }
  }

  const selectCandidate = (cowId: string) => {
    selectedCandidateCowId.value = cowId
    candidateDetailVisible.value = true
  }

  const loadData = async () => {
    const [loadedSnapshot, loadedTraits] = await Promise.all([
      loadBreedingDecisionSnapshot(),
      loadBreedingTraitOptions()
    ])
    snapshot.value = loadedSnapshot
    traitOptions.value = loadedTraits.length ? loadedTraits : fallbackTraitOptions
    if (!traitOptions.value.some((item) => item.value === primaryTrait.value))
      primaryTrait.value =
        traitOptions.value.find((item) => item.value === 'score')?.value ||
        traitOptions.value[0]?.value ||
        'score'
    if (!traitOptions.value.some((item) => item.value === secondaryTrait.value))
      secondaryTrait.value =
        traitOptions.value.find((item) => item.value === 'pedigreeScore')?.value ||
        traitOptions.value[1]?.value ||
        primaryTrait.value
    bullRows.value = buildBullCandidateRows(snapshot.value)
    femaleRows.value = buildFemaleCandidateRows(snapshot.value)
  }

  loadData()
</script>

<style scoped lang="scss">
  .fc-metric-grid,
  .filter-grid,
  .trace-grid,
  .ranking-grid,
  .score-grid {
    display: grid;
    gap: 14px;
  }

  .fc-metric-grid {
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  }

  .filter-grid {
    grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
    align-items: end;
  }

  .trace-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .filter-item,
  .filter-check {
    display: grid;
    gap: 8px;
    color: #52616f;
    font-size: 13px;
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

  .filter-check {
    grid-template-columns: auto 1fr;
    align-items: center;
    padding: 12px 14px;
    border: 1px solid rgba(15, 23, 42, 0.08);
    border-radius: 8px;
    background: #fff;
  }

  .ranking-grid {
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  }

  .ranking-grid-viewport {
    max-height: min(76vh, 760px);
    overflow: auto;
    padding: 2px 4px 10px;
  }

  .candidate-card {
    display: grid;
    gap: 10px;
    padding: 12px;
    border: 1px solid rgba(15, 23, 42, 0.08);
    border-left: 4px solid #2563eb;
    border-radius: 8px;
    background: #fff;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
    cursor: pointer;
    transition:
      border-color 180ms cubic-bezier(0.16, 1, 0.3, 1),
      box-shadow 180ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .candidate-card:hover,
  .candidate-card:focus-visible,
  .candidate-card.is-active:hover,
  .candidate-card.is-active:focus-visible {
    outline: none;
    border-color: rgba(37, 99, 235, 0.46);
    box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.16) !important;
  }

  .candidate-card.is-active {
    border-color: rgba(37, 99, 235, 0.46);
    box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.16);
  }

  .card-head {
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
    color: #2563eb;
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
    color: #0f766e;
    font-size: 24px;
    line-height: 1;
  }

  .value-block span,
  small {
    color: #64748b;
    font-size: 12px;
  }

  .trait-strip,
  .mate-box {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding: 10px;
    border-radius: 8px;
    background: #f8fafc;
  }

  .trait-strip span {
    color: #334155;
    font-weight: 700;
  }

  .score-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .score-grid span {
    flex: 1 1 118px;
    padding: 7px 8px;
    border-radius: 8px;
    background: rgba(37, 99, 235, 0.06);
    color: #475569;
  }

  .score-grid b {
    float: right;
    color: #0f172a;
  }

  .mate-box {
    align-items: center;
  }

  .mate-box strong {
    display: block;
    margin: 2px 0;
    color: #111827;
    font-size: 15px;
  }

  .summary {
    color: #334155;
  }

  .methodology-note {
    padding: 10px 12px;
    border-radius: 8px;
    background: rgba(245, 158, 11, 0.09);
    line-height: 1.5;
  }

  .load-more-row {
    display: flex;
    justify-content: center;
    padding: 14px 0 4px;
  }

  .candidate-detail-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 14px;
  }

  .candidate-detail-card,
  .mate-detail-card {
    min-width: 0;
    padding: 14px;
    border: 1px solid rgba(15, 23, 42, 0.08);
    border-radius: 8px;
    background: #fff;
    box-shadow: none;
  }

  .candidate-detail-card.is-main,
  .mate-detail-card {
    display: flex;
    grid-column: span 2;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
    border-left: 4px solid #2563eb;
  }

  .candidate-detail-card span,
  .mate-detail-card span {
    color: #64748b;
    font-size: 12px;
    font-weight: 680;
  }

  .candidate-detail-card h3,
  .mate-detail-card h3,
  .candidate-detail-card strong {
    display: block;
    margin: 6px 0 0;
    color: #111827;
    font-size: 18px;
    font-weight: 780;
  }

  .candidate-detail-card p,
  .mate-detail-card p {
    margin-top: 8px;
  }

  @media (max-width: 1280px) {
    .fc-metric-grid,
    .trace-grid,
    .ranking-grid,
    .candidate-detail-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .filter-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 760px) {
    .fc-metric-grid,
    .filter-grid,
    .trace-grid,
    .ranking-grid,
    .candidate-detail-grid {
      grid-template-columns: 1fr;
    }

    .candidate-detail-card.is-main,
    .mate-detail-card {
      grid-column: auto;
    }
  }
</style>
