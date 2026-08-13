<template>
  <FcPageShell
    title="种质评估"
    status-label="评估状态"
    :status-value="statusText"
    primary-action-label="生成优选名单"
    primary-action-icon="ri:medal-line"
    secondary-action-label="刷新评分"
    secondary-action-icon="ri:refresh-line"
    @primary-action="announceSelection"
    @secondary-action="loadData"
  >
    <template #metrics>
      <section class="fc-metric-grid">
        <FcMetricTile
          label="参评个体"
          :value="rows.length"
          note="已纳入表型、系谱或组学证据的牛只"
          icon="ri:survey-line"
        />
        <FcMetricTile
          label="表型性状"
          :value="traitOptions.length"
          note="支持按不同性状切换排名"
          icon="ri:bar-chart-grouped-line"
          tone="teal"
        />
        <FcMetricTile
          label="育种值候选"
          :value="weightedBreedingValueRanks.length"
          note="综合表型、系谱和后代证据"
          icon="ri:medal-2-line"
          tone="warning"
        />
        <FcMetricTile
          label="质量性状"
          :value="qualityRanks.length"
          note="乳脂、乳蛋白、乳糖、SCC 与奶质等级"
          icon="ri:drop-line"
          tone="info"
        />
      </section>
    </template>

    <section class="ranking-layout">
      <FcPanel title="表型性状排名">
        <div class="trait-switch">
          <ElSelect
            v-model="selectedTrait"
            filterable
            placeholder="选择排名性状"
            class="trait-select"
          >
            <ElOptionGroup
              v-for="group in traitOptionGroups"
              :key="`trait-group-${group.label}`"
              :label="group.label"
            >
              <ElOption
                v-for="option in group.options"
                :key="option.key"
                :label="traitSelectLabel(option)"
                :value="option.key"
              />
            </ElOptionGroup>
          </ElSelect>
          <ElSelect
            v-model="weightedTraitCodes"
            multiple
            filterable
            collapse-tags
            collapse-tags-tooltip
            placeholder="多性状优先级/权重排序"
          >
            <ElOptionGroup
              v-for="group in traitOptionGroups"
              :key="`weight-group-${group.label}`"
              :label="group.label"
            >
              <ElOption
                v-for="option in group.options"
                :key="`weight-${option.key}`"
                :label="traitSelectLabel(option)"
                :value="option.key"
              />
            </ElOptionGroup>
          </ElSelect>
        </div>
        <div v-if="weightedTraitCodes.length" class="weight-grid">
          <div v-for="code in weightedTraitCodes" :key="code">
            <span>{{ traitLabel(code) }}</span>
            <ElInputNumber
              v-model="traitWeights[code]"
              :min="0"
              :max="100"
              :step="5"
              controls-position="right"
            />
          </div>
        </div>
        <div
          ref="phenotypeRankContainerRef"
          class="rank-card-viewport"
          @scroll.passive="onPhenotypeRankScroll"
          @wheel.passive="onPhenotypeRankWheel"
        >
          <div class="rank-card-grid phenotype-rank-grid">
            <article
              v-for="item in visiblePhenotypeRanks"
              :key="`${selectedTrait}-${item.cow.id}`"
              class="rank-card art-card-sm"
              :class="{
                'is-podium': item.rank <= 3,
                'is-active': selectedEvaluationCowId === item.cow.id
              }"
              role="button"
              tabindex="0"
              @click="selectEvaluationCow(item.cow.id)"
              @keydown.enter.prevent="selectEvaluationCow(item.cow.id)"
              @keydown.space.prevent="selectEvaluationCow(item.cow.id)"
            >
              <div class="rank-head">
                <span class="rank-index">#{{ item.rank }}</span>
                <ElTag :type="item.rank <= 3 ? 'success' : 'info'">{{ item.traitLabel }}</ElTag>
              </div>
              <h3>{{ item.cow.cowNumber }}</h3>
              <div class="rank-value">{{ item.displayValue }}</div>
              <div class="evidence-row">
                <span>系谱 {{ item.pedigreeScore }}%</span>
                <span>组学 {{ item.genomicScore }}</span>
                <span>记录 {{ item.recordCount }} 条</span>
              </div>
            </article>
          </div>
          <div v-if="phenotypeRanks.length > visiblePhenotypeRanks.length" class="load-more-row">
            <span>滚动切换两排窗口 / 共 {{ phenotypeRanks.length }} 头</span>
          </div>
        </div>
      </FcPanel>

      <FcPanel title="育种值排名">
        <template #actions>
          <ElButton size="small" @click="exportRanking">导出排名</ElButton>
        </template>
        <div
          ref="breedingRankContainerRef"
          class="rank-card-viewport"
          @scroll.passive="onBreedingRankScroll"
          @wheel.passive="onBreedingRankWheel"
        >
          <div class="rank-card-list">
            <article
              v-for="item in visibleWeightedBreedingValueRanks"
              :key="item.cow.id"
              class="breeding-card art-card-sm"
              :class="{ 'is-active': selectedEvaluationCowId === item.cow.id }"
              role="button"
              tabindex="0"
              @click="selectEvaluationCow(item.cow.id)"
              @keydown.enter.prevent="selectEvaluationCow(item.cow.id)"
              @keydown.space.prevent="selectEvaluationCow(item.cow.id)"
            >
              <div class="rank-head">
                <span class="rank-index">#{{ item.rank }}</span>
                <ElTag :type="item.rank <= 3 ? 'success' : 'warning'">{{ item.tag }}</ElTag>
              </div>
              <div class="breeding-main">
                <div>
                  <h3>{{ item.cow.cowNumber }}</h3>
                </div>
                <strong>{{ item.breedingValue }}</strong>
              </div>
              <div class="score-bars">
                <div v-for="score in item.scores" :key="score.label">
                  <span>{{ score.label }}</span>
                  <ElProgress :percentage="score.value" :stroke-width="7" />
                </div>
              </div>
              <div class="evidence-row">
                <span>{{ item.pedigreeText }}</span>
                <span>{{ item.progenyText }}</span>
                <span>{{ item.omicsText }}</span>
              </div>
            </article>
          </div>
          <div
            v-if="weightedBreedingValueRanks.length > visibleWeightedBreedingValueRanks.length"
            class="load-more-row"
          >
            <span>滚动切换两排窗口 / 共 {{ weightedBreedingValueRanks.length }} 头</span>
          </div>
        </div>
      </FcPanel>
    </section>

    <section class="secondary-ranking-layout">
      <FcPanel title="质量性状排名">
        <div
          ref="qualityRankContainerRef"
          class="rank-card-viewport"
          @scroll.passive="onQualityRankScroll"
          @wheel.passive="onQualityRankWheel"
        >
          <div class="quality-grid">
            <article
              v-for="item in visibleQualityRanks"
              :key="item.cow.id"
              class="quality-card art-card-sm"
              :class="{ 'is-active': selectedEvaluationCowId === item.cow.id }"
              role="button"
              tabindex="0"
              @click="selectEvaluationCow(item.cow.id)"
              @keydown.enter.prevent="selectEvaluationCow(item.cow.id)"
              @keydown.space.prevent="selectEvaluationCow(item.cow.id)"
            >
              <div class="rank-head">
                <span class="rank-index">#{{ item.rank }}</span>
                <ElTag
                  :type="item.grade === 'A' ? 'success' : item.grade === 'B' ? 'warning' : 'danger'"
                  >{{ item.grade }} 级奶</ElTag
                >
              </div>
              <h3>{{ item.cow.cowNumber }}</h3>
              <div class="quality-score">{{ item.qualityScore }}</div>
              <div class="quality-metrics">
                <span>乳脂 {{ item.fat.toFixed(2) }}%</span>
                <span>乳蛋白 {{ item.protein.toFixed(2) }}%</span>
                <span>乳糖 {{ item.lactose.toFixed(2) }}%</span>
                <span>SCC {{ item.sccText }}</span>
              </div>
            </article>
          </div>
          <div v-if="qualityRanks.length > visibleQualityRanks.length" class="load-more-row">
            <span>滚动切换两排窗口 / 共 {{ qualityRanks.length }} 头</span>
          </div>
        </div>
      </FcPanel>

      <FcPanel title="评估结论">
        <div class="queue-list">
          <article
            v-for="item in queueItems"
            :key="item.id"
            class="queue-item art-card-xs"
            :class="item.tone"
          >
            <div>
              <span>{{ item.kind }}</span>
              <h3>{{ item.title }}</h3>
            </div>
            <ElTag :type="item.tagType">{{ item.level }}</ElTag>
          </article>
        </div>
      </FcPanel>
    </section>

    <ElDialog v-model="evaluationDetailVisible" title="单牛种质评估详情" width="920px">
      <div v-if="selectedEvaluationDetail" class="evaluation-detail-grid">
        <section class="evaluation-detail-card is-main art-card-sm">
          <div>
            <span>参评个体</span>
            <h3>{{ selectedEvaluationDetail.row.cow.cowNumber }}</h3>
            <p>{{ selectedEvaluationDetail.summary }}</p>
          </div>
          <strong>{{ selectedEvaluationDetail.breedingValue }}</strong>
        </section>

        <section
          class="evaluation-detail-card detail-row art-card-xs"
          v-for="item in selectedEvaluationDetail.metrics"
          :key="item.label"
        >
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
          <p>{{ item.note }}</p>
        </section>
      </div>

      <div v-if="selectedEvaluationDetail" class="evidence-detail-list">
        <article
          v-for="item in selectedEvaluationDetail.evidence"
          :key="item.label"
          class="evaluation-detail-card detail-row art-card-xs"
        >
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
          <p>{{ item.note }}</p>
        </article>
      </div>
    </ElDialog>

    <FcPanel title="综合评分明细">
      <ElTable
        :data="visibleWeightedDetailRows"
        height="420"
        @wheel.passive="onWeightedDetailWheel"
      >
        <ElTableColumn prop="cow.cowNumber" label="牛号" width="120">
          <template #default="{ row }">{{ row.cow.cowNumber }}</template>
        </ElTableColumn>
        <ElTableColumn label="综合评分" width="100">
          <template #default="{ row }">{{ row.weightedScore }}</template>
        </ElTableColumn>
        <ElTableColumn label="系谱" width="90">
          <template #default="{ row }">{{ row.pedigreeScore }}</template>
        </ElTableColumn>
        <ElTableColumn label="表型" width="90">
          <template #default="{ row }">{{ row.milkScore }}</template>
        </ElTableColumn>
        <ElTableColumn label="质量" width="90">
          <template #default="{ row }">{{ getQualityScore(row.cow.id) }}</template>
        </ElTableColumn>
        <ElTableColumn label="组学" width="90">
          <template #default="{ row }">{{ row.genomicScore }}</template>
        </ElTableColumn>
        <ElTableColumn label="后代/繁殖" width="110">
          <template #default="{ row }">{{ row.breedingEvents }}</template>
        </ElTableColumn>
        <ElTableColumn label="平均泌乳" width="110">
          <template #default="{ row }">{{ row.averageMilk.toFixed(1) }} kg</template>
        </ElTableColumn>
        <ElTableColumn label="证据摘要" min-width="280">
          <template #default="{ row }">{{ row.supportEvidence.slice(0, 3).join('；') }}</template>
        </ElTableColumn>
      </ElTable>
      <div v-if="weightedDetailRows.length" class="load-more-row">
        <span>
          当前窗口 {{ weightedDetailStartIndex + 1 }}-{{ weightedDetailEndIndex }} /
          {{ weightedDetailTotalCount }} 条
        </span>
      </div>
    </FcPanel>

    <section class="dmu-layout">
      <FcPanel title="DMU 文件流" subtitle="DMU 文件流">
        <div class="dmu-status art-card-xs" :class="{ 'is-ready': dmuFiles.executorConfigured }">
          <span>执行器状态</span>
          <strong>{{ dmuFiles.executorConfigured ? '已配置' : '待配置' }}</strong>
          <p>{{ dmuFiles.message || '生成文件后显示 DMU 执行器状态。' }}</p>
        </div>
        <div class="dmu-mode-panel art-card-xs">
          <div>
            <span>建模方式</span>
            <strong>{{ dmuMode === 'single' ? '单性状模型' : '多性状模型' }}</strong>
            <p>
              {{
                dmuMode === 'single'
                  ? '只选择一个目标性状，适合先跑通 DMU 文件流。'
                  : '可选择多个性状，按 DAT 列顺序生成多性状输入。'
              }}
            </p>
          </div>
          <ElSegmented
            v-model="dmuMode"
            :options="[
              { label: '单性状', value: 'single' },
              { label: '多性状', value: 'multi' }
            ]"
          />
        </div>
        <div class="dmu-flow-steps" aria-label="DMU 配置流程">
          <article class="art-card-xs">
            <span>1</span>
            <strong>选性状</strong>
            <small>{{
              dmuMode === 'single' ? '单性状只保留一个目标列' : '多性状按选择顺序生成多个目标列'
            }}</small>
          </article>
          <article class="art-card-xs">
            <span>2</span>
            <strong>套固定效应</strong>
            <small>默认含产犊年、胎次、季节、场效应、圈舍</small>
          </article>
          <article class="art-card-xs">
            <span>3</span>
            <strong>生成文件</strong>
            <small>输出 DIR/DAT，结果只接受真实 DMU 文件导入</small>
          </article>
        </div>
        <div class="dmu-model-preset-panel">
          <button
            v-for="preset in dmuModelPresets"
            :key="preset.key"
            type="button"
            class="dmu-model-preset art-card-xs"
            :class="{ active: activeDmuPreset === preset.key }"
            @click="applyDmuModelPreset(preset.key)"
          >
            <span>{{ preset.label }}</span>
            <strong>{{ preset.mode === 'single' ? '单性状' : '多性状' }}</strong>
            <small>{{ preset.note }}</small>
          </button>
        </div>
        <div class="dmu-recipe-card art-card-xs">
          <div>
            <span>当前推荐方案</span>
            <strong>{{ activeDmuPresetLabel }}</strong>
            <p>{{ dmuRecipeText }}</p>
          </div>
          <ElButton
            size="small"
            type="primary"
            plain
            @click="applyDmuModelPreset(activeDmuPreset || 'milk-single')"
          >
            一键套用
          </ElButton>
        </div>
        <div class="dmu-preset-panel art-card-xs">
          <div class="dmu-preset-head">
            <div>
              <span>固定效应预设</span>
              <strong>{{ selectedDmuFixedFields.length }} 项已选</strong>
            </div>
            <ElButton size="small" text @click="applyDefaultFixedEffects">恢复推荐</ElButton>
          </div>
          <div class="dmu-effect-helper">
            <span>推荐先选：</span>
            <strong>产犊年 + 胎次 + 季节 + 场效应 + 圈舍</strong>
            <small
              >这几个是牧场生产数据最常用的环境修正项；品种、性别、测定月、泌乳阶段按数据类型再加。</small
            >
          </div>
          <div class="dmu-effect-chip-grid">
            <button
              v-for="preset in dmuFixedEffectPresets"
              :key="preset.key"
              type="button"
              class="dmu-effect-chip art-card-xs"
              :class="{ active: dmuForm.fixedEffectFields.includes(preset.key) }"
              @click="toggleDmuFixedEffect(preset.key)"
            >
              <span>{{ preset.label }}</span>
              <small>{{ preset.note }}</small>
            </button>
          </div>
        </div>
        <div class="dmu-form-grid">
          <ElInput v-model="dmuForm.jobName" placeholder="任务名" />
          <ElSelect v-model="dmuForm.model" placeholder="模型">
            <ElOption label="单性状动物模型" value="animal_model" />
            <ElOption label="多性状动物模型" value="multi_trait_animal_model" />
            <ElOption label="重复力模型" value="repeatability_model" />
          </ElSelect>
          <ElSelect v-model="dmuForm.animalIdField" filterable placeholder="个体 ID 字段">
            <ElOption
              v-for="option in dmuFieldOptions"
              :key="`animal-${option.key}`"
              :label="option.label"
              :value="option.key"
            />
          </ElSelect>
          <ElSelect
            v-model="dmuTraitSelection"
            :multiple="dmuMode === 'multi'"
            filterable
            collapse-tags
            collapse-tags-tooltip
            placeholder="目标性状字段"
          >
            <ElOptionGroup
              v-for="group in traitOptionGroups"
              :key="`dmu-group-${group.label}`"
              :label="group.label"
            >
              <ElOption
                v-for="option in group.options"
                :key="`dmu-${option.key}`"
                :label="traitSelectLabel(option)"
                :value="option.key"
              />
            </ElOptionGroup>
          </ElSelect>
          <ElSelect
            v-model="dmuForm.fixedEffectFields"
            multiple
            filterable
            collapse-tags
            collapse-tags-tooltip
            placeholder="固定效应字段"
          >
            <ElOption
              v-for="option in dmuFixedFieldOptions"
              :key="`fixed-${option.key}`"
              :label="option.label"
              :value="option.key"
            />
          </ElSelect>
          <ElSelect
            v-model="dmuForm.randomEffectFields"
            multiple
            filterable
            collapse-tags
            collapse-tags-tooltip
            placeholder="随机效应字段"
          >
            <ElOption
              v-for="option in dmuRandomFieldOptions"
              :key="`random-${option.key}`"
              :label="option.label"
              :value="option.key"
            />
          </ElSelect>
          <ElInput v-model="dmuForm.relationshipFileName" placeholder="亲缘文件名" />
          <ElInput v-model="dmuForm.dataFileName" placeholder="数据文件名" />
          <ElInput v-model="dmuForm.resultFileName" placeholder="结果文件名" />
        </div>
        <div class="dmu-guide-grid">
          <article class="art-card-xs">
            <span>常用固定效应</span>
            <strong>产犊年、胎次、季节、场效应、圈舍、品种、性别</strong>
          </article>
          <article class="art-card-xs">
            <span>随机效应</span>
            <strong>默认动物个体；后续接亲缘矩阵和重复测定可扩展。</strong>
          </article>
          <article class="art-card-xs">
            <span>新手建议</span>
            <strong>生成 DIR/DAT 后导入 DMU 结果。</strong>
          </article>
        </div>
        <div class="dmu-mapping-table">
          <div class="dmu-mapping-row is-head">
            <span>业务字段</span>
            <span>DMU列名</span>
            <span>角色</span>
          </div>
          <div
            v-for="mapping in dmuFieldMappings"
            :key="`${mapping.role}-${mapping.key}-${mapping.dmuName}`"
            class="dmu-mapping-row"
          >
            <span>{{ dmuMappingLabel(mapping.key) }}</span>
            <strong>{{ mapping.dmuName }}</strong>
            <em>{{ dmuRoleLabel(mapping.role) }}</em>
          </div>
        </div>
        <div class="dmu-mapping-preview">
          <span>DAT 列顺序</span>
          <strong>{{ dmuDatColumnPreview }}</strong>
        </div>
        <div class="dmu-summary-strip">
          <span>目标性状 {{ dmuForm.traitColumns.length }} 个</span>
          <span>固定效应 {{ selectedDmuFixedFields.length }} 个</span>
          <span>随机效应 {{ selectedDmuRandomFields.length }} 个</span>
          <span>参评个体 {{ weightedDetailRows.length }} 头</span>
          <span>{{ dmuModelFormulaText }}</span>
        </div>
        <div class="dmu-actions">
          <ElButton type="primary" @click="generateDmuFiles">生成 DIR/DAT</ElButton>
          <ElButton :disabled="!dmuFiles.dirText" @click="downloadDmuFile('dir')"
            >下载 DIR</ElButton
          >
          <ElButton :disabled="!dmuFiles.dataText" @click="downloadDmuFile('数据')"
            >下载 DAT</ElButton
          >
          <ElUpload
            :auto-upload="false"
            :show-file-list="false"
            accept=".sol,.csv,.txt"
            :on-change="importDmuResult"
          >
            <ElButton>导入结果</ElButton>
          </ElUpload>
        </div>
      </FcPanel>

      <FcPanel title="DMU 结果导入">
        <ElTable :data="visibleDmuImportedRows" height="260" @wheel.passive="onDmuTableWheel">
          <ElTableColumn prop="animalId" label="个体" width="120" />
          <ElTableColumn prop="trait" label="性状" width="140" />
          <ElTableColumn prop="value" label="DMU 结果" width="120" />
          <ElTableColumn prop="rank" label="排名" width="90" />
        </ElTable>
        <div v-if="dmuImportedRows.length" class="load-more-row">
          <span>
            当前窗口 {{ dmuImportedStartIndex + 1 }}-{{ dmuImportedEndIndex }} /
            {{ dmuImportedTotalCount }} 条
          </span>
        </div>
      </FcPanel>
    </section>
  </FcPageShell>
