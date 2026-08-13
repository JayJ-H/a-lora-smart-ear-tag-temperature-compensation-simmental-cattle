<template>
  <div class="fluent-page reproduction-tracking">
    <section class="fluent-page-header">
      <div>
        <h1>繁殖与育种记录</h1>
      </div>
      <div class="fluent-page-actions">
        <ElButton @click="resetFilters">
          <ArtSvgIcon icon="ri:refresh-line" class="mr-1" />
          重置
        </ElButton>
        <ElButton type="primary" @click="dialogVisible = true">
          <ArtSvgIcon icon="ri:add-line" class="mr-1" />
          新增记录
        </ElButton>
      </div>
    </section>

    <section class="fluent-metric-grid">
      <div
        v-for="metric in metrics"
        :key="metric.label"
        class="fluent-metric-card"
        :class="metric.className"
      >
        <div class="metric-label">{{ metric.label }}</div>
        <div class="metric-value">{{ metric.value }}</div>
        <div class="metric-note">{{ metric.note }}</div>
      </div>
    </section>

    <section class="fluent-filter-panel">
      <ElForm :inline="true" class="filter-form">
        <ElFormItem label="事件类型">
          <ElSelect v-model="filters.type" clearable placeholder="选择事件类型">
            <ElOption label="发情检测" value="发情检测" />
            <ElOption label="配种" value="配种" />
            <ElOption label="妊娠检查" value="妊娠检查" />
            <ElOption label="产犊" value="产犊" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="结果">
          <ElSelect v-model="filters.result" clearable placeholder="选择结果">
            <ElOption label="正常" value="正常" />
            <ElOption label="妊娠" value="妊娠" />
            <ElOption label="未孕" value="未孕" />
            <ElOption label="待复查" value="待复查" />
            <ElOption label="异常" value="异常" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="单牛筛选">
          <ElSelect
            v-model="filters.cowNumber"
            clearable
            filterable
            placeholder="输入牛号筛选"
            :filter-method="filterCowNumberOptions"
            @visible-change="handleCowNumberDropdown"
          >
            <ElOption
              v-for="card in filteredCowNumberOptions"
              :key="card.cowKey"
              :label="card.cowNumber"
              :value="card.cowNumber"
            />
          </ElSelect>
        </ElFormItem>
      </ElForm>
    </section>

    <section class="reproduction-layout">
      <section class="fluent-table-panel">
        <div class="table-toolbar">
          <div>
            <h2>繁殖与育种事件记录</h2>
          </div>
          <ElTag type="success">{{ filteredRecords.length }} 条</ElTag>
        </div>
        <div
          class="table-lazy-scroll"
          @scroll.passive="onRecordTableScroll"
          @wheel.passive="onRecordTableWheel"
        >
          <ElTable
            :data="visibleFilteredRecords"
            table-layout="auto"
            style="width: 100%"
            class="reproduction-table"
            v-loading="loading"
            @row-click="openRecordDetail"
          >
            <ElTableColumn prop="date" label="日期" width="120" />
            <ElTableColumn prop="cowNumber" label="牛号" width="120" />
            <ElTableColumn prop="type" label="事件类型" width="130">
              <template #default="{ row }">
                <ElTag :type="getTypeTag(row.type)">{{ row.type }}</ElTag>
              </template>
            </ElTableColumn>
            <ElTableColumn prop="result" label="结果" width="100">
              <template #default="{ row }">
                <ElTag :type="getResultTag(row.result)">{{ row.result }}</ElTag>
              </template>
            </ElTableColumn>
            <ElTableColumn prop="parity" label="胎次" width="80" />
            <ElTableColumn prop="latestBreeding" label="最近配种" width="120" />
            <ElTableColumn prop="conceptionStatus" label="受胎状态" width="120" />
            <ElTableColumn prop="calvingInterval" label="产犊间隔" width="110" />
            <ElTableColumn prop="openDays" label="空怀天数" width="100" />
            <ElTableColumn prop="dueDate" label="预产期" width="120" />
            <ElTableColumn prop="operator" label="操作人" width="110" />
            <ElTableColumn prop="risk" label="繁殖风险" width="120">
              <template #default="{ row }">
                <ElTag :type="getRiskTag(row.risk)">{{ row.risk }}</ElTag>
              </template>
            </ElTableColumn>
            <ElTableColumn prop="nextAction" label="下一步动作" min-width="220" />
          </ElTable>
          <div v-if="filteredRecords.length" class="load-more-row">
            <span>
              当前窗口 {{ recordTableStartIndex + 1 }}-{{ recordTableEndIndex }} /
              {{ recordTableTotalCount }} 条
            </span>
          </div>
        </div>
      </section>

      <aside class="fluent-panel kpi-panel">
        <h2>育种效率指标</h2>
        <div v-for="item in kpis" :key="item.name" class="kpi-item">
          <div class="kpi-head">
            <span>{{ item.name }}</span>
            <strong>{{ item.current }}</strong>
          </div>
          <ElProgress :percentage="item.achievement" :stroke-width="8" />
          <small>目标：{{ item.target }}</small>
        </div>
      </aside>
    </section>

    <section class="fluent-panel cow-card-panel">
      <div class="table-toolbar">
        <div>
          <h2>单牛繁育档案</h2>
        </div>
        <ElTag type="success">{{ filteredCowCards.length }} 头</ElTag>
      </div>

      <div
        ref="cowCardContainerRef"
        class="cow-card-scroll"
        v-loading="loading"
        @scroll.passive="onCowCardScroll"
        @wheel.passive="onCowCardWheel"
      >
        <div class="cow-card-grid">
          <article
            v-for="card in visibleCowCards"
            :key="card.cowKey"
            class="cow-repro-card"
            :class="[card.riskClass, { 'is-active': selectedBreedingCard?.cowKey === card.cowKey }]"
            role="button"
            tabindex="0"
            @click="selectBreedingCard(card)"
            @keydown.enter.prevent="selectBreedingCard(card)"
            @keydown.space.prevent="selectBreedingCard(card)"
          >
            <header class="cow-card-head">
              <div>
                <div class="cow-title">
                  <span>{{ card.cowNumber }}</span>
                  <ElTag :type="getRiskTag(card.risk)">{{ card.risk }}</ElTag>
                  <ElTag :type="getStageTag(card.stageStatus)" effect="plain">{{
                    card.stageStatus
                  }}</ElTag>
                </div>
                <p>{{ card.breed }} · {{ card.gender }} · {{ card.pen }}</p>
              </div>
              <div class="cow-status">
                <span>{{ card.conceptionStatus }}</span>
                <small>受胎状态</small>
              </div>
            </header>

            <div class="cow-metrics">
              <div v-for="item in card.metrics" :key="item.label">
                <small>{{ item.label }}</small>
                <strong>{{ item.value }}</strong>
              </div>
            </div>

            <div class="conception-progress">
              <div>
                <span>受胎率</span>
                <strong>{{ card.conceptionRate }}%</strong>
              </div>
              <ElProgress :percentage="card.conceptionRate" :stroke-width="8" :show-text="false" />
            </div>

            <div class="cow-next-action">
              <span>下一步</span>
              <strong>{{ card.nextAction }}</strong>
            </div>

            <div class="event-summary">
              <span>事件进度</span>
              <div class="event-counts">
                <ElTag
                  v-for="item in card.eventCounts"
                  :key="item.label"
                  size="small"
                  :type="item.type"
                >
                  {{ item.label }} {{ item.count }}
                </ElTag>
              </div>
            </div>

            <ol class="event-timeline">
              <li v-for="event in card.previewTimeline" :key="event.id">
                <span class="timeline-dot" :class="`is-${event.tone}`"></span>
                <div>
                  <strong>{{ event.date }} · {{ event.type }}</strong>
                  <p>{{ event.result }} / {{ event.operator }} / {{ event.nextAction }}</p>
                </div>
              </li>
              <li v-if="card.hiddenTimelineCount > 0" class="timeline-more">
                <span class="timeline-dot is-muted"></span>
                <div>
                  <strong>还有 {{ card.hiddenTimelineCount }} 条历史记录</strong>
                  <p>点击牛卡在详情中查看完整繁育链路</p>
                </div>
              </li>
            </ol>
          </article>

          <ElEmpty
            v-if="!filteredCowCards.length && !loading"
            description="暂无符合筛选条件的单牛繁育档案"
          />
        </div>
        <div v-if="filteredCowCards.length > visibleCowCards.length" class="load-more-row">
          <span
            >当前窗口 {{ cowCardStartIndex + 1 }}-{{ cowCardEndIndex }} /
            {{ cowCardTotalCount }} 头</span
          >
        </div>
      </div>
    </section>

    <ElDialog v-model="cardDetailVisible" title="单牛繁育详情" width="880px">
      <div v-if="selectedBreedingCard" class="breeding-detail-grid">
        <section class="breeding-detail-card is-main">
          <div>
            <span>牛号</span>
            <h3>{{ selectedBreedingCard.cowNumber }}</h3>
            <p
              >{{ selectedBreedingCard.breed }} · {{ selectedBreedingCard.gender }} ·
              {{ selectedBreedingCard.pen }}</p
            >
          </div>
          <ElTag :type="getRiskTag(selectedBreedingCard.risk)">{{
            selectedBreedingCard.risk
          }}</ElTag>
        </section>

        <section class="breeding-detail-card">
          <span>受胎状态</span>
          <strong>{{ selectedBreedingCard.conceptionStatus }}</strong>
          <p>{{ selectedBreedingCard.nextAction }}</p>
        </section>

        <section
          class="breeding-detail-card"
          v-for="item in selectedBreedingCard.metrics"
          :key="item.label"
        >
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </section>
      </div>

      <div v-if="selectedBreedingCard" class="detail-event-summary">
        <ElTag
          v-for="item in selectedBreedingCard.eventCounts"
          :key="item.label"
          size="large"
          :type="item.type"
        >
          {{ item.label }} {{ item.count }}
        </ElTag>
      </div>

      <section v-if="selectedBreedingCard" class="event-closure-panel">
        <div class="event-closure-head">
          <div>
            <span>事件闭环</span>
            <strong>{{ selectedEventClosure.trigger }}</strong>
          </div>
          <ElTag :type="selectedEventClosure.tag">{{ selectedEventClosure.status }}</ElTag>
        </div>
        <div class="event-closure-grid">
          <div>
            <span>当前处置</span>
            <strong>{{ selectedEventClosure.action }}</strong>
          </div>
          <div>
            <span>责任人</span>
            <strong>{{ selectedEventClosure.operator }}</strong>
          </div>
          <div>
            <span>佐证记录</span>
            <strong>{{ selectedEventClosure.evidence }}</strong>
          </div>
        </div>
      </section>

      <ol v-if="selectedBreedingCard" class="event-timeline detail-timeline">
        <li v-for="event in selectedBreedingCard.timeline" :key="`detail-${event.id}`">
          <span class="timeline-dot" :class="`is-${event.tone}`"></span>
          <div>
            <strong>{{ event.date }} · {{ event.type }}</strong>
            <p
              >{{ event.result }} / 胎次 {{ event.parity }} / {{ event.operator }} /
              {{ event.nextAction }}</p
            >
          </div>
        </li>
      </ol>
    </ElDialog>

    <ElDialog v-model="recordDetailVisible" title="繁殖事件记录详情" width="760px">
      <div v-if="selectedRecord" class="record-detail-grid">
        <section class="breeding-detail-card is-main">
          <div>
            <span>记录 ID</span>
            <h3>{{ selectedRecord.id }}</h3>
            <p
              >{{ selectedRecord.date }} · {{ selectedRecord.cowNumber }} ·
              {{ selectedRecord.type }}</p
            >
          </div>
          <ElTag :type="getRiskTag(selectedRecord.risk)">{{ selectedRecord.risk }}</ElTag>
        </section>

        <section
          v-for="row in selectedRecordRows"
          :key="row.label"
          class="breeding-detail-card detail-row"
        >
          <span>{{ row.label }}</span>
          <strong>{{ row.value }}</strong>
        </section>
      </div>
    </ElDialog>

    <ElDialog v-model="dialogVisible" title="新增繁殖与育种记录" width="620px">
      <ElForm label-width="96px">
        <ElFormItem label="牛号">
          <ElInput v-model="form.cowNumber" placeholder="输入在册牛号" />
        </ElFormItem>
        <ElFormItem label="事件类型">
          <ElSelect v-model="form.type" class="w-full">
            <ElOption label="发情检测" value="发情检测" />
            <ElOption label="配种" value="配种" />
            <ElOption label="妊娠检查" value="妊娠检查" />
            <ElOption label="产犊" value="产犊" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="结果">
          <ElSelect v-model="form.result" class="w-full">
            <ElOption label="正常" value="正常" />
            <ElOption label="妊娠" value="妊娠" />
            <ElOption label="未孕" value="未孕" />
            <ElOption label="待复查" value="待复查" />
            <ElOption label="异常" value="异常" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="公牛/冻精">
          <div class="form-inline">
            <ElInput v-model="form.bullNumber" placeholder="公牛号" />
            <ElInput v-model="form.semenNumber" placeholder="冻精批号" />
          </div>
        </ElFormItem>
        <ElFormItem label="预产期">
          <ElDatePicker
            v-model="form.dueDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择预产期"
            class="w-full"
          />
        </ElFormItem>
        <ElFormItem label="下一步">
          <ElInput v-model="form.nextAction" />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="dialogVisible = false">取消</ElButton>
        <ElButton type="primary" :loading="saving" @click="createRecord">保存</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, reactive, ref, watch } from 'vue'
  import { ElMessage } from 'element-plus'
  import * as databaseService from '@/services/数据库'
  import { useLazyGridRenderWindow, useLazyRenderWindow } from '@/hooks'
  import { formatDateOnly } from '@/utils/date-display'
  import { normalizeCattleBreedOrDefault } from '@/utils/cattle-breeds'
  import {
    buildUnifiedDataContext,
    loadUnifiedReproductionEvents
  } from '@/services/unified-records'

  type AnyRow = Record<string, any>
  type TagType = 'warning' | 'primary' | 'success' | 'info' | 'danger'

  interface ReproductionRecord {
    id: string
    sourceTable: string
    createdAt: string
    date: string
    cowId: string
    cowNumber: string
    type: string
    result: string
    operator: string
    nextAction: string
    parity: number | string
    latestBreeding: string
    conceptionStatus: string
    calvingInterval: string
    openDays: string
    dueDate: string
    risk: string
  }

  interface CowBreedingCard {
    cowKey: string
    cowNumber: string
    breed: string
    gender: string
    pen: string
    risk: string
    riskClass: string
    conceptionStatus: string
    stageStatus: string
    conceptionRate: number
    nextAction: string
    metrics: Array<{ label: string; value: string | number }>
    eventCounts: Array<{ label: string; count: number; type: TagType }>
    timeline: Array<ReproductionRecord & { tone: string }>
    previewTimeline: Array<ReproductionRecord & { tone: string }>
    hiddenTimelineCount: number
  }

  const EVENT_TYPE_MAP: Record<string, string> = {
    heat: '发情检测',
    estrus: '发情检测',
    insemination: '配种',
    artificial_insemination: '配种',
    breeding: '配种',
    人工授精: '配种',
    pregnancy_check: '妊娠检查',
    pregnancy: '妊娠检查',
    妊检: '妊娠检查',
    calving: '产犊',
    delivery: '产犊',
    分娩: '产犊'
  }

  const dialogVisible = ref(false)
  const cardDetailVisible = ref(false)
  const loading = ref(false)
  const saving = ref(false)
  const filters = reactive({ type: '', result: '', cowNumber: '' })
  const cowNumberOptionKeyword = ref('')
  const form = reactive({
    cowNumber: '',
    type: '发情检测',
    result: '待复查',
    bullNumber: '',
    semenNumber: '',
    dueDate: '',
    nextAction: '安排复查'
  })
  const cows = ref<AnyRow[]>([])
  const records = ref<ReproductionRecord[]>([])
  const reproductionCycles = ref<AnyRow[]>([])
  const selectedBreedingCard = ref<CowBreedingCard | null>(null)
  const recordDetailVisible = ref(false)
  const selectedRecord = ref<ReproductionRecord | null>(null)

  const selectedEventClosure = computed(() => {
    const card = selectedBreedingCard.value
    const latest = card?.timeline?.[0]
    const pending =
      card?.timeline?.find(
        (event) => event.risk !== '正常' || ['待复查', '未孕', '异常'].includes(event.result)
      ) || latest
    const status =
      !pending || card?.risk === '正常' ? '已闭环' : card?.risk === '预产跟踪' ? '跟踪中' : '待处置'

    return {
      status,
      tag: (status === '已闭环'
        ? 'success'
        : status === '跟踪中'
          ? 'warning'
          : 'danger') as TagType,
      trigger: pending ? `${pending.date} ${pending.type}` : '暂无待处置事件',
      action: pending?.nextAction || card?.nextAction || '按繁育计划复核',
      operator: pending?.operator || latest?.operator || '系统同步',
      evidence: card
        ? `${card.timeline.length} 条繁育记录，${card.eventCounts.map((item) => `${item.label}${item.count}`).join(' / ')}`
        : '-'
    }
  })

  const todayIso = () => new Date().toISOString().slice(0, 10)

  const toDateMs = (value: unknown) => {
    if (!value || value === '-') return null
    const time = new Date(String(value)).getTime()
    return Number.isFinite(time) ? time : null
  }

  const formatDate = (value: unknown) => {
    const time = toDateMs(value)
    if (time === null) return '-'
    return new Date(time).toISOString().slice(0, 10)
  }

  const daysBetween = (from: unknown, to: unknown = new Date()) => {
    const start = toDateMs(from)
    const end = to instanceof Date ? to.getTime() : toDateMs(to)
    if (start === null || end === null) return null
    return Math.max(0, Math.round((end - start) / 86400000))
  }

  const normalizeKey = (value: unknown) =>
    String(value || '')
      .trim()
      .toLowerCase()

  const getCowNumber = (cowId: string, fallback = '') => {
    const cow = cows.value.find((item) => String(item.id) === String(cowId))
    return String(cow?.cowNumber || cow?.cow_number || fallback || cowId || '-')
  }

  const findCow = (cowNumber: string) => {
    const key = normalizeKey(cowNumber)
    return cows.value.find((cow) =>
      [
        cow.id,
        cow.cowId,
        cow.cow_id,
        cow.animalId,
        cow.animal_id,
        cow.cowNumber,
        cow.cow_number,
        cow.animalNumber,
        cow.animal_number,
        cow.earTagNumber,
        cow.ear_tag_number,
        cow.number
      ]
        .map(normalizeKey)
        .includes(key)
    )
  }

  const normalizeType = (value: unknown) => {
    const text = String(value || '').trim()
    if (!text) return '繁殖记录'
    return EVENT_TYPE_MAP[text] || EVENT_TYPE_MAP[text.toLowerCase()] || text
  }

  const normalizeResult = (row: AnyRow) => {
    const raw = String(
      row.result ||
        row.pregnancyResult ||
        row.calvingResult ||
        row.deliveryResult ||
        row.status ||
        ''
    ).trim()
    const lower = raw.toLowerCase()
    if (['positive', 'pregnant', 'success', '妊娠', '阳性', '已受胎'].includes(lower)) return '妊娠'
    if (['negative', 'not_pregnant', 'failed', '未孕', '未妊娠', '阴性', '未受胎'].includes(lower))
      return '未孕'
    if (['normal', 'healthy', '正常', '顺产'].includes(lower)) return raw || '正常'
    if (raw) return raw
    const type = normalizeType(row.eventType || row.event_type)
    if (type === '配种' || type === '发情检测') return '正常'
    return '待复查'
  }

  const getCowCycle = (cowId: string, cowNumber = '') =>
    reproductionCycles.value
      .filter((item) => {
        const cycleCowId = String(item.cowId || item.cow_id || '')
        const cycleCowNumber = String(item.cowNumber || item.cow_number || '')
        return (cowId && cycleCowId === cowId) || (cowNumber && cycleCowNumber === cowNumber)
      })
      .sort(
        (a, b) =>
          (toDateMs(b.cycleStart || b.cycle_start || b.createdAt) || 0) -
          (toDateMs(a.cycleStart || a.cycle_start || a.createdAt) || 0)
      )[0]

  const latestRecordByType = (items: ReproductionRecord[], type: string) =>
    items
      .filter((item) => item.type === type)
      .sort((a, b) => (toDateMs(b.date) || 0) - (toDateMs(a.date) || 0))[0]

  const getCowOpenDays = (cow: AnyRow | undefined, cycle: AnyRow | undefined) =>
    daysBetween(
      cycle?.actualCalvingDate ||
        cycle?.actual_calving_date ||
        cycle?.lastCalvingDate ||
        cycle?.last_calving_date ||
        cow?.lastCalvingDate ||
        cow?.last_calving_date ||
        cow?.birthDate ||
        cow?.birth_date
    )

  const buildRecord = (row: AnyRow, source: 'record' | 'event'): ReproductionRecord => {
    const cowFromNumber = findCow(
      row.cowNumber ||
        row.cow_number ||
        row.animalNumber ||
        row.animal_number ||
        row.cowId ||
        row.cow_id ||
        row.animalId ||
        row.animal_id
    )
    const cowId = String(
      row.cowId || row.cow_id || row.animalId || row.animal_id || cowFromNumber?.id || ''
    )
    const cowNumber = String(
      row.cowNumber ||
        row.cow_number ||
        row.animalNumber ||
        row.animal_number ||
        getCowNumber(cowId)
    )
    const cow = cowFromNumber || cows.value.find((item) => String(item.id) === cowId)
    const date = formatDate(
      row.eventTime ||
        row.event_time ||
        row.eventDate ||
        row.event_date ||
        row.breedingDate ||
        row.createdAt
    )
    const type = normalizeType(row.eventType || row.event_type || row.type)
    const result = normalizeResult(row)
    const cycle = getCowCycle(cowId, cowNumber)
    const latestBreeding = formatDate(
      row.breedingDate ||
        row.inseminationDate ||
        row.insemination_date ||
        row.eventTime ||
        row.event_time
    )
    const dueDate = formatDate(
      row.dueDate || row.due_date || cycle?.expectedCalvingDate || cycle?.expected_calving_date
    )
    const openDaysValue = getCowOpenDays(cow, cycle)
    const calvingIntervalValue = Number(
      row.calvingInterval ||
        row.calving_interval ||
        cycle?.calvingInterval ||
        cycle?.calving_interval ||
        0
    )
    const risk =
      openDaysValue !== null && openDaysValue > 150
        ? '空怀偏长'
        : result === '未孕' || result === '异常'
          ? '需复核'
          : dueDate !== '-'
            ? '预产跟踪'
            : '正常'

    return {
      id: `${source}-${row.id || `${cowNumber}-${date}-${type}`}`,
      sourceTable: String(
        row.sourceTable ||
          row.source_table ||
          (source === 'event' ? 'breeding-events' : 'breeding-records')
      ),
      createdAt: String(
        row.createdAt || row.created_at || row.eventTime || row.event_time || row.breedingDate || ''
      ),
      date,
      cowId,
      cowNumber,
      type,
      result,
      operator: String(
        row.operator || row.person || row.technician || row.technicianId || '系统同步'
      ),
      nextAction: String(
        row.nextAction ||
          row.next_action ||
          row.notes ||
          row.followUp ||
          row.follow_up ||
          (type === '配种' ? '21 天后妊娠检查' : '安排复查')
      ),
      parity: Number(cow?.parity ?? row.parity ?? cycle?.parity ?? 0) || '-',
      latestBreeding: type === '配种' ? date : latestBreeding,
      conceptionStatus: result === '妊娠' ? '已受胎' : result === '未孕' ? '未受胎' : '待确认',
      calvingInterval: calvingIntervalValue ? `${calvingIntervalValue} 天` : '-',
      openDays: openDaysValue === null ? '-' : `${openDaysValue} 天`,
      dueDate,
      risk
    }
  }

  const loadData = async () => {
    loading.value = true
    try {
      const context = await buildUnifiedDataContext()
      const unified = await loadUnifiedReproductionEvents(context)

      cows.value = context.cows
      reproductionCycles.value = Array.isArray(unified.cycles) ? unified.cycles : []
      const primary = (Array.isArray(unified.events) ? unified.events : []).map((item) =>
        buildRecord(item, item.sourceTable === 'breeding-records' ? 'record' : 'event')
      )
      const seen = new Set<string>()
      records.value = primary
        .filter((item) => {
          const key = `${item.cowNumber}-${item.date}-${item.type}-${item.result}-${item.nextAction}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .sort((a, b) => (toDateMs(b.date) || 0) - (toDateMs(a.date) || 0))
    } catch (error: any) {
      ElMessage.error(error?.message || '加载繁殖与育种记录失败')
    } finally {
      loading.value = false
    }
  }

  const filteredRecords = computed(() =>
    records.value.filter((item) => {
      if (filters.type && item.type !== filters.type) return false
      if (filters.result && item.result !== filters.result) return false
      if (filters.cowNumber && item.cowNumber !== filters.cowNumber) return false
      return true
    })
  )

  const cowCards = computed<CowBreedingCard[]>(() => {
    const grouped = new Map<string, ReproductionRecord[]>()
    records.value.forEach((record) => {
      const key = record.cowId || record.cowNumber
      if (!key) return
      grouped.set(key, [...(grouped.get(key) || []), record])
    })

    return Array.from(grouped.entries())
      .map(([cowKey, items]) => {
        const sorted = [...items].sort((a, b) => (toDateMs(b.date) || 0) - (toDateMs(a.date) || 0))
        const first = sorted[0]
        const cow =
          findCow(first.cowNumber) || cows.value.find((item) => String(item.id) === first.cowId)
        const latestBreeding = latestRecordByType(sorted, '配种')
        const latestPregnancy = latestRecordByType(sorted, '妊娠检查')
        const latestCalving = latestRecordByType(sorted, '产犊')
        const openDays =
          first.openDays !== '-' ? first.openDays : latestCalving ? '0 天' : first.openDays
        const dueDate = sorted.find((item) => item.dueDate !== '-')?.dueDate || '-'
        const riskPriority = ['空怀偏长', '需复核', '预产跟踪']
        const risk =
          riskPriority.find((item) => sorted.some((record) => record.risk === item)) || '正常'
        const conceptionStatus =
          latestPregnancy?.conceptionStatus ||
          latestBreeding?.conceptionStatus ||
          first.conceptionStatus
        const nextAction =
          sorted.find((item) => item.risk !== '正常')?.nextAction || first.nextAction
        const eventCount = (type: string) => sorted.filter((item) => item.type === type).length
        const breedingCount = eventCount('配种')
        const pregnantCount = sorted.filter(
          (item) => item.conceptionStatus === '已受胎' || item.result === '妊娠'
        ).length
        const conceptionRate = breedingCount
          ? Math.min(100, Math.round((pregnantCount / breedingCount) * 100))
          : conceptionStatus === '已受胎'
            ? 100
            : 0
        const stageStatus = getStageStatus(cow, conceptionStatus, openDays, latestCalving, dueDate)

        const timeline = sorted.map((item) => ({
          ...item,
          tone: item.risk === '正常' ? 'green' : item.risk === '预产跟踪' ? 'yellow' : 'red'
        }))
        return {
          cowKey,
          cowNumber: first.cowNumber,
          breed: normalizeCattleBreedOrDefault(cow?.breed || cow?.variety),
          gender: String(cow?.gender || '母'),
          pen: String(cow?.pen || cow?.penName || cow?.barn || '未分栏'),
          risk,
          riskClass:
            risk === '正常' ? 'is-normal' : risk === '预产跟踪' ? 'is-warning' : 'is-danger',
          conceptionStatus,
          stageStatus,
          conceptionRate,
          nextAction,
          metrics: [
            { label: '胎次', value: first.parity },
            { label: '最近配种', value: latestBreeding?.date || '-' },
            { label: '妊检结果', value: latestPregnancy?.result || '-' },
            { label: '产犊间隔', value: latestCalving?.calvingInterval || first.calvingInterval },
            { label: '空怀天数', value: openDays },
            { label: '预产期', value: dueDate }
          ],
          eventCounts: [
            { label: '发情', count: eventCount('发情检测'), type: 'warning' as TagType },
            { label: '配种', count: eventCount('配种'), type: 'primary' as TagType },
            { label: '妊检', count: eventCount('妊娠检查'), type: 'success' as TagType },
            { label: '产犊', count: eventCount('产犊'), type: 'info' as TagType }
          ],
          timeline,
          previewTimeline: timeline.slice(0, 4),
          hiddenTimelineCount: Math.max(0, timeline.length - 4)
        }
      })
      .sort((left, right) => {
        const riskOrder = { 'is-danger': 0, 'is-warning': 1, 'is-normal': 2 }
        const leftOrder = riskOrder[left.riskClass as keyof typeof riskOrder] ?? 3
        const rightOrder = riskOrder[right.riskClass as keyof typeof riskOrder] ?? 3
        if (leftOrder !== rightOrder) return leftOrder - rightOrder
        return right.timeline.length - left.timeline.length
      })
  })

  const filteredCowCards = computed(() =>
    cowCards.value.filter((card) => {
      if (filters.cowNumber && card.cowNumber !== filters.cowNumber) return false
      if (filters.type && !card.timeline.some((item) => item.type === filters.type)) return false
      if (filters.result && !card.timeline.some((item) => item.result === filters.result))
        return false
      return true
    })
  )
  const filteredCowNumberOptions = computed(() => {
    const keyword = normalizeKey(cowNumberOptionKeyword.value || filters.cowNumber)
    const options = keyword
      ? cowCards.value.filter((card) =>
          [card.cowNumber, card.cowKey].some((value) => normalizeKey(value).includes(keyword))
        )
      : cowCards.value
    return options.slice(0, 30)
  })
  const filterCowNumberOptions = (keyword: string) => {
    cowNumberOptionKeyword.value = keyword
  }
  const handleCowNumberDropdown = (visible: boolean) => {
    if (!visible) cowNumberOptionKeyword.value = ''
  }
  const {
    visibleItems: visibleFilteredRecords,
    startIndex: recordTableStartIndex,
    endIndex: recordTableEndIndex,
    totalCount: recordTableTotalCount,
    handleScroll: onRecordTableScroll,
    handleWheel: onRecordTableWheel
  } = useLazyRenderWindow(filteredRecords, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })
  const {
    containerRef: cowCardContainerRef,
    visibleItems: visibleCowCards,
    startIndex: cowCardStartIndex,
    endIndex: cowCardEndIndex,
    totalCount: cowCardTotalCount,
    resetVisibleCount: resetCowCardWindow,
    handleScroll: onCowCardScroll,
    handleWheel: onCowCardWheel
  } = useLazyGridRenderWindow(filteredCowCards, {
    rowCount: 2,
    minItemWidth: 300,
    gap: 12,
    fallbackColumns: 4,
    mode: 'fixed-window'
  })

  const metrics = computed(() => {
    const total = records.value.length
    const heatCount = records.value.filter((item) => item.type === '发情检测').length
    const pregnant = cowCards.value.filter((item) => item.conceptionStatus === '已受胎').length
    const calvingIntervals = records.value
      .map((item) => Number(String(item.calvingInterval).replace(/\D/g, '')))
      .filter((item) => Number.isFinite(item) && item > 0)
    const avgCalvingInterval = Math.round(
      calvingIntervals.reduce((sum, item) => sum + item, 0) / Math.max(1, calvingIntervals.length)
    )
    const highRisk = cowCards.value.filter((item) => item.risk !== '正常').length

    return [
      {
        label: '发情检测率',
        value: `${total ? Math.round((heatCount / total) * 100) : 0}%`,
        note: '目标 >= 90%',
        className: ''
      },
      {
        label: '单牛受胎率',
        value: `${cowCards.value.length ? Math.round((pregnant / cowCards.value.length) * 100) : 0}%`,
        note: '按牛卡当前受胎状态统计',
        className: 'is-teal'
      },
      {
        label: '产犊间隔',
        value: avgCalvingInterval ? `${avgCalvingInterval}天` : '-',
        note: '目标 365-400 天',
        className: 'is-warning'
      },
      {
        label: '风险牛卡',
        value: highRisk,
        note: '空怀偏长、未孕或预产待跟踪',
        className: 'is-info'
      }
    ]
  })

  const kpis = computed(() => {
    const bred = records.value.filter((item) => item.type === '配种').length
    const pregnant = records.value.filter((item) => item.conceptionStatus === '已受胎').length
    const pregnancyChecks = records.value.filter((item) => item.type === '妊娠检查').length
    const calvingRows = records.value.filter((item) => item.type === '产犊').length
    const firstServiceRate = bred ? Math.round((pregnant / bred) * 100) : 0
    const checkRate = bred ? Math.min(100, Math.round((pregnancyChecks / bred) * 100)) : 0
    const calvingRate = pregnant ? Math.min(100, Math.round((calvingRows / pregnant) * 100)) : 0
    return [
      {
        name: '一次受胎率',
        current: `${firstServiceRate}%`,
        target: '>= 70%',
        achievement: firstServiceRate
      },
      {
        name: '妊娠检查准时率',
        current: `${checkRate}%`,
        target: '>= 90%',
        achievement: checkRate
      },
      { name: '产犊完成率', current: `${calvingRate}%`, target: '>= 92%', achievement: calvingRate }
    ]
  })

  const resetFilters = () => {
    filters.type = ''
    filters.result = ''
    filters.cowNumber = ''
    resetCowCardWindow()
    void loadData()
  }

  const selectBreedingCard = (card: CowBreedingCard) => {
    selectedBreedingCard.value = card
    cardDetailVisible.value = true
  }

  const formatDateTime = (value: unknown) => {
    return formatDateOnly(value, '-')
  }

  const selectedRecordRows = computed(() => {
    const record = selectedRecord.value
    if (!record) return []
    return [
      { label: '牛号', value: record.cowNumber },
      { label: 'cowId', value: record.cowId || '-' },
      { label: '事件类型', value: record.type },
      { label: '事件结果', value: record.result },
      { label: '胎次', value: String(record.parity) },
      { label: '最近配种', value: record.latestBreeding || '-' },
      { label: '受胎状态', value: record.conceptionStatus },
      { label: '预产期', value: record.dueDate || '-' },
      { label: '空怀天数', value: record.openDays },
      { label: '下一步动作', value: record.nextAction },
      { label: '操作人', value: record.operator },
      {
        label: '关联台账',
        value: record.sourceTable === 'breeding-events' ? '繁殖事件台账' : '繁殖记录台账'
      },
      { label: '入库依据', value: '繁殖事件、配种记录、妊检记录、繁殖周期和单牛档案' },
      { label: '统计口径', value: '按牛只编号和牛号关联单牛繁殖周期、配种、妊检、产犊事件' },
      { label: '创建时间', value: formatDateTime(record.createdAt) }
    ]
  })

  const openRecordDetail = (record: ReproductionRecord) => {
    selectedRecord.value = record
    recordDetailVisible.value = true
  }

  const createRecord = async () => {
    const cow = findCow(form.cowNumber)
    if (!cow) {
      ElMessage.warning('请先填写已在册的牛号')
      return
    }

    saving.value = true
    try {
      const now = new Date()
      const idSuffix = `${cow.id}-${now.getTime()}`
      const cowNumber = String(cow.cowNumber || cow.cow_number || form.cowNumber)
      const eventDate = todayIso()
      const eventTypeCode =
        form.type === '配种'
          ? 'insemination'
          : form.type === '妊娠检查'
            ? 'pregnancy_check'
            : form.type === '产犊'
              ? 'calving'
              : 'heat'

      await databaseService.addTableDataAsync('breeding-records', {
        id: `breed-${idSuffix}`,
        cowId: cow.id,
        eventTime: now.toISOString(),
        eventType: eventTypeCode,
        result: form.result,
        cowNumber,
        bullNumber: form.bullNumber,
        semenNumber: form.semenNumber,
        dueDate: form.dueDate,
        nextAction: form.nextAction,
        notes: form.nextAction,
        createdAt: now.toISOString()
      })

      await databaseService.addTableDataAsync('breeding-events', {
        id: `breed-event-${idSuffix}`,
        cowNumber,
        eventTime: now.toISOString(),
        eventDate,
        eventType: form.type,
        person: '当前用户',
        bullNumber: form.bullNumber,
        semenNumber: form.semenNumber,
        breedingMethod: form.type === '配种' ? '人工授精' : '',
        pregnancyResult: form.type === '妊娠检查' ? form.result : '',
        dueDate: form.dueDate,
        notes: form.nextAction,
        createdAt: now.toISOString()
      })

      // 同时写入统一事件表（cow-events）
      const unifiedType =
        form.type === '配种'
          ? 'breeding'
          : form.type === '妊娠检查'
            ? 'pregnancy_check'
            : form.type === '产犊'
              ? 'calving'
              : 'breeding'

      await databaseService.addCowEvent({
        id: `breed-cowevent-${idSuffix}`,
        cowId: cow.id || '',
        cowNumber,
        eventType: unifiedType,
        eventTime: now.toISOString(),
        operatorName: '当前用户',
        details: {
          method: form.type === '配种' ? '人工授精' : '',
          semenBatch: form.semenNumber || undefined,
          bullNumber: form.bullNumber || undefined,
          result: form.result || undefined,
          expectedDueDate: form.dueDate || undefined
        },
        notes: form.nextAction
      })

      if (form.type === '配种' || form.type === '妊娠检查') {
        await databaseService.addTableDataAsync('reproduction-cycles', {
          id: `cycle-${idSuffix}`,
          cowId: cow.id,
          cowNumber,
          cycleStart: now.toISOString(),
          cycleStartDate: eventDate,
          inseminationDate: form.type === '配种' ? eventDate : undefined,
          pregnancyConfirmedDate:
            form.type === '妊娠检查' && form.result === '妊娠' ? eventDate : undefined,
          expectedCalvingDate: form.dueDate || undefined,
          cycleResult:
            form.result === '妊娠'
              ? 'pregnant'
              : form.result === '未孕'
                ? 'not_pregnant'
                : 'ongoing',
          inseminationCount: form.type === '配种' ? 1 : 0,
          notes: form.nextAction,
          createdAt: now.toISOString()
        })
      }

      ElMessage.success('繁殖与育种记录已写入生产数据表')
      form.cowNumber = ''
      form.bullNumber = ''
      form.semenNumber = ''
      form.dueDate = ''
      form.nextAction = '安排复查'
      dialogVisible.value = false
      await loadData()
    } catch (error: any) {
      ElMessage.error(error?.message || '提交失败')
    } finally {
      saving.value = false
    }
  }

  const getTypeTag = (type: string): TagType => {
    if (type === '发情检测') return 'warning'
    if (type === '配种') return 'primary'
    if (type === '妊娠检查') return 'success'
    return 'info'
  }

  const getResultTag = (result: string): TagType => {
    if (result === '异常' || result === '未孕') return 'danger'
    if (result === '待复查') return 'warning'
    return 'success'
  }

  const getRiskTag = (risk: string): TagType => {
    if (risk === '空怀偏长' || risk === '需复核') return 'danger'
    if (risk === '预产跟踪') return 'warning'
    return 'success'
  }

  const getStageStatus = (
    cow: AnyRow | undefined,
    conceptionStatus: string,
    openDays: string,
    latestCalving: ReproductionRecord | undefined,
    dueDate: string
  ) => {
    const raw = String(cow?.status || cow?.productionStatus || cow?.production_status || '').trim()
    if (/干奶|dry/i.test(raw)) return '干奶'
    if (conceptionStatus === '已受胎' || dueDate !== '-') return '妊娠'
    const openDayNumber = Number(String(openDays).replace(/\D/g, ''))
    if (Number.isFinite(openDayNumber) && openDayNumber > 0 && !latestCalving) return '空怀'
    if (conceptionStatus === '未受胎') return '空怀'
    return raw || '空怀'
  }

  const getStageTag = (status: string): TagType => {
    if (status === '妊娠') return 'success'
    if (status === '干奶') return 'info'
    if (status === '空怀') return 'warning'
    return 'primary'
  }

  watch(
    () => [filters.type, filters.result, filters.cowNumber, records.value.length],
    resetCowCardWindow
  )

  onMounted(loadData)

  defineOptions({ name: 'ReproductionTracking' })
</script>

<style scoped lang="scss">
  .metric-label,
  .metric-note {
    color: var(--fluent-text-soft);
  }

  .metric-value {
    margin: 6px 0;
    color: var(--fluent-text);
    font-size: 22px;
    font-weight: 780;
  }

  .filter-form {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .form-inline {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    width: 100%;
  }

  .reproduction-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 14px;
    margin-bottom: 14px;
  }

  .table-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;

    h2 {
      margin: 0;
      color: var(--fluent-text);
      font-size: 16px;
    }

    p {
      margin: 4px 0 0;
      color: var(--fluent-text-soft);
    }
  }

  .kpi-panel {
    display: grid;
    align-content: start;
    gap: 12px;

    h2 {
      margin: 0;
      color: var(--fluent-text);
      font-size: 16px;
    }
  }

  .kpi-item {
    display: grid;
    gap: 8px;
    padding: 10px;
    background: var(--fluent-surface);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius-sm);

    small {
      color: var(--fluent-text-soft);
    }
  }

  .kpi-head {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    color: var(--fluent-text);
  }

  .reproduction-table {
    :deep(.el-table__body tr) {
      cursor: pointer;
      transition: background-color 160ms ease;
    }

    :deep(.el-table__body tr:hover) {
      background: rgb(240 253 244 / 72%);
    }
  }

  .table-lazy-scroll {
    max-width: 100%;
    max-height: 360px;
    overflow: auto;
  }

  .cow-card-panel {
    margin-top: 14px;
  }

  .cow-card-scroll {
    max-height: calc((300px * 2) + 18px);
    overflow-y: auto;
    padding-right: 6px;
    overscroll-behavior: contain;
  }

  .cow-card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 12px;
  }

  .cow-repro-card {
    display: grid;
    gap: 10px;
    padding: 12px;
    background: var(--fluent-surface);
    border: 1px solid var(--fluent-border);
    border-left: 4px solid #4caf50;
    border-radius: var(--fluent-radius-sm);
    cursor: pointer;
    transition:
      border-color 180ms cubic-bezier(0.16, 1, 0.3, 1),
      background-color 160ms ease,
      box-shadow 180ms cubic-bezier(0.16, 1, 0.3, 1),
      transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
    box-shadow: var(--fluent-inset-highlight), var(--fluent-shadow);
    backdrop-filter: var(--fluent-blur);
    -webkit-backdrop-filter: var(--fluent-blur);

    &.is-warning {
      border-left-color: #f5a623;
    }

    &.is-danger {
      border-left-color: #d13438;
    }

    &:hover,
    &:focus-visible {
      outline: none;
      background: rgb(248 250 252);
      box-shadow: var(--fluent-inset-highlight), var(--fluent-shadow-hover);
      transform: var(--fluent-card-hover-transform);
    }

    &.is-active {
      border-color: rgb(74 124 89 / 46%);
      background: rgb(74 124 89 / 7%);
    }
  }

  .cow-card-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    min-width: 0;

    > div:first-child {
      min-width: 0;
    }

    p {
      margin: 6px 0 0;
      color: var(--fluent-text-soft);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .cow-title {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    min-width: 0;

    > span {
      min-width: 0;
      overflow: hidden;
      color: var(--fluent-text);
      font-size: 18px;
      font-weight: 760;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .el-tag {
      flex: 0 0 auto;
    }
  }

  .cow-status {
    display: grid;
    min-width: 88px;
    text-align: right;

    span {
      color: var(--fluent-text);
      font-weight: 720;
    }

    small {
      color: var(--fluent-text-soft);
    }
  }

  .cow-metrics {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;

    div {
      display: grid;
      gap: 4px;
      padding: 8px;
      background: var(--fluent-surface-subtle);
      border: 1px solid var(--fluent-border);
      border-radius: var(--fluent-radius-sm);
    }

    small {
      color: var(--fluent-text-soft);
    }

    strong {
      color: var(--fluent-text);
      font-size: 15px;
    }
  }

  .conception-progress {
    display: grid;
    gap: 8px;
    padding: 10px 12px;
    background: var(--fluent-surface-subtle);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius-sm);

    div {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    span {
      color: var(--fluent-text-soft);
      font-size: 13px;
    }

    strong {
      color: var(--fluent-text);
      font-size: 15px;
    }
  }

  .cow-next-action {
    display: grid;
    gap: 4px;
    padding: 10px;
    background: rgb(235 248 239 / 70%);
    border: 1px solid rgb(88 170 92 / 26%);
    border-radius: var(--fluent-radius-sm);

    span {
      color: var(--fluent-text-soft);
      font-size: 13px;
    }

    strong {
      color: var(--fluent-text);
    }
  }

  .load-more-row {
    display: flex;
    justify-content: center;
    padding-top: 14px;
  }

  .event-summary {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: 12px;
    color: var(--fluent-text-soft);

    > span {
      padding-top: 3px;
      white-space: nowrap;
    }
  }

  .event-counts {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;
    min-width: 0;
  }

  .event-timeline {
    display: grid;
    gap: 10px;
    max-height: 180px;
    padding: 0;
    margin: 0;
    overflow-y: auto;
    list-style: none;

    li {
      display: grid;
      grid-template-columns: 12px minmax(0, 1fr);
      gap: 10px;
    }

    strong {
      color: var(--fluent-text);
      font-size: 14px;
    }

    p {
      margin: 3px 0 0;
      color: var(--fluent-text-soft);
      font-size: 13px;
      line-height: 1.45;
    }
  }

  .timeline-more {
    strong,
    p {
      color: var(--fluent-text-soft);
    }
  }

  .breeding-detail-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 14px;
  }

  .record-detail-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }

  .breeding-detail-card {
    min-width: 0;
    padding: 14px;
    background: #fff;
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius-sm);
    box-shadow: none;

    &.is-main {
      display: flex;
      grid-column: span 2;
      gap: 12px;
      align-items: flex-start;
      justify-content: space-between;
    }

    span {
      display: block;
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
      margin: 6px 0 0;
      color: var(--fluent-text-soft);
      line-height: 1.55;
    }
  }

  .detail-event-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 12px;
  }

  .event-closure-panel {
    display: grid;
    gap: 14px;
    padding: 16px;
    margin: 16px 0;
    background: #f8fbf7;
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius-sm);
    box-shadow: none;
  }

  .event-closure-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;

    div {
      display: grid;
      gap: 5px;
    }

    span {
      color: var(--fluent-text-soft);
      font-size: 13px;
    }

    strong {
      color: var(--fluent-text);
      font-size: 18px;
    }
  }

  .event-closure-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;

    div {
      display: grid;
      gap: 5px;
      min-width: 0;
      padding: 10px;
      background: rgb(255 255 255 / 52%);
      border: 1px solid var(--fluent-border);
      border-radius: var(--fluent-radius-sm);
    }

    span {
      color: var(--fluent-text-soft);
      font-size: 13px;
    }

    strong {
      color: var(--fluent-text);
      font-size: 14px;
      line-height: 1.45;
      word-break: break-word;
    }
  }

  .detail-timeline {
    max-height: 420px;
    padding-right: 6px;
    overflow: auto;
  }

  .timeline-dot {
    width: 10px;
    height: 10px;
    margin-top: 5px;
    background: #4caf50;
    border-radius: 50%;

    &.is-yellow {
      background: #f5a623;
    }

    &.is-red {
      background: #d13438;
    }

    &.is-muted {
      background: #94a3b8;
    }
  }

  @media (max-width: 1080px) {
    .reproduction-layout,
    .form-inline {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 720px) {
    .cow-card-head,
    .event-summary {
      align-items: flex-start;
      flex-direction: column;
    }

    .cow-card-scroll {
      max-height: none;
      overflow: visible;
    }

    .cow-status {
      text-align: left;
    }

    .cow-metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .event-closure-grid {
      grid-template-columns: 1fr;
    }

    .record-detail-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