</template>

<script setup lang="ts">
  import { computed, reactive, ref, watch } from 'vue'
  import { ElMessage } from 'element-plus'
  import type { UploadFile } from 'element-plus'
  import * as databaseService from '@/services/数据库'
  import {
    buildDmuFiles,
    isDmuExecutorConfigured,
    parseDmuResult,
    type DmuFieldMapping,
    type DmuResultRow
  } from '@/services/dmu-runner'
  import FcPageShell from '@/components/business/fluent-console/FcPageShell.vue'
  import FcMetricTile from '@/components/business/fluent-console/FcMetricTile.vue'
  import FcPanel from '@/components/business/fluent-console/FcPanel.vue'
  import { useLazyGridRenderWindow, useLazyRenderWindow } from '@/hooks'
  import { useUserStore } from '@/store/modules/user'
  import { formatDateOnly } from '@/utils/date-display'
  import { normalizeCattleBreedOrDefault } from '@/utils/cattle-breeds'
  import {
    average,
    buildFemaleCandidateRows,
    buildBullCandidateRows,
    loadBreedingDecisionSnapshot,
    type CandidateScoreRow,
    type PlatformSnapshot
  } from '@/views/breeding-platform/platform-data'
  import { CowGender, CowStatus } from '@/types/cow'
  import {
    buildDictionaryTraitOptions,
    defaultProductionTraitOptions,
    groupTraitOptions,
    traitSelectLabel as dictionaryTraitSelectLabel,
    type DictionaryTraitOption
  } from '@/services/trait-dictionary'
  import { loadUnifiedPhenotypeRecords } from '@/services/unified-records'
  import type { MilkRecord } from '@/types/cow'

  type AnyRow = Record<string, any>
  type TagType = 'primary' | 'success' | 'info' | 'warning' | 'danger'
  type TraitDirection = DictionaryTraitOption['direction']
  type BreedingDecisionSnapshot = {
    femaleRankings?: AnyRow[]
    bullRankings?: AnyRow[]
    cows?: AnyRow[]
    generatedAt?: string
    source?: string
  }

  type TraitOption = DictionaryTraitOption
  type DmuFieldOption = {
    key: string
    label: string
    dmuName: string
    valueType: 'numeric' | 'categorical' | 'text'
    getValue: (row: CandidateScoreRow) => number | string | null
  }

  const snapshot = ref<PlatformSnapshot>({
    cows: [],
    sensors: [],
    milkRecords: [],
    breedingRecords: [],
    alerts: [],
    healthScores: []
  })
  const rows = ref<CandidateScoreRow[]>([])
  const traitOptions = ref<TraitOption[]>([])
  const traitObservationRows = ref<AnyRow[]>([])
  const selectedTrait = ref('milk_yield')
  const weightedTraitCodes = ref<string[]>([])
  const traitWeights = reactive<Record<string, number>>({})
  const selectedEvaluationCowId = ref('')
  const evaluationDetailVisible = ref(false)
  const userStore = useUserStore()
  const dmuMode = ref<'single' | 'multi'>('single')
  const activeDmuPreset = ref('milk-single')

  const defaultTraitOptions: TraitOption[] = defaultProductionTraitOptions
  const dmuForm = reactive({
    jobName: 'nzh_germplasm_eval',
    model: 'animal_model',
    animalIdColumn: 'animal',
    animalIdField: 'cow.cowNumber',
    traitColumns: ['milk_yield'],
    fixedEffectFields: [
      'effect.calvingYear',
      'cow.parity',
      'effect.season',
      'effect.herd',
      'cow.currentPen'
    ],
    randomEffectFields: ['cow.cowNumber'],
    relationshipFileName: 'pedigree.rel',
    dataFileName: 'nzh_germplasm.dat',
    resultFileName: 'nzh_germplasm.SOL',
    missingValue: '-999'
  })
  const dmuFiles = reactive({
    dirFileName: '',
    dataFileName: '',
    dirText: '',
    dataText: '',
    executorConfigured: isDmuExecutorConfigured(),
    message: ''
  })
  const dmuImportedRows = ref<DmuResultRow[]>([])
  const recommendedFixedEffectKeys = [
    'effect.calvingYear',
    'cow.parity',
    'effect.season',
    'effect.herd',
    'cow.currentPen'
  ]
  const milkFixedEffectKeys = [
    'effect.calvingYear',
    'cow.parity',
    'effect.calvingSeason',
    'effect.herd',
    'cow.currentPen',
    'effect.lactationStage',
    'effect.measureMonth'
  ]
  const bodyFixedEffectKeys = [
    'effect.birthYear',
    'effect.measureYear',
    'effect.measureSeason',
    'cow.breed',
    'cow.gender',
    'effect.herd',
    'cow.currentPen',
    'effect.ageMonth'
  ]
  const multiFixedEffectKeys = [
    'effect.calvingYear',
    'cow.parity',
    'effect.season',
    'effect.herd',
    'cow.currentPen',
    'cow.breed',
    'effect.measureBatch'
  ]
  const dmuModelPresets = [
    {
      key: 'milk-single',
      label: '产奶单性状',
      mode: 'single' as const,
      model: 'animal_model',
      traits: ['milk_yield'],
      fixedEffects: milkFixedEffectKeys,
      note: '用于日产奶、305天产奶等泌乳性状先跑通。'
    },
    {
      key: 'body-single',
      label: '体尺单性状',
      mode: 'single' as const,
      model: 'animal_model',
      traits: ['body_weight'],
      fixedEffects: bodyFixedEffectKeys,
      note: '用于体重、体高、体长、胸围等测定性状。'
    },
    {
      key: 'multi-production',
      label: '多性状综合',
      mode: 'multi' as const,
      model: 'multi_trait_animal_model',
      traits: ['milk_yield', 'body_weight', 'milk_fat'],
      fixedEffects: multiFixedEffectKeys,
      note: '把产奶、体尺、奶质放在同一输入矩阵中。'
    }
  ]
  const dmuFixedEffectPresets = [
    { key: 'effect.calvingYear', label: '产犊年', note: '按最近产犊/记录年份分组' },
    { key: 'effect.calvingSeason', label: '产犊季节', note: '按产犊月份折算春夏秋冬' },
    { key: 'cow.parity', label: '胎次', note: '区分一胎、二胎及以上表现' },
    { key: 'effect.season', label: '季节', note: '春夏秋冬环境差异' },
    { key: 'effect.measureSeason', label: '测定季节', note: '按测定日期折算季节' },
    { key: 'effect.herd', label: '场效应', note: '默认本场，可扩展多牧场' },
    { key: 'cow.currentPen', label: '圈舍', note: '饲养单元/栏舍差异' },
    { key: 'cow.breed', label: '品种', note: '品种或杂交背景' },
    { key: 'cow.gender', label: '性别', note: '公母与阶段差异' },
    { key: 'effect.birthYear', label: '出生年', note: '出生批次效应' },
    { key: 'effect.measureYear', label: '测定年', note: '记录年份或批次年份' },
    { key: 'effect.measureMonth', label: '测定月', note: '记录月份或批次效应' },
    { key: 'effect.ageMonth', label: '测定月龄', note: '按出生日期到测定日期分段' },
    { key: 'effect.lactationStage', label: '泌乳阶段', note: 'DIM 分段，适合产奶性状' },
    { key: 'effect.measureBatch', label: '采样批次', note: '按数据来源或记录批次修正' },
    { key: 'effect.operator', label: '记录人/设备', note: '人工或设备采集差异' }
  ]

  const milkRows = computed(() => snapshot.value.milkRecords as AnyRow[])
  const getOperator = () => {
    const info = userStore.info || {}
    return String(info.userName || info.userId || '当前登录账号')
  }

  const candidateByCowId = computed(() =>
    rows.value.reduce<Record<string, CandidateScoreRow>>((result, row) => {
      result[row.cow.id] = row
      return result
    }, {})
  )

  const milkQualityMap = computed(() => {
    const grouped = new Map<string, AnyRow[]>()
    milkRows.value.forEach((record) => {
      const cowId = String(record.cowId ?? record.cow_id ?? '')
      if (!cowId) return
      grouped.set(cowId, [...(grouped.get(cowId) || []), record])
    })

    return Array.from(grouped.entries()).reduce<
      Record<
        string,
        {
          fat: number
          protein: number
          lactose: number
          scc: number
          grade: string
          count: number
          qualityScore: number
        }
      >
    >((result, [cowId, records]) => {
      const qualities = records
        .map((record) => parseQuality(record.milkQuality ?? record.milk_quality ?? record.quality))
        .filter((quality): quality is AnyRow => Boolean(quality))
      if (!qualities.length) return result
      const fat = average(qualities.map((quality) => Number(quality.fat)).filter(Number.isFinite))
      const protein = average(
        qualities.map((quality) => Number(quality.protein)).filter(Number.isFinite)
      )
      const lactose = average(
        qualities.map((quality) => Number(quality.lactose)).filter(Number.isFinite)
      )
      const scc = average(qualities.map((quality) => Number(quality.scc)).filter(Number.isFinite))
      const grade = pickBestGrade(
        qualities.map((quality) => String(quality.grade || '').toUpperCase()).filter(Boolean)
      )
      const qualityScore = calculateQualityScore({ fat, protein, lactose, scc, grade })
      result[cowId] = { fat, protein, lactose, scc, grade, count: qualities.length, qualityScore }
      return result
    }, {})
  })

  const selectedTraitOption = computed(
    () =>
      traitOptions.value.find((item) => item.key === selectedTrait.value) ||
      traitOptions.value[0] ||
      defaultTraitOptions[0]
  )
  const traitOptionGroups = computed(() => groupTraitOptions(traitOptions.value))
  const baseDmuFieldOptions = computed<DmuFieldOption[]>(() => [
    {
      key: 'cow.cowNumber',
      label: '牛号',
      dmuName: 'animal',
      valueType: 'text',
      getValue: (row) => text(row.cow.cowNumber || row.cow.id)
    },
    {
      key: 'cow.id',
      label: '牛只 ID',
      dmuName: 'animal_id',
      valueType: 'text',
      getValue: (row) => text(row.cow.id)
    },
    {
      key: 'cow.parity',
      label: '胎次',
      dmuName: 'parity',
      valueType: 'categorical',
      getValue: (row) => text((row.cow as AnyRow).parity ?? (row.cow as AnyRow).parityNo ?? 0)
    },
    {
      key: 'cow.currentPen',
      label: '当前圈舍',
      dmuName: 'pen',
      valueType: 'categorical',
      getValue: (row) => text(row.cow.currentPen || (row.cow as AnyRow).penName || 'unknown')
    },
    {
      key: 'cow.breed',
      label: '品种',
      dmuName: 'breed',
      valueType: 'categorical',
      getValue: (row) => text(row.cow.breed || 'unknown')
    },
    {
      key: 'cow.gender',
      label: '性别',
      dmuName: 'sex',
      valueType: 'categorical',
      getValue: (row) => text(row.cow.gender || 'unknown')
    },
    {
      key: 'effect.calvingYear',
      label: '产犊年',
      dmuName: 'calving_year',
      valueType: 'categorical',
      getValue: (row) => yearEffect(recentRecordDate(row) || row.cow.updatedAt || row.cow.createdAt)
    },
    {
      key: 'effect.calvingSeason',
      label: '产犊季节',
      dmuName: 'calving_season',
      valueType: 'categorical',
      getValue: (row) =>
        seasonEffect(recentRecordDate(row) || row.cow.updatedAt || row.cow.createdAt)
    },
    {
      key: 'effect.birthYear',
      label: '出生年',
      dmuName: 'birth_year',
      valueType: 'categorical',
      getValue: (row) => yearEffect(row.cow.birthDate || row.cow.createdAt)
    },
    {
      key: 'effect.season',
      label: '季节',
      dmuName: 'season',
      valueType: 'categorical',
      getValue: (row) =>
        seasonEffect(recentRecordDate(row) || row.cow.updatedAt || row.cow.createdAt)
    },
    {
      key: 'effect.measureSeason',
      label: '测定季节',
      dmuName: 'measure_season',
      valueType: 'categorical',
      getValue: (row) =>
        seasonEffect(recentRecordDate(row) || row.cow.updatedAt || row.cow.createdAt)
    },
    {
      key: 'effect.herd',
      label: '场效应',
      dmuName: 'herd',
      valueType: 'categorical',
      getValue: () => 'nzh_farm'
    },
    {
      key: 'effect.measureYear',
      label: '测定年',
      dmuName: 'measure_year',
      valueType: 'categorical',
      getValue: (row) => yearEffect(recentRecordDate(row) || row.cow.updatedAt || row.cow.createdAt)
    },
    {
      key: 'effect.measureMonth',
      label: '测定月',
      dmuName: 'measure_month',
      valueType: 'categorical',
      getValue: (row) =>
        monthEffect(recentRecordDate(row) || row.cow.updatedAt || row.cow.createdAt)
    },
    {
      key: 'effect.ageMonth',
      label: '测定月龄',
      dmuName: 'age_month',
      valueType: 'categorical',
      getValue: (row) => ageMonthEffect(row)
    },
    {
      key: 'effect.lactationStage',
      label: '泌乳阶段',
      dmuName: 'lactation_stage',
      valueType: 'categorical',
      getValue: (row) => lactationStageEffect(row)
    },
    {
      key: 'effect.measureBatch',
      label: '采样批次',
      dmuName: 'measure_batch',
      valueType: 'categorical',
      getValue: (row) => measureBatchEffect(row)
    },
    {
      key: 'effect.operator',
      label: '记录人/设备',
      dmuName: 'operator',
      valueType: 'categorical',
      getValue: (row) => operatorEffect(row)
    },
    {
      key: 'score',
      label: '综合评分',
      dmuName: 'score',
      valueType: 'numeric',
      getValue: (row) => Number(row.score)
    },
    {
      key: 'pedigreeScore',
      label: '系谱指数',
      dmuName: 'pedigree_score',
      valueType: 'numeric',
      getValue: (row) => Number(row.pedigreeScore)
    },
    {
      key: 'genomicScore',
      label: '组学指数',
      dmuName: 'genomic_score',
      valueType: 'numeric',
      getValue: (row) => Number(row.genomicScore)
    },
    {
      key: 'healthScore',
      label: '健康评分',
      dmuName: 'health_score',
      valueType: 'numeric',
      getValue: (row) => Number(row.healthScore)
    },
    {
      key: 'averageMilk',
      label: '平均日产奶',
      dmuName: 'avg_milk',
      valueType: 'numeric',
      getValue: (row) => Number(row.averageMilk)
    }
  ])
  const traitDmuFieldOptions = computed<DmuFieldOption[]>(() =>
    traitOptions.value.map((trait) => ({
      key: `trait.${trait.key}`,
      label: traitSelectLabel(trait),
      dmuName: trait.key,
      valueType: 'numeric',
      getValue: (row) => getTraitValue(row, trait.key)
    }))
  )
  const dmuFieldOptions = computed(() => [
    ...baseDmuFieldOptions.value,
    ...traitDmuFieldOptions.value
  ])
  const dmuFixedFieldOptions = computed(() =>
    dmuFieldOptions.value.filter((option) => option.valueType === 'categorical')
  )
  const dmuRandomFieldOptions = computed(() =>
    dmuFieldOptions.value.filter((option) => ['cow.cowNumber', 'cow.id'].includes(option.key))
  )
  const dmuEffectFieldOptions = computed(() =>
    [...dmuFixedFieldOptions.value, ...dmuRandomFieldOptions.value].filter(
      (option, index, rows) => rows.findIndex((row) => row.key === option.key) === index
    )
  )
  const dmuTraitSelection = computed<string | string[]>({
    get() {
      return dmuMode.value === 'multi'
        ? dmuForm.traitColumns
        : dmuForm.traitColumns[0] || selectedTrait.value
    },
    set(value) {
      const next = Array.isArray(value) ? value : [value]
      dmuForm.traitColumns = next.filter(Boolean)
    }
  })
  const selectedDmuAnimalField = computed(
    () =>
      dmuFieldOptions.value.find((option) => option.key === dmuForm.animalIdField) ||
      dmuFieldOptions.value[0]
  )
  const selectedDmuFixedFields = computed(() =>
    dmuForm.fixedEffectFields
      .map((key) => dmuEffectFieldOptions.value.find((option) => option.key === key))
      .filter((option): option is DmuFieldOption => Boolean(option))
  )
  const selectedDmuRandomFields = computed(() =>
    dmuForm.randomEffectFields
      .map((key) => dmuEffectFieldOptions.value.find((option) => option.key === key))
      .filter((option): option is DmuFieldOption => Boolean(option))
  )
  const selectedDmuTraitFields = computed(() =>
    dmuForm.traitColumns
      .map((code) => traitDmuFieldOptions.value.find((option) => option.key === `trait.${code}`))
      .filter((option): option is DmuFieldOption => Boolean(option))
  )
  const dmuFieldMappings = computed<DmuFieldMapping[]>(() => {
    const animal = selectedDmuAnimalField.value
    return [
      { key: animal.key, dmuName: dmuForm.animalIdColumn || animal.dmuName, role: 'animalId' },
      ...selectedDmuFixedFields.value.map((field) => ({
        key: field.key,
        dmuName: field.dmuName,
        role: 'fixed' as const
      })),
      ...selectedDmuRandomFields.value.map((field) => ({
        key: field.key,
        dmuName: field.dmuName,
        role: 'random' as const
      })),
      ...selectedDmuTraitFields.value.map((field) => ({
        key: field.key,
        dmuName: field.dmuName,
        role: 'trait' as const
      }))
    ]
  })
  const dmuDatColumnPreview = computed(() =>
    dmuFieldMappings.value.map((mapping) => `${mapping.dmuName}(${mapping.role})`).join('  |  ')
  )
  const activeDmuPresetItem = computed(
    () => dmuModelPresets.find((item) => item.key === activeDmuPreset.value) || dmuModelPresets[0]
  )
  const activeDmuPresetLabel = computed(() => activeDmuPresetItem.value?.label || '产奶单性状')
  const dmuRecipeText = computed(() => {
    const traits = dmuForm.traitColumns.map(traitLabel).join('、') || '未选择性状'
    const fixed =
      selectedDmuFixedFields.value.map((field) => field.label).join('、') || '未选择固定效应'
    return `${dmuMode.value === 'single' ? '单性状' : '多性状'}：${traits}；固定效应：${fixed}。`
  })
  const dmuModelFormulaText = computed(() => {
    const traits = selectedDmuTraitFields.value.map((field) => field.dmuName).join('+') || 'trait'
    const fixed = selectedDmuFixedFields.value.map((field) => field.dmuName).join('+') || 'fixed'
    const random = selectedDmuRandomFields.value.map((field) => field.dmuName).join('+') || 'animal'
    return `模型 ${traits} = ${fixed} + ${random}`
  })
  const selectedEvaluationRow = computed(
    () => rows.value.find((row) => row.cow.id === selectedEvaluationCowId.value) || null
  )
  const traitRecordsByCowAndTrait = computed(() => {
    const map = new Map<string, AnyRow[]>()
    const rows = [...traitObservationRows.value, ...(snapshot.value.phenotypeRecords || [])]
    rows.forEach((record) => {
      const cowKeys = [
        record.cowId,
        record.cow_id,
        record.animalId,
        record.animal_id,
        record.cowNumber,
        record.cow_number,
        record.animalNumber,
        record.animal_number
      ]
        .map(text)
        .filter(Boolean)
      const traitCode = text(record.traitCode || record.trait_code || record.code)
      if (!traitCode) return
      cowKeys.forEach((cowKey) => {
        const key = `${cowKey}|${traitCode}`
        map.set(key, [...(map.get(key) || []), record])
      })
    })
    return map
  })

  const phenotypeRanks = computed(() => {
    const option = selectedTraitOption.value
    return rows.value
      .map((row) => {
        const value = getTraitValue(row, option.key)
        return {
          cow: row.cow,
          traitLabel: option.label,
          value,
          displayValue: formatTraitValue(value, option),
          pedigreeScore: row.pedigreeScore,
          genomicScore: row.genomicScore,
          recordCount: getPhenotypeRecordCount(row.cow.id, option.key),
          evidence: `${option.note} 同时关联系谱完整度 ${row.pedigreeScore}%、组学证据 ${row.genomicScore} 分。`
        }
      })
      .filter((item) => item.value !== null)
      .sort((left, right) =>
        option.direction === 'asc'
          ? Number(left.value) - Number(right.value)
          : Number(right.value) - Number(left.value)
      )
      .map((item, index) => ({ ...item, rank: index + 1 }))
  })

  const breedingValueRanks = computed(() =>
    rows.value
      .map((row) => {
        const qualityScore = getQualityScore(row.cow.id)
        const progenyScore = Math.min(
          100,
          row.breedingEvents * 18 + (String(row.cow.gender || '').includes('公') ? 18 : 0)
        )
        const phenotypeScore = Math.round(
          row.milkScore * 0.62 + row.healthScore * 0.2 + qualityScore * 0.18
        )
        const breedingValue = Math.round(
          phenotypeScore * 0.34 +
            row.pedigreeScore * 0.24 +
            row.genomicScore * 0.24 +
            progenyScore * 0.18
        )
        return {
          cow: row.cow,
          rank: 0,
          tag: row.candidateTag,
          breedingValue,
          summary:
            row.averageMilk >= 8
              ? '表型表现稳定，同时结合系谱和组学证据进入高价值候选。'
              : '表型不是最高，但系谱、组学或后代证据支撑遗传改良价值。',
          pedigreeText: `系谱 ${row.pedigreeScore}%`,
          progenyText: `后代/繁殖 ${row.breedingEvents} 条`,
          omicsText: `组学 ${row.genomicScore} 分`,
          scores: [
            { label: '表型', value: phenotypeScore },
            { label: '系谱', value: row.pedigreeScore },
            { label: '组学', value: row.genomicScore },
            { label: '后代', value: progenyScore }
          ]
        }
      })
      .sort((left, right) => right.breedingValue - left.breedingValue)
      .map((item, index) => ({ ...item, rank: index + 1 }))
  )

  const qualityRanks = computed(() =>
    Object.entries(milkQualityMap.value)
      .map(([cowId, quality]) => {
        const row = candidateByCowId.value[cowId]
        if (!row) return null
        return {
          cow: row.cow,
          rank: 0,
          ...quality,
          sccText: quality.scc ? `${Math.round(quality.scc / 1000)}k` : '-',
          evidence: `质量性状来自 ${quality.count} 条奶厅奶质记录，并关联系谱 ${row.pedigreeScore}% 与组学 ${row.genomicScore} 分。`
        }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => right.qualityScore - left.qualityScore)
      .map((item, index) => ({ ...item, rank: index + 1 }))
  )

  const weightedDetailRows = computed(() =>
    rows.value
      .map((row) => ({
        ...row,
        weightedScore: calculateWeightedTraitScore(row)
      }))
      .sort(
        (left, right) =>
          Number(right.weightedScore ?? right.score) - Number(left.weightedScore ?? left.score)
      )
  )
  const {
    visibleItems: visibleWeightedDetailRows,
    startIndex: weightedDetailStartIndex,
    endIndex: weightedDetailEndIndex,
    totalCount: weightedDetailTotalCount,
    handleWheel: onWeightedDetailWheel
  } = useLazyRenderWindow(weightedDetailRows, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })
  const {
    visibleItems: visibleDmuImportedRows,
    startIndex: dmuImportedStartIndex,
    endIndex: dmuImportedEndIndex,
    totalCount: dmuImportedTotalCount,
    handleWheel: onDmuTableWheel
  } = useLazyRenderWindow(dmuImportedRows, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })
  const weightedBreedingValueRanks = computed(() =>
    weightedDetailRows.value
      .map((row) => {
        const base = breedingValueRanks.value.find((item) => item.cow.id === row.cow.id)
        const weighted = Math.round(Number(row.weightedScore ?? row.score ?? 0))
        const progenyScore = Math.min(
          100,
          row.breedingEvents * 18 + (String(row.cow.gender || '').includes('公') ? 18 : 0)
        )
        return {
          cow: row.cow,
          rank: 0,
          tag: base?.tag || row.candidateTag,
          breedingValue: weighted,
          summary:
            base?.summary ||
            (row.averageMilk >= 8
              ? '表型表现稳定，同时结合系谱和组学证据进入高价值候选。'
              : '表型不是最高，但系谱、组学或后代证据支撑遗传改良价值。'),
          pedigreeText: base?.pedigreeText || `系谱 ${row.pedigreeScore}%`,
          progenyText: base?.progenyText || `后代/繁殖 ${row.breedingEvents} 条`,
          omicsText: base?.omicsText || `组学 ${row.genomicScore} 分`,
          scores: (
            base?.scores || [
              { label: '表型', value: row.milkScore },
              { label: '系谱', value: row.pedigreeScore },
              { label: '组学', value: row.genomicScore },
              { label: '后代', value: progenyScore }
            ]
          ).map((score) => (score.label === '表型' ? { ...score, value: weighted } : score))
        }
      })
      .sort((left, right) => right.breedingValue - left.breedingValue)
      .map((item, index) => ({ ...item, rank: index + 1 }))
  )
  const {
    containerRef: phenotypeRankContainerRef,
    visibleItems: visiblePhenotypeRanks,
    handleScroll: onPhenotypeRankScroll,
    handleWheel: onPhenotypeRankWheel
  } = useLazyGridRenderWindow(phenotypeRanks, {
    rowCount: 2,
    minItemWidth: 220,
    gap: 12,
    fallbackColumns: 3,
    mode: 'fixed-window'
  })
  const {
    containerRef: breedingRankContainerRef,
    visibleItems: visibleWeightedBreedingValueRanks,
    handleScroll: onBreedingRankScroll,
    handleWheel: onBreedingRankWheel
  } = useLazyGridRenderWindow(weightedBreedingValueRanks, {
    rowCount: 2,
    minItemWidth: 320,
    gap: 12,
    fallbackColumns: 1,
    mode: 'fixed-window'
  })
  const {
    containerRef: qualityRankContainerRef,
    visibleItems: visibleQualityRanks,
    handleScroll: onQualityRankScroll,
    handleWheel: onQualityRankWheel
  } = useLazyGridRenderWindow(qualityRanks, {
    rowCount: 2,
    minItemWidth: 220,
    gap: 12,
    fallbackColumns: 3,
    mode: 'fixed-window'
  })
  const averageBreedingValue = computed(() =>
    Math.round(average(weightedBreedingValueRanks.value.map((row) => row.breedingValue)))
  )
  const eliteRows = computed(() =>
    weightedBreedingValueRanks.value.filter((row) => row.breedingValue >= 85)
  )
  const weakRows = computed(() => rows.value.filter((row) => row.score < 65))
  const statusText = computed(() => {
    if (!rows.value.length) return '待评估'
    if (eliteRows.value.length >= 3) return '可筛候选池'
    if (qualityRanks.value.length < 3) return '需补质量性状'
    return '可继续评估'
  })

  const queueItems = computed<
    Array<{
      id: string
      kind: string
      title: string
      description: string
      level: string
      tagType: TagType
      tone: 'warning' | 'danger' | 'primary'
    }>
  >(() => [
    ...weightedBreedingValueRanks.value.slice(0, 2).map((row) => ({
      id: `bv-${row.cow.id}`,
      kind: '育种值优先',
      title: `牛号 ${row.cow.cowNumber}`,
      description: `育种值 ${row.breedingValue}，不是只看单个表型，已合并系谱、组学和后代/繁殖证据。`,
      level: '优先',
      tagType: 'success' as TagType,
      tone: 'primary' as const
    })),
    ...phenotypeRanks.value.slice(0, 1).map((row) => ({
      id: `pheno-${row.cow.id}`,
      kind: '表型冠军',
      title: `${row.traitLabel} ${row.cow.cowNumber}`,
      description: `${row.displayValue}，可进入该性状专项复核，但还需结合育种值判断。`,
      level: '专项',
      tagType: 'info' as TagType,
      tone: 'primary' as const
    })),
    ...weakRows.value.slice(0, 1).map((row) => ({
      id: `weak-${row.cow.id}`,
      kind: '待补证据',
      title: `牛号 ${row.cow.cowNumber}`,
      description: '当前评分较低，多由系谱、表型、质量或组学证据缺失引起。',
      level: '待补录',
      tagType: 'warning' as TagType,
      tone: 'warning' as const
    }))
  ])

  const selectedEvaluationDetail = computed(() => {
    const row = selectedEvaluationRow.value
    if (!row) return null
    const quality = milkQualityMap.value[row.cow.id]
    const breedingRank = weightedBreedingValueRanks.value.find((item) => item.cow.id === row.cow.id)
    const phenotypeValue = getTraitValue(row, selectedTrait.value)
    return {
      row,
      breedingValue: breedingRank?.breedingValue || row.score,
      summary:
        breedingRank?.summary || row.decisionSummary || row.supportEvidence.slice(0, 2).join('；'),
      metrics: [
        {
          label: '当前性状',
          value: formatTraitValue(phenotypeValue, selectedTraitOption.value),
          note: selectedTraitOption.value.note
        },
        {
          label: '综合评分',
          value: calculateWeightedTraitScore(row),
          note: '由表型、系谱、组学、繁殖后代证据和当前多性状权重综合计算。'
        },
        {
          label: '系谱完整度',
          value: `${row.pedigreeScore}%`,
          note: '用于传统育种和近交风险复核。'
        },
        { label: '组学证据', value: row.genomicScore, note: '来自已入库组学样本和候选标记证据。' },
        {
          label: '平均泌乳',
          value: `${row.averageMilk.toFixed(1)} kg`,
          note: '来自奶厅泌乳记录，和质量性状联合评价。'
        },
        {
          label: '后代/繁殖记录',
          value: `${row.breedingEvents} 条`,
          note: '用于区分表型冠军和育种值高价值个体。'
        },
        {
          label: '入库依据',
          value: '个体档案、泌乳表型、组学标记和繁殖记录',
          note: '评估数据按牛只编号与牛号关联到单牛。'
        },
        {
          label: '统计口径',
          value: '表型、系谱、组学、繁殖后代和质量性状加权',
          note: '排名不是只按单一表型排序，育种值会合并后代表现。'
        },
        { label: '经办账号', value: getOperator(), note: '当前评估结果由登录账号触发或刷新。' }
      ],
      evidence: [
        {
          label: '奶质质量性状',
          value: quality ? `${quality.qualityScore} 分` : '待补',
          note: quality
            ? `乳脂 ${quality.fat.toFixed(2)}%，乳蛋白 ${quality.protein.toFixed(2)}%，乳糖 ${quality.lactose.toFixed(2)}%，SCC ${Math.round(quality.scc / 1000)}k。`
            : '未发现该牛奶厅质量性状记录。'
        },
        {
          label: '支持证据',
          value: `${row.supportEvidence.length} 条`,
          note:
            row.supportEvidence.slice(0, 4).join('；') ||
            '当前证据不足，建议补齐表型、系谱或组学数据。'
        },
        {
          label: '候选标签',
          value: row.candidateTag,
          note: '该标签来自候选评分规则，可辅助进入优选名单或复核队列。'
        },
        {
          label: '来源记录',
          value: row.cow.id,
          note: `牛号 ${row.cow.cowNumber}，评估时间 ${formatDateOnly(new Date())}。`
        }
      ]
    }
  })

  const announceSelection = () => {
    ElMessage.success(
      `已生成 ${weightedBreedingValueRanks.value.length} 头育种值优先候选，平均育种值 ${averageBreedingValue.value}`
    )
  }

  const selectEvaluationCow = (cowId: string) => {
    selectedEvaluationCowId.value = cowId
    evaluationDetailVisible.value = true
  }

  const loadData = async () => {
    const [definitionRows, categoryRows, legacyDefinitionRows] = await Promise.all([
      databaseService.getTableDataAsync('trait_definition', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('trait_category', { silent: true }).catch(() => []),
      databaseService
        .getTableDataAsync('phenotype-trait-definitions', { silent: true })
        .catch(() => [])
    ])
    traitOptions.value = buildTraitOptions(definitionRows, categoryRows, legacyDefinitionRows)
    if (!traitOptions.value.some((trait) => trait.key === selectedTrait.value))
      selectedTrait.value = traitOptions.value[0]?.key || 'milk_yield'
    if (!weightedTraitCodes.value.length)
      weightedTraitCodes.value = traitOptions.value.slice(0, 3).map((trait) => trait.key)
    weightedTraitCodes.value.forEach((code, index) => {
      traitWeights[code] = traitWeights[code] || (index === 0 ? 50 : index === 1 ? 30 : 20)
    })
    if (
      !dmuForm.traitColumns.length ||
      !traitOptions.value.some((trait) => dmuForm.traitColumns.includes(trait.key))
    ) {
      dmuForm.traitColumns = [selectedTrait.value]
    }
    const backendRows = await loadBackendCandidateRows()
    if (backendRows.length) {
      rows.value = backendRows
      traitObservationRows.value = []
      return
    }

    snapshot.value = await loadBreedingDecisionSnapshot()
    traitObservationRows.value = await loadUnifiedPhenotypeRecords(traitOptions.value).catch(
      () => []
    )
    rows.value = [
      ...buildFemaleCandidateRows(snapshot.value),
      ...buildBullCandidateRows(snapshot.value)
    ]
      .reduce((items, row) => mergeCandidateRow(items, row), [] as CandidateScoreRow[])
      .sort((left, right) => right.score - left.score)
      .slice(0, 28)
  }

  async function loadBackendCandidateRows() {
    try {
      const backendSnapshot = await databaseService.runBackendRpcAsync<BreedingDecisionSnapshot>(
        'getBreedingDecisionSnapshot',
        {},
        { timeout: 60000, showErrorLog: false, showErrorMessage: false }
      )
      const rankingRows = [
        ...(backendSnapshot?.femaleRankings || []),
        ...(backendSnapshot?.bullRankings || [])
      ]
      if (!rankingRows.length) return []
      const cowMap = new Map(
        (backendSnapshot.cows || []).flatMap((cow) => {
          const normalized = normalizeBackendCandidateCow(cow)
          return [normalized.id, normalized.cowNumber]
            .map(text)
            .filter(Boolean)
            .map((key) => [key, normalized] as const)
        })
      )
      const candidateRows = rankingRows
        .map((row) => mapBackendRankingToCandidate(row, cowMap))
        .filter((row): row is CandidateScoreRow => Boolean(row))
        .reduce((items, row) => mergeCandidateRow(items, row), [] as CandidateScoreRow[])
      const topScoreRows = [...candidateRows]
        .sort((left, right) => Number(right.score) - Number(left.score))
        .slice(0, 60)
      const qualityEvidenceRows = candidateRows
        .filter((row) => hasMilkQualityEvidence(row))
        .sort((left, right) => Number(right.score) - Number(left.score))
        .slice(0, 60)
      snapshot.value = {
        cows: dedupeBackendCows(Array.from(cowMap.values())),
        sensors: [],
        milkRecords: buildBackendQualityMilkRecords(rankingRows),
        breedingRecords: [],
        alerts: [],
        healthScores: [],
        phenotypeRecords: []
      }
      return Array.from(
        [...topScoreRows, ...qualityEvidenceRows].reduce(
          (items, row) => mergeCandidateRow(items, row),
          [] as CandidateScoreRow[]
        )
      )
    } catch {
      return []
    }
  }

  function hasMilkQualityEvidence(row: CandidateScoreRow) {
    return ['milk_fat', 'milk_protein', 'milk_lactose', 'somatic_cell_count'].some(
      (code) => Number.isFinite(row.traitValues[code]) && row.traitValues[code] > 0
    )
  }

  function normalizeBackendCandidateCow(row: AnyRow) {
    const cowId = text(row.id || row.cowId || row.cow_id || row.animalId || row.animal_id)
    const cowNumber = text(
      row.cowNumber ||
        row.cow_number ||
        row.animalNumber ||
        row.animal_number ||
        row.number ||
        cowId
    )
    return {
      ...row,
      id: cowId || cowNumber,
      cowNumber: cowNumber || cowId,
      earTagNumber: text(row.earTagNumber || row.ear_tag_number || row.earTag || row.ear_tag),
      fatherNumber: text(
        row.fatherNumber || row.father_number || row.sireNumber || row.sire_number
      ),
      motherNumber: text(row.motherNumber || row.mother_number || row.damNumber || row.dam_number),
      grandfatherNumber: text(row.grandfatherNumber || row.grandfather_number),
      grandmotherNumber: text(row.grandmotherNumber || row.grandmother_number),
      breed: normalizeBreed(row.breed || row.breedType || row.breed_type),
      gender: normalizeGender(row.gender || row.sex),
      birthDate: text(row.birthDate || row.birth_date),
      type: text(row.type || row.cowType || row.cow_type) || '参评牛',
      currentPen:
        text(row.currentPen || row.current_pen || row.penName || row.pen_name) || '新三圈',
      status: normalizeStatus(row.status),
      parity: toNumber(row.parity || row.parityNo || row.parity_no || 0),
      createdAt: text(row.createdAt || row.created_at) || new Date().toISOString(),
      updatedAt: text(row.updatedAt || row.updated_at) || new Date().toISOString()
    } as CandidateScoreRow['cow']
  }

  function candidateCowKey(row: CandidateScoreRow) {
    return text(row.cow.cowNumber) || text(row.cow.id)
  }

  function backendCowKey(cow: CandidateScoreRow['cow']) {
    return text(cow.cowNumber) || text(cow.id)
  }

  function mergeCandidateRow(rows: CandidateScoreRow[], row: CandidateScoreRow) {
    const key = candidateCowKey(row)
    if (!key) return rows
    const index = rows.findIndex((item) => candidateCowKey(item) === key)
    if (index < 0) {
      rows.push(row)
      return rows
    }
    const current = rows[index]
    if (Number(row.score) >= Number(current.score)) {
      rows[index] = {
        ...row,
        supportEvidence: Array.from(
          new Set([...(current.supportEvidence || []), ...(row.supportEvidence || [])])
        ),
        traitRecordCounts: {
          ...(current.traitRecordCounts || {}),
          ...(row.traitRecordCounts || {})
        }
      }
    }
    return rows
  }

  function dedupeBackendCows(cows: CandidateScoreRow['cow'][]) {
    return cows.reduce(
      (items, cow) => {
        const key = backendCowKey(cow)
        if (!key || items.some((item) => backendCowKey(item) === key)) return items
        items.push({
          ...cow,
          breed: normalizeBreed((cow as AnyRow).breed || (cow as AnyRow).breedType),
          gender: normalizeGender((cow as AnyRow).gender || (cow as AnyRow).sex),
          currentPen: text((cow as AnyRow).currentPen || (cow as AnyRow).current_pen) || '新三圈',
          status: normalizeStatus((cow as AnyRow).status)
        })
        return items
      },
      [] as CandidateScoreRow['cow'][]
    )
  }

  function normalizeBreed(value: unknown) {
    return normalizeCattleBreedOrDefault(value)
  }

  function normalizeGender(value: unknown): CowGender {
    const gender = text(value).toLowerCase()
    if (gender.includes('公') || gender === 'male' || gender === 'bull') return CowGender.MALE
    return CowGender.FEMALE
  }

  function normalizeStatus(value: unknown): CowStatus {
    const status = text(value)
    const lower = status.toLowerCase()
    if (status === CowStatus.ABNORMAL || lower === 'abnormal') return CowStatus.ABNORMAL
    if (status === CowStatus.HEAT || lower === 'heat') return CowStatus.HEAT
    if (status === CowStatus.PREGNANT || lower === 'pregnant') return CowStatus.PREGNANT
    if (status === CowStatus.MIXED || lower === 'mixed') return CowStatus.MIXED
    if (status === CowStatus.LEFT || lower === 'left') return CowStatus.LEFT
    return CowStatus.HEALTHY
  }

  function mapBackendRankingToCandidate(
    row: AnyRow,
    cowMap: Map<string, CandidateScoreRow['cow']>
  ): CandidateScoreRow | null {
    const cowId = text(row.cowId || row.cow_id || row.animalId || row.animal_id || row.id)
    const cowNumber = text(row.cowNumber || row.cow_number || row.animalNumber || row.animal_number)
    const cow = cowMap.get(cowId) || cowMap.get(cowNumber) || normalizeBackendCandidateCow(row)
    if (!cow.id && !cow.cowNumber) return null
    const score = clampScore(row.score ?? row.breedingValue ?? row.breeding_value)
    const genomicScore = clampScore(row.genomicScore ?? row.genomic_score)
    const milkScore = clampScore(row.milkScore ?? row.milk_score)
    const pedigreeScore = clampScore(row.pedigreeScore ?? row.pedigree_score)
    const healthScore = clampScore(row.healthScore ?? row.health_score)
    const activityScore = clampScore(row.activityScore ?? row.activity_score)
    const averageMilk = toNumber(row.averageMilk ?? row.average_milk)
    const breedingEvents = toNumber(row.breedingEvents ?? row.breeding_events)
    const milkQualitySummary = (row.milkQualitySummary || row.milk_quality_summary || {}) as AnyRow
    const supportEvidence = Array.isArray(row.supportEvidence)
      ? row.supportEvidence.map(text).filter(Boolean)
      : splitList(text(row.supportEvidence || row.support_evidence))
    const traitValues = {
      score,
      milkScore,
      genomicScore,
      pedigreeScore,
      healthScore,
      activityScore,
      averageMilk,
      breedingEvents,
      breedingValue: clampScore(row.breedingValue ?? row.breeding_value ?? score),
      milk_yield: toNumber(row.milkYield ?? row.milk_yield ?? averageMilk),
      daily_steps: toNumber(row.latestSteps ?? row.latest_steps),
      milk_fat: toNumber(milkQualitySummary.fat),
      milk_protein: toNumber(milkQualitySummary.protein),
      milk_lactose: toNumber(milkQualitySummary.lactose),
      somatic_cell_count: toNumber(milkQualitySummary.scc)
    }
    return {
      cow,
      score,
      genomicScore,
      candidateTag: text(row.candidateTag || row.candidate_tag) || buildCandidateTag(score),
      decisionSummary:
        text(row.decisionSummary || row.decision_summary || row.summary) ||
        '后端基于数据库表型、组学、系谱和繁殖记录计算。',
      supportEvidence: supportEvidence.length
        ? supportEvidence
        : ['后端数据库快照', `综合评分 ${score}`, `育种值 ${traitValues.breedingValue}`],
      pedigreeScore,
      milkScore,
      healthScore,
      activityScore,
      averageMilk,
      latestTemperature: toNullableNumber(row.latestTemperature ?? row.latest_temperature),
      latestSteps: toNullableNumber(row.latestSteps ?? row.latest_steps),
      breedingEvents,
      traitValues,
      traitRecordCounts: {
        score: 1,
        milk_yield: averageMilk ? 1 : 0,
        daily_steps: traitValues.daily_steps ? 1 : 0
      }
    }
  }

  function buildBackendQualityMilkRecords(rankingRows: AnyRow[]): MilkRecord[] {
    return rankingRows.reduce<MilkRecord[]>((records, row) => {
      const quality = row.milkQualitySummary || row.milk_quality_summary
      if (!quality || typeof quality !== 'object') return records
      const cowId = text(row.cowId || row.cow_id || row.animalId || row.animal_id || row.id)
      const cowNumber = text(
        row.cowNumber || row.cow_number || row.animalNumber || row.animal_number
      )
      if (!cowId && !cowNumber) return records
      const fat = toNumber((quality as AnyRow).fat)
      const protein = toNumber((quality as AnyRow).protein)
      const lactose = toNumber((quality as AnyRow).lactose)
      const scc = toNumber((quality as AnyRow).scc)
      if (!fat && !protein && !lactose && !scc) return records
      const gradeText = text((quality as AnyRow).grade || 'A').toUpperCase()
      const grade: MilkRecord['milkQuality']['grade'] =
        gradeText === 'B' || gradeText === 'C' ? gradeText : 'A'
      const now = new Date().toISOString()
      records.push({
        id: `backend-quality-${cowId || cowNumber}`,
        cowId,
        milkingTime: now,
        volume: toNumber(row.averageMilk ?? row.average_milk),
        milkQuality: {
          fat,
          protein,
          lactose,
          scc,
          urea: 0,
          freezingPoint: 0,
          grade
        },
        milkingMethod: 'automatic' as const,
        createdAt: now,
        equipmentId: 'breeding_decision_snapshot',
        notes: cowNumber
      })
      return records
    }, [])
  }

  function clampScore(value: unknown) {
    return Math.max(0, Math.min(100, Math.round(toNumber(value))))
  }

  function buildCandidateTag(score: number) {
    if (score >= 85) return '核心候选'
    if (score >= 75) return '重点跟踪'
    if (score >= 65) return '备选观察'
    return '待补证据'
  }

  function buildTraitOptions(
    definitionRows: AnyRow[],
    categoryRows: AnyRow[],
    legacyRows: AnyRow[]
  ): TraitOption[] {
    return buildDictionaryTraitOptions({
      v2Traits: definitionRows,
      v2Categories: categoryRows,
      legacyTraits: legacyRows,
      includeDefaultProductionTraits: true
    })
  }

  function parseQuality(value: unknown): AnyRow | null {
    if (!value) return null
    if (typeof value === 'object') return value as AnyRow
    try {
      return JSON.parse(String(value)) as AnyRow
    } catch {
      return null
    }
  }

  function pickBestGrade(grades: string[]): string {
    if (grades.includes('A')) return 'A'
    if (grades.includes('B')) return 'B'
    if (grades.includes('C')) return 'C'
    return '-'
  }

  function calculateQualityScore(quality: {
    fat: number
    protein: number
    lactose: number
    scc: number
    grade: string
  }) {
    const fatScore = Math.min(100, Math.round((quality.fat / 8.2) * 100))
    const proteinScore = Math.min(100, Math.round((quality.protein / 5.0) * 100))
    const lactoseScore = Math.min(100, Math.round((quality.lactose / 4.9) * 100))
    const sccScore = quality.scc ? Math.max(30, 100 - Math.round(quality.scc / 8000)) : 70
    const gradeBonus = quality.grade === 'A' ? 8 : quality.grade === 'B' ? 2 : -8
    return Math.max(
      0,
      Math.min(
        100,
        Math.round(
          fatScore * 0.28 + proteinScore * 0.28 + lactoseScore * 0.18 + sccScore * 0.26 + gradeBonus
        )
      )
    )
  }

  function getQualityScore(cowId: string) {
    return Math.round(milkQualityMap.value[cowId]?.qualityScore || 0)
  }

  function getTraitValue(row: CandidateScoreRow, traitKey: string): number | null {
    const observed = getObservedTraitValue(row, traitKey)
    if (observed !== null) return observed
    const quality = milkQualityMap.value[row.cow.id]
    if (traitKey === 'milk_yield') return row.averageMilk || null
    if (traitKey === 'milk_fat') return quality?.fat || null
    if (traitKey === 'milk_protein') return quality?.protein || null
    if (traitKey === 'milk_lactose') return quality?.lactose || null
    if (traitKey === 'somatic_cell_count') return quality?.scc || null
    if (traitKey === 'daily_steps') return row.latestSteps || null
    if (traitKey === 'body_weight') return getBodyWeightValue(row)
    return null
  }

  function getPhenotypeRecordCount(cowId: string, traitKey: string) {
    const observedCount = getObservedTraitRecords(rowIdFromCowId(cowId), traitKey).length
    if (observedCount) return observedCount
    if (
      ['milk_yield', 'milk_fat', 'milk_protein', 'milk_lactose', 'somatic_cell_count'].includes(
        traitKey
      )
    ) {
      return milkRows.value.filter((record) => String(record.cowId ?? record.cow_id) === cowId)
        .length
    }
    if (traitKey === 'daily_steps')
      return snapshot.value.sensors.filter((sensor) => String((sensor as AnyRow).cowId) === cowId)
        .length
    if (traitKey === 'body_weight')
      return getPhenotypeRecords(rowIdFromCowId(cowId), ['body_weight']).length
    return 0
  }

  function formatTraitValue(value: number | null, option: TraitOption) {
    if (value === null) return '-'
    if (option.key === 'somatic_cell_count') return `${Math.round(value / 1000)}k ${option.unit}`
    if (option.key === 'daily_steps') return `${Math.round(value)} ${option.unit}`
    return `${Number(value).toFixed(option.unit === 'kg' || option.unit === 'L' ? 1 : 2)} ${option.unit}`
  }

  function rowIdFromCowId(cowId: string) {
    return rows.value.find((row) => row.cow.id === cowId) || null
  }

  function getPhenotypeRecords(row: CandidateScoreRow | null, traitCodes: string[]) {
    if (!row) return []
    const codeSet = new Set(traitCodes)
    return (snapshot.value.phenotypeRecords || []).filter((record) => {
      const cowKeys = [row.cow.id, row.cow.cowNumber].map((item) => String(item || ''))
      const recordKeys = [record.cowId, record.cow_id, record.cowNumber, record.cow_number].map(
        (item) => String(item || '')
      )
      const matchedCow = recordKeys.some((key) => key && cowKeys.includes(key))
      const matchedTrait = codeSet.has(String(record.traitCode || record.trait_code || ''))
      return matchedCow && matchedTrait
    })
  }

  function getBodyWeightValue(row: CandidateScoreRow) {
    const phenotypeWeights = getPhenotypeRecords(row, ['body_weight'])
      .map((record) => Number(record.value))
      .filter(Number.isFinite)
    if (phenotypeWeights.length) return average(phenotypeWeights)

    const sensorWeights = snapshot.value.sensors
      .filter(
        (sensor) => String((sensor as AnyRow).cowId ?? (sensor as AnyRow).cow_id) === row.cow.id
      )
      .map((sensor) => {
        const payload = ((sensor as AnyRow).payload || {}) as AnyRow
        const vitalSigns = ((sensor as AnyRow).vitalSigns ||
          (sensor as AnyRow).vital_signs ||
          {}) as AnyRow
        return Number(
          payload.bodyWeight ?? payload.weight ?? vitalSigns.bodyWeight ?? vitalSigns.weight
        )
      })
      .filter(Number.isFinite)
    return sensorWeights.length ? average(sensorWeights) : null
  }

  function getObservedTraitRecords(row: CandidateScoreRow | null, traitKey: string) {
    if (!row) return []
    const keys = [row.cow.id, row.cow.cowNumber].map(text).filter(Boolean)
    return keys.flatMap((key) => traitRecordsByCowAndTrait.value.get(`${key}|${traitKey}`) || [])
  }

  function getObservedTraitValue(row: CandidateScoreRow, traitKey: string) {
    const values = getObservedTraitRecords(row, traitKey)
      .map((record) =>
        Number(
          record.value ??
            record.numericValue ??
            record.numeric_value ??
            record.observedValue ??
            record.observed_value
        )
      )
      .filter(Number.isFinite)
    return values.length ? average(values) : null
  }

  function calculateWeightedTraitScore(row: CandidateScoreRow) {
    const selected = weightedTraitCodes.value.length
      ? weightedTraitCodes.value
      : [selectedTrait.value]
    const weightedValues = selected
      .map((code) => {
        const option =
          traitOptions.value.find((trait) => trait.key === code) ||
          defaultTraitOptions.find((trait) => trait.key === code)
        const value = getTraitValue(row, code)
        if (!option || value === null) return null
        const normalized = normalizeTraitScore(value, option)
        const weight = Number(traitWeights[code] ?? 1)
        if (!Number.isFinite(weight) || weight <= 0) return null
        return { normalized, weight }
      })
      .filter((item): item is { normalized: number; weight: number } => Boolean(item))
    const weightSum = weightedValues.reduce((sum, item) => sum + item.weight, 0)
    const traitScore = weightSum
      ? weightedValues.reduce((sum, item) => sum + item.normalized * item.weight, 0) / weightSum
      : row.milkScore
    return Math.round(
      traitScore * 0.42 +
        row.pedigreeScore * 0.18 +
        row.genomicScore * 0.22 +
        Math.min(100, row.breedingEvents * 18) * 0.18
    )
  }

  function normalizeTraitScore(value: number, option: TraitOption) {
    const scale =
      option.direction === 'asc'
        ? 100 -
          Math.min(100, Math.round((value / Math.max(1, traitReferenceMax(option.key))) * 100))
        : Math.min(100, Math.round((value / Math.max(1, traitReferenceMax(option.key))) * 100))
    return Math.max(0, Math.min(100, scale))
  }

  function traitReferenceMax(code: string) {
    if (code === 'milk_yield') return 18
    if (code === 'milk_fat') return 9
    if (code === 'milk_protein') return 6
    if (code === 'milk_lactose') return 6
    if (code === 'somatic_cell_count') return 800000
    if (code === 'body_weight') return 900
    if (code === 'daily_steps') return 18000
    return 100
  }

  function traitLabel(code: string) {
    return traitOptions.value.find((trait) => trait.key === code)?.label || code
  }

  function traitSelectLabel(option: TraitOption) {
    return dictionaryTraitSelectLabel(option)
  }

  function _inferTraitDirection(code: string, label: string): TraitDirection {
    const text = `${code} ${label}`.toLowerCase()
    return /scc|somatic|体细胞|疾病|缺陷|风险|死亡|淘汰/.test(text) ? 'asc' : 'desc'
  }

  function exportRanking() {
    const rows = weightedDetailRows.value.map((row, index) => ({
      rank: index + 1,
      cowNumber: row.cow.cowNumber,
      weightedScore: row.weightedScore,
      originalScore: row.score,
      tag: row.candidateTag,
      pedigree: row.pedigreeScore,
      progeny: row.breedingEvents,
      omics: row.genomicScore,
      traits: weightedTraitCodes.value
        .map((code) => `${traitLabel(code)}:${traitWeights[code] ?? 0}`)
        .join(';')
    }))
    downloadText(
      `种质评估排名_${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(rows),
      'text/csv;charset=utf-8;'
    )
  }

  function generateDmuFiles() {
    if (dmuMode.value === 'single' && dmuForm.traitColumns.length !== 1) {
      dmuForm.traitColumns = [dmuForm.traitColumns[0] || selectedTrait.value]
    }
    if (dmuMode.value === 'multi' && dmuForm.traitColumns.length < 2) {
      ElMessage.warning('多性状模型至少需要选择 2 个目标性状')
      return
    }
    const files = buildDmuFiles(
      {
        jobName: dmuForm.jobName,
        model: dmuForm.model,
        animalIdColumn: dmuForm.animalIdColumn,
        traitColumns: dmuForm.traitColumns,
        fixedEffects: selectedDmuFixedFields.value.map((field) => field.dmuName),
        randomEffects: selectedDmuRandomFields.value.map((field) => field.dmuName),
        fieldMappings: dmuFieldMappings.value,
        relationshipFileName: dmuForm.relationshipFileName,
        dataFileName: dmuForm.dataFileName,
        resultFileName: dmuForm.resultFileName,
        missingValue: dmuForm.missingValue
      },
      weightedDetailRows.value.map((row) => {
        const values = Object.fromEntries(
          dmuFieldOptions.value.map((field) => [
            field.key,
            field.getValue(row) ?? dmuForm.missingValue
          ])
        )
        return {
          animalId: String(
            selectedDmuAnimalField.value?.getValue(row) || row.cow.cowNumber || row.cow.id
          ),
          values
        }
      })
    )
    Object.assign(dmuFiles, files)
    ElMessage.info(files.message)
  }

  function toggleDmuFixedEffect(key: string) {
    const current = new Set(dmuForm.fixedEffectFields)
    if (current.has(key)) current.delete(key)
    else current.add(key)
    dmuForm.fixedEffectFields = Array.from(current).filter((item) =>
      dmuFixedFieldOptions.value.some((option) => option.key === item)
    )
  }

  function applyDefaultFixedEffects() {
    dmuForm.fixedEffectFields = recommendedFixedEffectKeys.filter((key) =>
      dmuFixedFieldOptions.value.some((option) => option.key === key)
    )
  }

  function dmuMappingLabel(key: string) {
    return dmuFieldOptions.value.find((option) => option.key === key)?.label || key
  }

  function dmuRoleLabel(role: DmuFieldMapping['role']) {
    const map: Record<DmuFieldMapping['role'], string> = {
      animalId: '个体',
      fixed: '固定效应',
      random: '随机效应',
      trait: '目标性状'
    }
    return map[role]
  }

  function downloadDmuFile(kind: 'dir' | '数据') {
    if (kind === 'dir')
      downloadText(dmuFiles.dirFileName, dmuFiles.dirText, 'text/plain;charset=utf-8;')
    if (kind === '数据')
      downloadText(dmuFiles.dataFileName, dmuFiles.dataText, 'text/plain;charset=utf-8;')
  }

  async function importDmuResult(file: UploadFile) {
    const rawFile = file.raw
    if (!rawFile) return
    const text = await rawFile.text()
    dmuImportedRows.value = parseDmuResult(text)
    ElMessage.success(`已导入 ${dmuImportedRows.value.length} 条 DMU 结果`)
  }

  function downloadText(fileName: string, text: string, type: string) {
    const blob = new Blob([text.startsWith('\ufeff') ? text : `\ufeff${text}`], { type })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.href = url
    link.download = fileName
    link.click()
    URL.revokeObjectURL(url)
  }

  function toCsv(rows: Record<string, unknown>[]) {
    const headers = Object.keys(rows[0] || {})
    const body = rows
      .map((row) => headers.map((header) => csvCell(row[header])).join(','))
      .join('\n')
    return `${headers.join(',')}\n${body}`
  }

  function csvCell(value: unknown) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`
  }

  function splitList(value: string) {
    return value
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  function recentRecordDate(row: CandidateScoreRow) {
    const keys = [row.cow.id, row.cow.cowNumber].map(text).filter(Boolean)
    const phenotypeDates = keys.flatMap((key) =>
      traitOptions.value.flatMap((trait) =>
        (traitRecordsByCowAndTrait.value.get(`${key}|${trait.key}`) || []).map((record) =>
          text(record.collectionDate || record.collection_date || record.createdAt)
        )
      )
    )
    const milkDates = milkRows.value
      .filter((record) =>
        keys.includes(text(record.cowId || record.cow_id || record.cowNumber || record.cow_number))
      )
      .map((record) =>
        text(record.milkingTime || record.milking_time || record.date || record.recordDate)
      )
    return [...phenotypeDates, ...milkDates]
      .filter(Boolean)
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0]
  }

  function yearEffect(value: unknown) {
    const date = new Date(text(value))
    return Number.isFinite(date.getTime()) ? String(date.getFullYear()) : 'unknown_year'
  }

  function monthEffect(value: unknown) {
    const date = new Date(text(value))
    if (!Number.isFinite(date.getTime())) return 'unknown_month'
    return `${date.getFullYear()}_${String(date.getMonth() + 1).padStart(2, '0')}`
  }

  function seasonEffect(value: unknown) {
    const date = new Date(text(value))
    if (!Number.isFinite(date.getTime())) return 'unknown_season'
    const month = date.getMonth() + 1
    if ([3, 4, 5].includes(month)) return 'spring'
    if ([6, 7, 8].includes(month)) return 'summer'
    if ([9, 10, 11].includes(month)) return 'autumn'
    return 'winter'
  }

  function lactationStageEffect(row: CandidateScoreRow) {
    const parity = toNumber((row.cow as AnyRow).parity ?? (row.cow as AnyRow).parityNo)
    const averageMilk = Number(row.averageMilk || 0)
    if (!parity) return 'unknown_lactation'
    if (averageMilk >= 12) return 'peak'
    if (averageMilk >= 7) return 'mid'
    return 'late_or_dry'
  }

  function ageMonthEffect(row: CandidateScoreRow) {
    const birth = new Date(text(row.cow.birthDate || (row.cow as AnyRow).birth_date))
    const measured = new Date(text(recentRecordDate(row) || row.cow.updatedAt || row.cow.createdAt))
    if (!Number.isFinite(birth.getTime()) || !Number.isFinite(measured.getTime()))
      return 'unknown_age'
    const months = Math.max(
      0,
      (measured.getFullYear() - birth.getFullYear()) * 12 + measured.getMonth() - birth.getMonth()
    )
    if (months < 6) return 'age_0_6m'
    if (months < 12) return 'age_6_12m'
    if (months < 24) return 'age_12_24m'
    if (months < 48) return 'age_24_48m'
    return 'age_48m_plus'
  }

  function measureBatchEffect(row: CandidateScoreRow) {
    const date = recentRecordDate(row)
    const batch = monthEffect(date || row.cow.updatedAt || row.cow.createdAt)
    return batch === 'unknown_month' ? 'batch_unknown' : `batch_${batch}`
  }

  function operatorEffect(row: CandidateScoreRow) {
    const keys = [row.cow.id, row.cow.cowNumber].map(text).filter(Boolean)
    for (const key of keys) {
      for (const trait of traitOptions.value) {
        const record = traitRecordsByCowAndTrait.value.get(`${key}|${trait.key}`)?.[0]
        const operator = text(
          record?.collector ||
            record?.collectorName ||
            record?.collector_name ||
            record?.operatorName ||
            record?.operator_name ||
            record?.source
        )
        if (operator) return operator.replace(/\s+/g, '_')
      }
    }
    return 'operator_unknown'
  }

  function findFirstExistingTrait(codes: string[], fallback = selectedTrait.value) {
    return codes.find((code) => traitOptions.value.some((trait) => trait.key === code)) || fallback
  }

  function applyDmuModelPreset(key: string) {
    const preset = dmuModelPresets.find((item) => item.key === key)
    if (!preset) return
    activeDmuPreset.value = preset.key
    dmuMode.value = preset.mode
    dmuForm.model = preset.model
    const selectedTraits = preset.traits
      .map((trait) => findFirstExistingTrait([trait], ''))
      .filter(Boolean)
    dmuForm.traitColumns =
      preset.mode === 'single'
        ? [selectedTraits[0] || selectedTrait.value]
        : Array.from(new Set([...selectedTraits, selectedTrait.value])).slice(0, 4)
    dmuForm.fixedEffectFields = preset.fixedEffects.filter((effect) =>
      dmuFixedFieldOptions.value.some((option) => option.key === effect)
    )
  }

  function text(value: unknown) {
    return String(value ?? '').trim()
  }

  function toNumber(value: unknown) {
    const numberValue = Number(value)
    return Number.isFinite(numberValue) ? numberValue : 0
  }

  function toNullableNumber(value: unknown) {
    const numberValue = Number(value)
    return Number.isFinite(numberValue) ? numberValue : null
  }

  watch(dmuMode, (mode) => {
    activeDmuPreset.value = ''
    dmuForm.model = mode === 'single' ? 'animal_model' : 'multi_trait_animal_model'
    if (mode === 'single') {
      dmuForm.traitColumns = [dmuForm.traitColumns[0] || selectedTrait.value]
      return
    }
    if (dmuForm.traitColumns.length < 2) {
      dmuForm.traitColumns = Array.from(
        new Set([
          ...(weightedTraitCodes.value.length ? weightedTraitCodes.value : []),
          selectedTrait.value
        ])
      )
        .filter(Boolean)
        .slice(0, 4)
    }
  })

  watch(selectedTrait, (trait) => {
    if (dmuMode.value === 'single') dmuForm.traitColumns = [trait]
  })

  loadData()
</script>

<style scoped lang="scss">
  .fc-metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 14px;
  }

  .ranking-layout,
  .secondary-ranking-layout {
    display: grid;
    gap: 14px;
    min-width: 0;
    max-width: 100%;
  }

  .ranking-layout {
    grid-template-columns: minmax(0, 1.14fr) minmax(280px, 0.72fr);
  }

  .secondary-ranking-layout {
    grid-template-columns: minmax(0, 1fr) minmax(280px, 320px);
  }

  .ranking-layout > :deep(.fc-panel),
  .secondary-ranking-layout > :deep(.fc-panel) {
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
  }

  .trait-switch {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin-bottom: 14px;
    overflow-x: auto;
  }

  .rank-card-grid,
  .quality-grid,
  .rank-card-list,
  .queue-list {
    display: grid;
    gap: 12px;
    min-width: 0;
    max-width: 100%;
  }

  .phenotype-rank-grid {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
  }

  .quality-grid {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
  }

  .rank-card-list {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
  }

  .rank-card-viewport {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    max-height: min(44vh, 380px);
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 2px 4px 10px;
  }

  .rank-card,
  .breeding-card,
  .quality-card,
  .queue-item {
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    box-sizing: border-box;
    padding: 12px;
  }

  .rank-card,
  .breeding-card,
  .quality-card {
    cursor: pointer;
    transition:
      border-color 180ms cubic-bezier(0.16, 1, 0.3, 1),
      background-color 160ms ease,
      box-shadow 180ms cubic-bezier(0.16, 1, 0.3, 1),
      transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .rank-card:hover,
  .breeding-card:hover,
  .quality-card:hover,
  .rank-card:focus-visible,
  .breeding-card:focus-visible,
  .quality-card:focus-visible {
    outline: none;
    background: rgb(248 250 252);
    border-color: rgb(var(--fluent-primary-rgb) / 42%);
    transform: var(--fluent-card-hover-transform);
  }

  .rank-card.is-active,
  .breeding-card.is-active,
  .quality-card.is-active {
    background: rgb(var(--fluent-primary-rgb) / 6%);
    border-color: rgb(var(--fluent-primary-rgb) / 42%);
  }

  .rank-card.is-podium,
  .breeding-card:first-child,
  .quality-card:first-child {
    border-left: 4px solid var(--fluent-primary);
  }

  .rank-head,
  .breeding-main,
  .evidence-row,
  .queue-item {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
    min-width: 0;
  }

  .rank-head {
    flex-wrap: wrap;
  }

  .rank-head > div,
  .breeding-main > div,
  .queue-item > div {
    min-width: 0;
  }

  .rank-index {
    color: var(--fluent-primary);
    font-size: 16px;
    font-weight: 820;
  }

  .rank-card h3,
  .breeding-card h3,
  .quality-card h3,
  .queue-item h3 {
    margin: 8px 0 0;
    color: var(--fluent-text);
    font-size: 17px;
    font-weight: 760;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .rank-value,
  .quality-score,
  .breeding-main strong {
    margin-top: 8px;
    color: var(--fluent-text);
    font-size: 22px;
    font-weight: 820;
  }

  .rank-card p,
  .breeding-card p,
  .quality-card p,
  .queue-item p {
    margin: 8px 0 0;
    color: var(--fluent-text-soft);
    font-size: 13px;
    line-height: 1.55;
    overflow-wrap: anywhere;
  }

  .evidence-row {
    flex-wrap: wrap;
    justify-content: flex-start;
    margin-top: 12px;

    span {
      max-width: 100%;
      padding: 4px 8px;
      overflow: hidden;
      color: var(--fluent-text-soft);
      font-size: 12px;
      background: rgb(255 255 255 / 52%);
      border: 1px solid var(--fluent-border);
      border-radius: 999px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .score-bars {
    display: grid;
    gap: 8px;
    margin-top: 12px;

    div {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr);
      gap: 8px;
      align-items: center;
      color: var(--fluent-text-soft);
      font-size: 12px;
    }
  }

  .quality-metrics {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin-top: 10px;

    span {
      padding: 8px;
      color: var(--fluent-text);
      font-size: 12px;
      background: rgb(255 255 255 / 54%);
      border: 1px solid var(--fluent-border);
      border-radius: var(--fluent-radius-sm);
    }
  }

  .queue-list {
    align-content: start;
  }

  .queue-item {
    border-left: 4px solid var(--fluent-primary);

    &.warning {
      border-left-color: var(--fluent-amber);
    }
  }

  .queue-item span {
    display: block;
    color: var(--fluent-muted);
    font-size: 12px;
    font-weight: 680;
  }

  .evaluation-detail-grid,
  .evidence-detail-list {
    display: grid;
    gap: 12px;
  }

  .evaluation-detail-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-bottom: 14px;
  }

  .evidence-detail-list {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .evaluation-detail-card {
    min-width: 0;
    padding: 12px;

    &.is-main {
      display: flex;
      grid-column: span 2;
      gap: 12px;
      align-items: flex-start;
      justify-content: space-between;
      border-left: 4px solid var(--fluent-primary);
    }

    span {
      color: var(--fluent-muted);
      font-size: 12px;
      font-weight: 680;
    }

    h3,
    strong {
      display: block;
      margin: 6px 0 0;
      color: var(--fluent-text);
      font-size: 18px;
      font-weight: 780;
    }

    p {
      margin: 8px 0 0;
      color: var(--fluent-text-soft);
      line-height: 1.55;
    }
  }

  .load-more-row {
    display: flex;
    justify-content: center;
    padding-top: 12px;
  }

  .dmu-mapping-preview {
    display: grid;
    gap: 6px;
    margin-top: 10px;
    padding: 10px 12px;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    background: var(--fluent-surface-subtle);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius-sm);
  }

  .dmu-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(300px, 0.75fr);
    gap: 14px;
    min-width: 0;
    max-width: 100%;
  }

  .dmu-layout > :deep(.fc-panel) {
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
  }

  .dmu-status,
  .dmu-mode-panel,
  .dmu-recipe-card,
  .dmu-preset-panel,
  .dmu-guide-grid article {
    min-width: 0;
    padding: 12px;
  }

  .dmu-status {
    display: grid;
    gap: 4px;
    margin-bottom: 10px;
    border-left: 4px solid var(--fluent-amber);
  }

  .dmu-status.is-ready {
    border-left-color: var(--fluent-primary);
  }

  .dmu-mode-panel,
  .dmu-preset-head {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
  }

  .dmu-mode-panel {
    margin-bottom: 10px;
  }

  .dmu-model-preset-panel {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 10px;
  }

  .dmu-flow-steps {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 10px;
  }

  .dmu-flow-steps article {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr);
    gap: 2px 8px;
    min-width: 0;
    padding: 10px 11px;
  }

  .dmu-flow-steps span {
    display: inline-grid;
    grid-row: span 2;
    place-items: center;
    width: 30px;
    height: 30px;
    color: rgb(var(--fluent-primary-rgb));
    font-size: 13px;
    font-weight: 820;
    background: rgb(var(--fluent-primary-rgb) / 9%);
    border: 1px solid rgb(var(--fluent-primary-rgb) / 18%);
    border-radius: 8px;
  }

  .dmu-flow-steps strong,
  .dmu-flow-steps small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dmu-flow-steps strong {
    color: var(--fluent-text);
    font-size: 13px;
    font-weight: 780;
    white-space: nowrap;
  }

  .dmu-flow-steps small {
    color: var(--fluent-muted);
    font-size: 12px;
    line-height: 1.42;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .dmu-model-preset {
    display: grid;
    gap: 4px;
    min-width: 0;
    min-height: 96px;
    padding: 10px 11px;
    text-align: left;
    cursor: pointer;
    transition:
      border-color 160ms ease,
      background-color 160ms ease;
  }

  .dmu-model-preset:hover,
  .dmu-model-preset.active {
    background: rgb(var(--fluent-primary-rgb) / 7%);
    border-color: rgb(var(--fluent-primary-rgb) / 36%);
  }

  .dmu-model-preset span,
  .dmu-model-preset small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dmu-model-preset span {
    color: var(--fluent-text);
    font-size: 13px;
    font-weight: 780;
    white-space: nowrap;
  }

  .dmu-model-preset strong {
    color: rgb(var(--fluent-primary-rgb));
    font-size: 12px;
    font-weight: 760;
  }

  .dmu-model-preset small {
    color: var(--fluent-muted);
    font-size: 12px;
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .dmu-preset-panel {
    display: grid;
    gap: 10px;
    margin-bottom: 10px;
  }

  .dmu-recipe-card {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 10px;
    border-color: rgb(var(--fluent-primary-rgb) / 18%);
  }

  .dmu-recipe-card > div {
    min-width: 0;
  }

  .dmu-recipe-card p {
    margin: 6px 0 0;
    color: var(--fluent-text-soft);
    font-size: 12px;
    line-height: 1.55;
    overflow-wrap: anywhere;
  }

  .dmu-effect-chip-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 148px), 1fr));
    max-height: 210px;
    overflow-y: auto;
    gap: 8px;
  }

  .dmu-effect-helper {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 4px 8px;
    min-width: 0;
    padding: 9px 10px;
    color: var(--fluent-text-soft);
    font-size: 12px;
    line-height: 1.45;
    background: rgb(255 255 255 / 72%);
    border: 1px dashed var(--fluent-border);
    border-radius: var(--fluent-radius-sm);

    small {
      grid-column: 1 / -1;
      color: var(--fluent-muted);
    }

    strong {
      min-width: 0;
      overflow: hidden;
      color: var(--fluent-text);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .dmu-effect-chip {
    display: grid;
    gap: 4px;
    min-width: 0;
    padding: 9px 10px;
    text-align: left;
    cursor: pointer;
  }

  .dmu-effect-chip.active {
    border-color: rgb(var(--fluent-primary-rgb) / 44%);
    background: rgb(var(--fluent-primary-rgb) / 8%);
  }

  .dmu-status span,
  .dmu-mode-panel span,
  .dmu-recipe-card span,
  .dmu-preset-head span,
  .dmu-effect-chip small,
  .dmu-guide-grid span {
    color: var(--fluent-muted);
    font-size: 12px;
    font-weight: 680;
  }

  .dmu-status strong,
  .dmu-mode-panel strong,
  .dmu-recipe-card strong,
  .dmu-preset-head strong,
  .dmu-effect-chip span,
  .dmu-guide-grid strong {
    color: var(--fluent-text);
    font-size: 14px;
    font-weight: 780;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .dmu-status p,
  .dmu-mode-panel p {
    margin: 4px 0 0;
    color: var(--fluent-text-soft);
    font-size: 12px;
    line-height: 1.5;
  }

  .dmu-form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 210px), 1fr));
    gap: 10px;
    min-width: 0;
  }

  .dmu-guide-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-top: 10px;
  }

  .dmu-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }

  .dmu-mapping-table {
    display: grid;
    min-width: 0;
    margin-top: 10px;
    overflow: hidden;
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius-sm);
  }

  .dmu-mapping-row {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.9fr) 88px;
    gap: 8px;
    align-items: center;
    min-width: 0;
    padding: 8px 10px;
    background: rgb(255 255 255 / 72%);
    border-top: 1px solid var(--fluent-border);

    &:first-child {
      border-top: 0;
    }

    &.is-head {
      color: var(--fluent-muted);
      font-size: 12px;
      font-weight: 760;
      background: rgb(248 250 252 / 84%);
    }

    span,
    strong,
    em {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    strong {
      color: var(--fluent-text);
      font-size: 13px;
      font-weight: 780;
    }

    em {
      justify-self: start;
      padding: 2px 7px;
      color: rgb(var(--fluent-primary-rgb));
      font-size: 12px;
      font-style: normal;
      font-weight: 760;
      background: rgb(var(--fluent-primary-rgb) / 8%);
      border-radius: 999px;
    }
  }

  .dmu-mapping-preview span {
    color: var(--fluent-muted);
    font-size: 12px;
    font-weight: 680;
  }

  .dmu-mapping-preview strong {
    display: block;
    max-width: 100%;
    overflow-x: auto;
    color: var(--fluent-text);
    font-size: 13px;
    font-weight: 760;
    line-height: 1.55;
    white-space: nowrap;
  }

  .dmu-summary-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    min-width: 0;
    max-width: 100%;
    margin-top: 10px;
    overflow: hidden;
  }

  .dmu-summary-strip span {
    min-width: 0;
    max-width: 100%;
    padding: 5px 9px;
    overflow: hidden;
    color: rgb(var(--fluent-primary-rgb));
    font-size: 12px;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: rgb(var(--fluent-primary-rgb) / 8%);
    border: 1px solid rgb(var(--fluent-primary-rgb) / 16%);
    border-radius: 999px;
  }

  @media (max-width: 1180px) {
    .fc-metric-grid,
    .ranking-layout,
    .secondary-ranking-layout,
    .dmu-layout {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .dmu-layout {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 760px) {
    .fc-metric-grid,
    .ranking-layout,
    .secondary-ranking-layout,
    .dmu-model-preset-panel,
    .dmu-flow-steps,
    .trait-switch,
    .quality-metrics,
    .evaluation-detail-grid,
    .evidence-detail-list,
    .dmu-guide-grid {
      grid-template-columns: 1fr;
    }

    .dmu-mapping-row {
      grid-template-columns: 1fr;
    }

    .rank-head,
    .breeding-main,
    .queue-item,
    .dmu-mode-panel,
    .dmu-recipe-card,
    .dmu-preset-head {
      display: grid;
    }
  }
</style>
