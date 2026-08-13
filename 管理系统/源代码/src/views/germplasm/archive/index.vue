<template>
  <FcPageShell
    :title="ui('个体档案', 'Cattle profiles')"
    :status-label="ui('档案状态', 'Profile status')"
    :status-value="archiveStatus"
    :primary-action-label="ui('查看重点个体', 'View priority cattle')"
    primary-action-icon="ri:search-eye-line"
    :secondary-action-label="ui('刷新档案', 'Refresh profiles')"
    secondary-action-icon="ri:refresh-line"
    @primary-action="focusTopCow"
    @secondary-action="loadData"
  >
    <template #metrics>
      <section class="fc-metric-grid">
        <FcMetricTile
          :label="ui('档案总数', 'Total profiles')"
          :value="rows.length"
          :note="ui('在册牛只个体档案', 'Registered cattle profiles')"
          icon="ri:file-list-3-line"
        />
        <FcMetricTile
          :label="ui('系谱完整度', 'Pedigree completeness')"
          :value="`${pedigreeCoverage}%`"
          :note="ui('父母与祖代字段覆盖率', 'Coverage of parent and grandparent fields')"
          icon="ri:git-branch-line"
          tone="teal"
        />
        <FcMetricTile
          :label="ui('泌乳覆盖', 'Lactation coverage')"
          :value="`${milkCoverage}%`"
          :note="ui('已有泌乳记录的个体比例', 'Cattle with lactation records')"
          icon="ri:drop-line"
          tone="warning"
        />
        <FcMetricTile
          :label="ui('实时覆盖', 'Live data coverage')"
          :value="`${sensorCoverage}%`"
          :note="ui('有最新传感器数据的个体比例', 'Cattle with recent sensor data')"
          icon="ri:pulse-line"
          tone="info"
        />
      </section>
    </template>

    <section class="archive-layout">
      <FcPanel :title="ui('档案检索', 'Profile search')">
        <div class="filter-grid">
          <CowNumberAutocomplete
            v-model="filters.keyword"
            :placeholder="ui('搜索牛号、耳标、圈舍、品种', 'Search cattle ID, ear tag, pen, or breed')"
            @select="handleCowSearchSelect"
          />
          <ElSelect v-model="filters.status" clearable :placeholder="ui('状态', 'Status')">
            <ElOption :label="ui('健康', 'Healthy')" value="健康" />
            <ElOption :label="ui('发情', 'Estrus')" value="发情" />
            <ElOption :label="ui('预产', 'Expected calving')" value="预产" />
            <ElOption :label="ui('异常', 'Abnormal')" value="异常" />
          </ElSelect>
          <ElSelect v-model="filters.gender" clearable :placeholder="ui('性别', 'Sex')">
            <ElOption :label="ui('母', 'Female')" value="母" />
            <ElOption :label="ui('公', 'Male')" value="公" />
          </ElSelect>
          <ElButton type="primary" @click="applyFilters">{{ ui('应用筛选', 'Apply filters') }}</ElButton>
        </div>

        <div class="focus-cards">
          <article
            v-for="item in topArchiveCards"
            :key="item.id"
            class="focus-card"
            role="button"
            tabindex="0"
            @click="openFocusArchiveCard(item.id)"
            @keydown.enter.prevent="openFocusArchiveCard(item.id)"
            @keydown.space.prevent="openFocusArchiveCard(item.id)"
          >
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </article>
        </div>
      </FcPanel>

      <FcPanel :title="ui('待补档案', 'Profiles requiring completion')">
        <div class="queue-list">
          <article
            v-for="item in qualityQueue"
            :key="item.id"
            class="queue-item"
            :class="item.tone"
            role="button"
            tabindex="0"
            @click="openQueueCowDetail(item.cowId)"
            @keydown.enter.prevent="openQueueCowDetail(item.cowId)"
            @keydown.space.prevent="openQueueCowDetail(item.cowId)"
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

    <FcPanel :title="ui('个体档案列表', 'Cattle profile list')">
      <template #actions>
        <ElPopover placement="bottom-end" trigger="click" width="280">
          <template #reference>
            <ElButton>
              <ArtSvgIcon icon="ri:layout-column-line" class="mr-1" />
              {{ ui('列配置', 'Columns') }}
            </ElButton>
          </template>
          <div class="archive-column-config">
            <div class="column-config-hint">{{ ui('勾选显示列，用上移/下移调整表格顺序。', 'Select visible columns and use the arrows to change their order.') }}</div>
            <div
              v-for="(column, index) in archiveColumns"
              :key="column.key"
              class="column-config-item"
            >
              <ElCheckbox
                :model-value="column.visible"
                :disabled="column.required"
                @update:model-value="(value) => setArchiveColumnVisible(column.key, value)"
              >
                {{ column.label }}
              </ElCheckbox>
              <div class="column-config-actions">
                <ElButton
                  size="small"
                  :disabled="index === 0"
                  @click="moveArchiveColumn(index, -1)"
                >
                  <ArtSvgIcon icon="ri:arrow-up-s-line" />
                </ElButton>
                <ElButton
                  size="small"
                  :disabled="index === archiveColumns.length - 1"
                  @click="moveArchiveColumn(index, 1)"
                >
                  <ArtSvgIcon icon="ri:arrow-down-s-line" />
                </ElButton>
              </div>
            </div>
            <ElButton size="small" class="column-config-reset" @click="resetArchiveColumns"
              >{{ ui('恢复默认', 'Restore defaults') }}</ElButton
            >
          </div>
        </ElPopover>
      </template>

      <ElTable
        :data="visibleFilteredRows"
        height="460"
        class="archive-table"
        border
        show-overflow-tooltip
        @wheel.passive="onArchiveTableWheel"
        @sort-change="sortArchiveRows"
        @row-click="openArchiveCowDetail"
      >
        <ElTableColumn
          v-for="column in visibleArchiveColumns"
          :key="column.key"
          :prop="column.prop"
          :label="column.label"
          :width="column.width"
          :min-width="column.minWidth"
          :sortable="column.sortable ? 'custom' : false"
          resizable
        >
          <template #default="{ row }">
            {{ formatArchiveCell(row, column.key) }}
          </template>
        </ElTableColumn>
      </ElTable>
      <div v-if="filteredRows.length > visibleFilteredRows.length" class="load-more-row">
        <ElButton @click="() => loadMoreArchiveRows()"
          >{{ ui('加载更多', 'Load more') }} {{ visibleFilteredRows.length }}/{{ filteredRows.length }}</ElButton
        >
      </div>
    </FcPanel>

    <ElDialog
      v-model="archiveDetailVisible"
      :title="ui('单牛档案详情', 'Individual cattle profile')"
      width="860px"
    >
      <div v-if="selectedArchiveCow" class="archive-detail">
        <section class="archive-detail-main">
          <div>
            <span>{{ ui('个体编号', 'Cattle ID') }}</span>
            <h3>{{ selectedArchiveCow.cowNumber }}</h3>
            <p
              >{{ displayBreed(selectedArchiveCow.breed) }} ·
              {{ displayGender(selectedArchiveCow.gender) }} ·
              {{ displayPen(getCowPen(selectedArchiveCow)) }}</p
            >
          </div>
          <ElTag>{{ displayStatus(selectedArchiveCow.status) }}</ElTag>
        </section>

        <section class="archive-detail-grid">
          <article v-for="row in archiveDetailRows" :key="row.label" class="detail-row">
            <span>{{ row.label }}</span>
            <strong>{{ row.value }}</strong>
          </article>
        </section>

        <section v-if="archiveDetailItems.length" class="archive-record-list">
          <article v-for="item in archiveDetailItems" :key="item.label" class="detail-row">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </article>
        </section>

      </div>
    </ElDialog>
  </FcPageShell>
</template>

<script setup lang="ts">
  import { computed, nextTick, reactive, ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { ElMessage } from 'element-plus'
  import FcPageShell from '@/components/business/fluent-console/FcPageShell.vue'
  import FcMetricTile from '@/components/business/fluent-console/FcMetricTile.vue'
  import FcPanel from '@/components/business/fluent-console/FcPanel.vue'
  import CowNumberAutocomplete from '@/components/business/cow/CowNumberAutocomplete.vue'
  import { useLazyRenderWindow } from '@/hooks'
  import { useUserStore } from '@/store/modules/user'
  import * as databaseService from '@/services/数据库'
  import { formatDateOnly } from '@/utils/date-display'
  import { normalizeCattleBreedOrDefault } from '@/utils/cattle-breeds'
  import {
    buildUnifiedDataContext,
    loadUnifiedMilkRecords,
    loadUnifiedReproductionEvents
  } from '@/services/unified-records'
  import {
    formatRelativeMinutes,
    getLatestSensorMap,
    getMilkStatsMap,
    getPedigreeCompleteness,
    loadUnifiedSensorData,
    normalizeStatus,
    toFiniteNumber,
    type PlatformSnapshot
  } from '@/views/breeding-platform/platform-data'

  defineOptions({ name: 'GermplasmArchive' })

  const { locale } = useI18n()
  const ui = (zh: string, en: string) => (locale.value.startsWith('zh') ? zh : en)
  const displayBreed = (value: unknown) => {
    const breed = normalizeCattleBreedOrDefault(String(value || ''))
    if (locale.value.startsWith('zh')) return breed
    if (/西门塔尔|simmental/i.test(breed)) return 'Simmental'
    if (/华西|huaxi/i.test(breed)) return 'Huaxi'
    return breed || '-'
  }
  const displayGender = (value: unknown) => {
    const gender = String(value || '').trim()
    if (locale.value.startsWith('zh')) return gender || '-'
    if (/^(母|female|cow|dam)$/i.test(gender)) return 'Female'
    if (/^(公|male|bull|sire)$/i.test(gender)) return 'Male'
    return gender || '-'
  }
  const displayStatus = (value: unknown) => {
    const status = normalizeStatus(value)
    if (locale.value.startsWith('zh')) return status
    const labels: Record<string, string> = {
      健康: 'Healthy',
      在群: 'In herd',
      异常: 'Abnormal',
      发情: 'Estrus',
      预产: 'Expected calving',
      混群: 'Mixed group',
      离群: 'Exited'
    }
    return labels[status] || status || '-'
  }
  const displayPen = (value: unknown) => {
    const pen = String(value || '').trim()
    if (locale.value.startsWith('zh')) return pen || '未分栏'
    if (!pen || pen === '未分栏') return 'Unassigned'
    if (pen === '新三圈' || /^nzh_demo_pen_new_3$/i.test(pen)) return 'Pen 3'
    return pen
  }
  const recordCount = (count: number) =>
    locale.value.startsWith('zh') ? `${count} 条` : `${count} ${count === 1 ? 'record' : 'records'}`
  const displayAlertTitle = (value: unknown) => {
    const title = String(value || '').trim()
    if (locale.value.startsWith('zh')) return title || '-'
    const labels: Record<string, string> = {
      三点体温异常预警: 'Three-point temperature alert',
      高温体温异常预警: 'High-temperature alert',
      高温热应激危急预警: 'Critical heat-stress alert'
    }
    return labels[title] || title || '-'
  }

  type TagType = 'primary' | 'success' | 'info' | 'warning' | 'danger'
  type CowArchiveRow = PlatformSnapshot['cows'][number]
  type DetailLine = { label: string; value: string }
  type ArchiveCoverageSummary = {
    total: number
    milkCovered: number
    sensorCovered: number
    milkCoverage: number
    sensorCoverage: number
  }
  type ArchiveColumnKey =
    | 'cowNumber'
    | 'breed'
    | 'gender'
    | 'type'
    | 'pedigree'
    | 'score'
    | 'milk'
    | 'temperature'
    | 'lastSeen'
  type ArchiveColumn = {
    key: ArchiveColumnKey
    prop?: string
    label: string
    width?: number
    minWidth?: number
    sortable?: boolean
    visible: boolean
    required?: boolean
  }

  const snapshot = ref<PlatformSnapshot>({
    cows: [],
    sensors: [],
    milkRecords: [],
    breedingRecords: [],
    alerts: [],
    healthScores: []
  })
  const rows = ref<PlatformSnapshot['cows']>([])
  const filteredRows = ref<PlatformSnapshot['cows']>([])
  const archiveDetailVisible = ref(false)
  const selectedArchiveCow = ref<CowArchiveRow | null>(null)
  const snapshotLoadedAt = ref('')
  const archiveCoverageSummary = ref<ArchiveCoverageSummary | null>(null)
  const userStore = useUserStore()
  const archiveLoadToken = ref(0)
  const filters = reactive({
    keyword: '',
    status: '',
    gender: ''
  })
  const defaultArchiveColumns: ArchiveColumn[] = [
    {
      key: 'cowNumber',
      prop: 'cowNumber',
      label: ui('牛号', 'Cattle ID'),
      width: 120,
      sortable: true,
      visible: true,
      required: true
    },
    { key: 'breed', prop: 'breed', label: ui('品种', 'Breed'), width: 120, sortable: true, visible: true },
    { key: 'gender', prop: 'gender', label: ui('性别', 'Sex'), width: 80, sortable: true, visible: true },
    { key: 'type', prop: 'type', label: ui('类型', 'Type'), width: 120, sortable: true, visible: true },
    { key: 'pedigree', label: ui('系谱', 'Pedigree'), minWidth: 180, visible: true },
    { key: 'score', prop: 'score', label: ui('档案评分', 'Profile score'), width: 110, sortable: true, visible: true },
    { key: 'milk', prop: 'milk', label: ui('平均泌乳', 'Average milk'), width: 120, sortable: true, visible: true },
    {
      key: 'temperature',
      prop: 'temperature',
      label: ui('最近体温', 'Latest temperature'),
      width: 120,
      sortable: true,
      visible: true
    },
    {
      key: 'lastSeen',
      prop: 'lastSeen',
      label: ui('最近数据', 'Latest data'),
      minWidth: 160,
      sortable: true,
      visible: true
    }
  ]
  const archiveColumns = ref<ArchiveColumn[]>(
    defaultArchiveColumns.map((column) => ({ ...column }))
  )

  const latestSensorMap = computed(() => getLatestSensorMap(snapshot.value.sensors))
  const milkStatsMap = computed(() => getMilkStatsMap(snapshot.value.milkRecords))
  const milkRowsByCowKey = computed(() => buildRowsByCowKey(snapshot.value.milkRecords))
  const breedingRowsByCowKey = computed(() => buildRowsByCowKey(snapshot.value.breedingRecords))
  const alertRowsByCowKey = computed(() => buildRowsByCowKey(snapshot.value.alerts))
  const sensorRowsByCowKey = computed(() => buildRowsByCowKey(snapshot.value.sensors))
  const cowByIdMap = computed(() => new Map(rows.value.map((cow) => [cow.id, cow])))
  const averageMilkByCowId = computed(() => {
    const map = new Map<string, number>()
    rows.value.forEach((cow) => {
      const values = getCowMilkRows(cow)
        .map((record: any) =>
          toFiniteNumber(
            record.volume ??
              record.milkYield ??
              record.milk_yield ??
              record.milkVolume ??
              record.milk_volume
          )
        )
        .filter((value): value is number => value !== null)
      if (values.length) {
        map.set(cow.id, values.reduce((sum, value) => sum + value, 0) / values.length)
      } else {
        map.set(cow.id, milkStatsMap.value[cow.id]?.average || 0)
      }
    })
    return map
  })
  const latestSensorByCowId = computed(() => {
    const map = new Map<string, Record<string, any> | null>()
    rows.value.forEach((cow) => {
      const latest =
        getCowSensorRows(cow)
          .slice()
          .sort(
            (left: any, right: any) => getSensorTimestamp(right) - getSensorTimestamp(left)
          )[0] ||
        latestSensorMap.value[cow.id] ||
        null
      map.set(cow.id, latest as Record<string, any> | null)
    })
    return map
  })
  const visibleArchiveColumns = computed(() =>
    archiveColumns.value.filter((column) => column.visible)
  )
  const {
    visibleItems: visibleFilteredRows,
    loadMore: loadMoreArchiveRows,
    handleWheel: onArchiveTableWheel
  } = useLazyRenderWindow(filteredRows, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })
  const pedigreeCoverage = computed(() => {
    if (!rows.value.length) return 0
    const filled = rows.value.reduce((sum, cow) => {
      const fields = [
        cow.fatherNumber,
        cow.motherNumber,
        cow.grandfatherNumber,
        cow.grandmotherNumber
      ]
      return sum + fields.filter((item) => String(item || '').trim()).length
    }, 0)
    return Math.round((filled / (rows.value.length * 4)) * 100)
  })
  const milkCoverage = computed(() => {
    if (!rows.value.length) return 0
    const covered = rows.value.filter((cow) => getCowMilkRows(cow).length > 0).length
    if (!covered && archiveCoverageSummary.value) return archiveCoverageSummary.value.milkCoverage
    return Math.round((covered / rows.value.length) * 100)
  })
  const sensorCoverage = computed(() => {
    if (!rows.value.length) return 0
    const covered = rows.value.filter((cow) => getCowSensorRows(cow).length > 0).length
    if (!covered && archiveCoverageSummary.value) return archiveCoverageSummary.value.sensorCoverage
    return Math.round((covered / rows.value.length) * 100)
  })
  const archiveStatus = computed(() => {
    if (!rows.value.length) return ui('待导入', 'Awaiting import')
    if (pedigreeCoverage.value >= 80 && milkCoverage.value >= 60) return ui('科研可用', 'Research ready')
    if (pedigreeCoverage.value >= 60) return ui('可继续补全', 'Completion in progress')
    return ui('档案待清洗', 'Profiles require review')
  })

  const getOperator = () => {
    const info = userStore.info || {}
    return String(info.userName || info.userId || ui('当前登录账号', 'Current user'))
  }

  const topArchiveCards = computed(() => [
    {
      id: 'maternal',
      label: ui('重点母系', 'Priority maternal line'),
      value: rows.value.find((cow) => cow.motherNumber)?.motherNumber || ui('待补全', 'Incomplete'),
      note: ui('高频母系编号。', 'Frequently represented maternal line.')
    },
    {
      id: 'bull-line',
      label: ui('父系覆盖', 'Sire coverage'),
      value: `${rows.value.filter((cow) => cow.fatherNumber).length} ${ui('头', 'cattle')}`,
      note: ui('已记录父号的个体可直接进入选配与系谱分析。', 'Cattle with recorded sire IDs can enter mating and pedigree analysis.')
    },
    {
      id: 'high-lactation',
      label: ui('高泌乳档案', 'High-lactation profiles'),
      value: `${rows.value.filter((cow) => (milkStatsMap.value[cow.id]?.average || 0) >= 8).length} ${ui('头', 'cattle')}`,
      note: ui('按平均泌乳 >= 8L 的个体做一轮重点复核。', 'Review cattle averaging at least 8 L of milk.')
    }
  ])

  const qualityQueue = computed<
    Array<{
      id: string
      cowId: string
      kind: string
      title: string
      description: string
      level: string
      tagType: TagType
      tone: 'danger' | 'warning' | 'primary'
    }>
  >(() => {
    const missingPedigree = rows.value
      .filter((cow) => getPedigreeCompleteness(cow) < 50)
      .slice(0, 2)
      .map((cow) => ({
        id: `pedigree-${cow.id}`,
        cowId: cow.id,
        kind: ui('系谱补录', 'Pedigree completion'),
        title: `${ui('牛号', 'Cattle ID')} ${cow.cowNumber}`,
        description: ui('父母或祖代字段缺失较多，建议先补齐后再纳入种质与组选分析。', 'Complete missing parent or grandparent fields before germplasm analysis.'),
        level: ui('待补全', 'Incomplete'),
        tagType: 'warning' as TagType,
        tone: 'warning' as const
      }))

    const missingSensors = rows.value
      .filter((cow) => !getLatestCowSensor(cow))
      .slice(0, 2)
      .map((cow) => ({
        id: `sensor-${cow.id}`,
        cowId: cow.id,
        kind: ui('实时缺口', 'Live data gap'),
        title: `${ui('牛号', 'Cattle ID')} ${cow.cowNumber}`,
        description: ui('暂无最近传感器记录，难以形成表型与健康的动态评价。', 'No recent sensor record is available for dynamic phenotype and health assessment.'),
        level: ui('待接入', 'Pending'),
        tagType: 'danger' as TagType,
        tone: 'danger' as const
      }))

    const highValue = rows.value
      .filter(
        (cow) =>
          (milkStatsMap.value[cow.id]?.average || 0) >= 10 && getPedigreeCompleteness(cow) >= 75
      )
      .slice(0, 2)
      .map((cow) => ({
        id: `high-${cow.id}`,
        cowId: cow.id,
        kind: '优先样本',
        title: `牛号 ${cow.cowNumber}`,
        description: '泌乳与系谱同时较完整，适合优先纳入组学检测和候选种质池。',
        level: '优先',
        tagType: 'success' as TagType,
        tone: 'primary' as const
      }))

    return [...highValue, ...missingPedigree, ...missingSensors].slice(0, 6)
  })

  const archiveDetailRows = computed<DetailLine[]>(() => {
    const cow = selectedArchiveCow.value
    if (!cow) return []
    const milkRows = getCowMilkRows(cow)
    const breedingRows = getCowBreedingRows(cow)
    const alertRows = getCowAlertRows(cow)
    const latestSensor = getLatestCowSensor(cow) as any
    return [
      {
        label: ui('牛号', 'Cattle ID'),
        value: String(cow.cowNumber || (cow as any).cow_number || '-')
      },
      {
        label: ui('耳标', 'Ear tag'),
        value: String(cow.earTagNumber || (cow as any).ear_tag_number || '-')
      },
      {
        label: ui('父号/母号', 'Sire / dam'),
        value: `${cow.fatherNumber || '-'} / ${cow.motherNumber || '-'}`
      },
      {
        label: ui('外祖父/外祖母', 'Maternal grandsire / granddam'),
        value: `${cow.grandfatherNumber || '-'} / ${cow.grandmotherNumber || '-'}`
      },
      {
        label: ui('系谱完整度', 'Pedigree completeness'),
        value: `${getPedigreeCompleteness(cow)}%`
      },
      { label: ui('平均泌乳', 'Average milk yield'), value: `${getAverageMilk(cow.id)} kg` },
      { label: ui('泌乳记录', 'Lactation records'), value: recordCount(milkRows.length) },
      { label: ui('最近体温', 'Latest temperature'), value: getLatestTemperature(cow.id) },
      {
        label: ui('最近传感器', 'Latest sensor record'),
        value: latestSensor?.timestamp ? formatDateTime(latestSensor.timestamp) : ui('暂无', 'None')
      },
      { label: ui('繁育记录', 'Reproduction records'), value: recordCount(breedingRows.length) },
      { label: ui('预警记录', 'Alert records'), value: recordCount(alertRows.length) },
      { label: ui('经办账号', 'Operator'), value: getOperator() },
      { label: ui('刷新时间', 'Updated'), value: snapshotLoadedAt.value || '-' }
    ]
  })

  const archiveDetailItems = computed<DetailLine[]>(() => {
    const cow = selectedArchiveCow.value
    if (!cow) return []
    const milkRows = getCowMilkRows(cow)
      .slice(0, 4)
      .map((record: any, index: number) => ({
        label: `${ui('泌乳记录', 'Lactation record')} ${index + 1}`,
        value: `${formatDateTime(record.milkingTime || record.milking_time || record.createdAt)} · ${toFiniteNumber(record.volume ?? record.milkVolume ?? record.milk_volume) ?? '-'} kg`
      }))
    const breedingRows = getCowBreedingRows(cow)
      .slice(0, 4)
      .map((record: any, index: number) => ({
        label: `${ui('繁育记录', 'Reproduction record')} ${index + 1}`,
        value: `${formatDateTime(record.eventTime || record.event_time || record.createdAt)} · ${record.eventType || record.event_type || record.type || '-'}`
      }))
    const alertRows = getCowAlertRows(cow)
      .slice(0, 3)
      .map((record: any, index: number) => ({
        label: `${ui('预警记录', 'Alert record')} ${index + 1}`,
        value: `${formatDateTime(record.alertTime || record.alert_time || record.createdAt)} · ${displayAlertTitle(record.title || record.alertType)}`
      }))
    return [...milkRows, ...breedingRows, ...alertRows]
  })

  const applyFilters = () => {
    const keyword = filters.keyword.trim().toLowerCase()
    filteredRows.value = rows.value.filter((cow) => {
      if (keyword) {
        const haystack = [
          cow.cowNumber,
          cow.earTagNumber,
          cow.currentPen,
          cow.breed,
          cow.fatherNumber,
          cow.motherNumber
        ]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(keyword)) return false
      }
      if (filters.status && normalizeStatus(cow.status) !== filters.status) return false
      if (filters.gender && String(cow.gender) !== filters.gender) return false
      return true
    })
  }

  const getAverageMilkValue = (cowId: string) => {
    return averageMilkByCowId.value.get(cowId) || milkStatsMap.value[cowId]?.average || 0
  }

  function handleCowSearchSelect(item: { cowNumber: string; cowId?: string }) {
    filters.keyword = item.cowNumber
    applyFilters()
    const target = rows.value.find(
      (cow) => cow.id === item.cowId || String(cow.cowNumber) === item.cowNumber
    )
    if (target) selectedArchiveCow.value = target
  }
  const getAverageMilk = (cowId: string) => getAverageMilkValue(cowId).toFixed(1)
  const getLatestTemperature = (cowId: string) => {
    const latestSensor = latestSensorByCowId.value.get(cowId) || latestSensorMap.value[cowId]
    const value = toFiniteNumber((latestSensor as any)?.temperature)
    return value === null ? ui('暂无', 'None') : `${value.toFixed(1)}°C`
  }
  const getLastSeen = (cowId: string) => {
    const latestSensor = latestSensorByCowId.value.get(cowId) || latestSensorMap.value[cowId]
    const value = formatRelativeMinutes((latestSensor as any)?.timestamp)
    if (locale.value.startsWith('zh')) return value
    if (value === '暂无') return 'None'
    if (value === '刚刚') return 'Just now'
    return value
      .replace(/(\d+(?:\.\d+)?)\s*分钟前/, '$1 min ago')
      .replace(/(\d+(?:\.\d+)?)\s*小时前/, '$1 h ago')
      .replace(/(\d+(?:\.\d+)?)\s*天前/, '$1 d ago')
  }
  const getLatestTemperatureValue = (cowId: string) => {
    const latestSensor = latestSensorByCowId.value.get(cowId) || latestSensorMap.value[cowId]
    return toFiniteNumber((latestSensor as any)?.temperature)
  }
  const getLastSeenTimestamp = (cowId: string) => {
    const latestSensor = latestSensorByCowId.value.get(cowId) || latestSensorMap.value[cowId]
    const timestamp = getSensorTimestamp(latestSensor)
    return Number.isFinite(timestamp) ? timestamp : 0
  }

  const getCowPen = (cow: CowArchiveRow) =>
    String(
      cow.currentPen || (cow as any).pen || (cow as any).penName || (cow as any).barn || '未分栏'
    )

  const formatDateTime = (value: unknown) => {
    return formatDateOnly(value)
  }

  const cowKeys = (cow: CowArchiveRow) =>
    [
      cow.id,
      cow.cowNumber,
      (cow as any).cow_number,
      (cow as any).number,
      cow.earTagNumber,
      (cow as any).ear_tag_number
    ]
      .map((item) => String(item || ''))
      .filter(Boolean)
  const _rowMatchesCow = (row: Record<string, any>, keys: string[]) =>
    [
      row.cowId,
      row.cow_id,
      row.cowNumber,
      row.cow_number,
      row.animalId,
      row.animal_id,
      row.animalNumber,
      row.animal_number,
      row.number
    ].some((key) => keys.includes(String(key || '')))
  const addCowKeyedRow = (
    map: Map<string, Record<string, any>[]>,
    key: unknown,
    row: Record<string, any>
  ) => {
    const normalized = String(key || '').trim()
    if (!normalized) return
    const rows = map.get(normalized) || []
    rows.push(row)
    map.set(normalized, rows)
  }
  const buildRowsByCowKey = (records: Record<string, any>[]) => {
    const map = new Map<string, Record<string, any>[]>()
    records.forEach((record) => {
      ;[
        record.cowId,
        record.cow_id,
        record.cowNumber,
        record.cow_number,
        record.animalId,
        record.animal_id,
        record.animalNumber,
        record.animal_number,
        record.number
      ].forEach((key) => addCowKeyedRow(map, key, record))
    })
    return map
  }
  const indexedRowsForCow = (cow: CowArchiveRow, index: Map<string, Record<string, any>[]>) => {
    const seen = new Set<string>()
    return cowKeys(cow).flatMap((key) => {
      return (index.get(key) || []).filter((row: Record<string, any>, rowIndex: number) => {
        const rowKey = String(
          row.id || row.sourceRecordId || row.source_record_id || `${key}:${rowIndex}`
        )
        if (seen.has(rowKey)) return false
        seen.add(rowKey)
        return true
      })
    })
  }
  const getSensorTimestamp = (row: any) => {
    const timestamp = new Date(
      String(
        row?.timestamp ?? row?.ts ?? row?.measuredAt ?? row?.measured_at ?? row?.createdAt ?? ''
      )
    ).getTime()
    return Number.isFinite(timestamp) ? timestamp : 0
  }

  const getCowMilkRows = (cow: CowArchiveRow) => {
    return indexedRowsForCow(cow, milkRowsByCowKey.value)
  }

  const getCowBreedingRows = (cow: CowArchiveRow) => {
    return indexedRowsForCow(cow, breedingRowsByCowKey.value)
  }

  const getCowAlertRows = (cow: CowArchiveRow) => {
    return indexedRowsForCow(cow, alertRowsByCowKey.value)
  }

  const getCowSensorRows = (cow: CowArchiveRow) => {
    return indexedRowsForCow(cow, sensorRowsByCowKey.value)
  }
  const getLatestCowSensor = (cow: CowArchiveRow) => {
    return (
      getCowSensorRows(cow)
        .slice()
        .sort((left: any, right: any) => getSensorTimestamp(right) - getSensorTimestamp(left))[0] ||
      null
    )
  }

  const formatArchiveCell = (row: CowArchiveRow, key: ArchiveColumnKey) => {
    const valueMap: Record<ArchiveColumnKey, string> = {
      cowNumber: String(row.cowNumber || '-'),
      breed: displayBreed(row.breed),
      gender: displayGender(row.gender),
      type: locale.value.startsWith('zh') ? String(row.type || '-') : String(row.type || '-').replace('成母牛', 'Adult cow').replace('种公牛', 'Breeding bull'),
      pedigree: `${ui('父', 'Sire')} ${row.fatherNumber || '-'} / ${ui('母', 'Dam')} ${row.motherNumber || '-'}`,
      score: `${getPedigreeCompleteness(row)}%`,
      milk: `${getAverageMilk(row.id)} kg`,
      temperature: getLatestTemperature(row.id),
      lastSeen: getLastSeen(row.id)
    }
    return valueMap[key]
  }

  const setArchiveColumnVisible = (key: ArchiveColumnKey, value: boolean | string | number) => {
    const column = archiveColumns.value.find((item) => item.key === key)
    if (!column || column.required) return
    column.visible = Boolean(value)
  }

  const moveArchiveColumn = (index: number, offset: -1 | 1) => {
    const targetIndex = index + offset
    if (targetIndex < 0 || targetIndex >= archiveColumns.value.length) return
    const next = [...archiveColumns.value]
    const [column] = next.splice(index, 1)
    next.splice(targetIndex, 0, column)
    archiveColumns.value = next
  }

  const resetArchiveColumns = () => {
    archiveColumns.value = defaultArchiveColumns.map((column) => ({ ...column }))
  }

  const sortArchiveRows = ({
    prop,
    order
  }: {
    prop?: string
    order?: 'ascending' | 'descending' | null
  }) => {
    if (!order) {
      applyFilters()
      return
    }
    const column = archiveColumns.value.find((item) => item.prop === prop || item.key === prop)
    if (!column) return
    const direction = order === 'ascending' ? 1 : -1
    const sortValue = (row: CowArchiveRow) => {
      const values: Record<ArchiveColumnKey, string | number | null> = {
        cowNumber: row.cowNumber || '',
        breed: row.breed || '',
        gender: String(row.gender || ''),
        type: row.type || '',
        pedigree: `${row.fatherNumber || ''} ${row.motherNumber || ''}`,
        score: getPedigreeCompleteness(row),
        milk: getAverageMilkValue(row.id),
        temperature: getLatestTemperatureValue(row.id),
        lastSeen: getLastSeenTimestamp(row.id)
      }
      return values[column.key]
    }
    filteredRows.value = [...filteredRows.value].sort((left, right) => {
      const leftValue = sortValue(left)
      const rightValue = sortValue(right)
      if (typeof leftValue === 'number' || typeof rightValue === 'number') {
        return ((Number(leftValue) || 0) - (Number(rightValue) || 0)) * direction
      }
      return String(leftValue || '').localeCompare(String(rightValue || ''), 'zh-CN') * direction
    })
  }

  const openArchiveCowDetail = (cow: CowArchiveRow) => {
    selectedArchiveCow.value = cow
    archiveDetailVisible.value = true
  }

  const openFocusArchiveCard = (cardId: string) => {
    const candidates =
      {
        maternal: rows.value.filter((cow) => cow.motherNumber),
        'bull-line': rows.value.filter((cow) => cow.fatherNumber),
        'high-lactation': rows.value.filter(
          (cow) => (milkStatsMap.value[cow.id]?.average || 0) >= 8
        )
      }[cardId] || filteredRows.value
    const target = candidates[0] || filteredRows.value[0] || rows.value[0]
    if (target) openArchiveCowDetail(target)
  }

  const openQueueCowDetail = (cowId: string) => {
    const target = cowByIdMap.value.get(cowId)
    if (target) openArchiveCowDetail(target)
  }

  const focusTopCow = () => {
    const top = filteredRows.value[0] || rows.value[0]
    if (!top) {
      ElMessage.info('当前还没有可用个体档案')
      return
    }
    ElMessage.success(`已定位重点个体：${top.cowNumber}`)
  }

  const readArchiveRows = async (tableName: string) => {
    try {
      const data = await databaseService.getTableDataAsync(tableName, { silent: true })
      return Array.isArray(data) ? data : []
    } catch {
      return []
    }
  }

  const applyArchiveRows = (cows: PlatformSnapshot['cows']) => {
    const byCowNumber = new Map<string, CowArchiveRow>()
    cows.forEach((cow) => {
      const normalized = {
        ...cow,
        breed: normalizeCattleBreedOrDefault(cow.breed)
      }
      const key = String(normalized.cowNumber || normalized.id || '').trim()
      if (key) byCowNumber.set(key, normalized)
    })
    rows.value = Array.from(byCowNumber.values())
    filteredRows.value = [...rows.value]
    applyFilters()
  }

  const loadCoreArchiveRows = async (token: number) => {
    const context = await buildUnifiedDataContext()
    if (token !== archiveLoadToken.value) return null
    snapshot.value = {
      ...snapshot.value,
      cows: context.cows as PlatformSnapshot['cows']
    }
    applyArchiveRows(snapshot.value.cows)
    snapshotLoadedAt.value = formatDateOnly(new Date())
    return context
  }

  const loadArchiveSupportRows = async (
    token: number,
    context: Awaited<ReturnType<typeof buildUnifiedDataContext>>
  ) => {
    const [milkRecords, reproduction, sensors, alerts, healthScores] = await Promise.all([
      loadUnifiedMilkRecords(context).catch((error) => {
        console.error('加载个体档案泌乳摘要失败', error)
        return [] as Record<string, any>[]
      }),
      loadUnifiedReproductionEvents(context).catch((error) => {
        console.error('加载个体档案繁殖摘要失败', error)
        return { events: [], cycles: [] }
      }),
      loadUnifiedSensorData(context.cows as PlatformSnapshot['cows']).catch((error) => {
        console.error('加载个体档案传感器摘要失败', error)
        return [] as Record<string, any>[]
      }),
      readArchiveRows('alerts'),
      readArchiveRows('health_scores').then(async (primary) =>
        primary.length ? primary : readArchiveRows('health-scores')
      )
    ])
    if (token !== archiveLoadToken.value) return
    snapshot.value = {
      ...snapshot.value,
      milkRecords: milkRecords as PlatformSnapshot['milkRecords'],
      breedingRecords: reproduction.events,
      reproductionCycles: reproduction.cycles,
      breedingEvents: reproduction.events,
      sensors: sensors as PlatformSnapshot['sensors'],
      alerts,
      healthScores
    }
    snapshotLoadedAt.value = formatDateOnly(new Date())
  }

  const loadArchiveCoverageSummary = async (token: number) => {
    const summary = await databaseService
      .runBackendRpcAsync<ArchiveCoverageSummary>(
        'getArchiveCoverageSummary',
        {},
        { timeout: 10000, showErrorLog: false }
      )
      .catch(() => null)
    if (token !== archiveLoadToken.value || !summary) return
    archiveCoverageSummary.value = summary
  }

  const loadData = async () => {
    const token = archiveLoadToken.value + 1
    archiveLoadToken.value = token
    archiveCoverageSummary.value = null
    loadArchiveCoverageSummary(token)
    const context = await loadCoreArchiveRows(token)
    if (!context) return
    await nextTick()
    loadArchiveSupportRows(token, context).catch((error) => {
      console.error('加载个体档案支撑数据失败', error)
      ElMessage.warning('个体主档已加载，泌乳、传感器或繁殖摘要稍后再刷新')
    })
  }

  loadData()
</script>

<style scoped lang="scss">
  .fc-metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 14px;
  }

  .archive-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(300px, 340px);
    gap: 14px;
  }

  .filter-grid,
  .focus-cards,
  .queue-list {
    display: grid;
    gap: 12px;
  }

  .filter-grid {
    grid-template-columns: minmax(240px, 1fr) minmax(130px, 150px) minmax(110px, 130px) auto;
    margin-bottom: 14px;
  }

  .filter-grid > * {
    min-width: 0;
  }

  .filter-grid :deep(.cow-number-autocomplete),
  .filter-grid :deep(.el-select),
  .filter-grid :deep(.el-input) {
    width: 100%;
    min-width: 0;
  }

  .focus-cards {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .archive-column-config {
    display: grid;
    gap: 10px;
  }

  .column-config-hint {
    color: var(--fluent-text-soft);
    font-size: 12px;
    line-height: 1.5;
  }

  .column-config-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
  }

  .column-config-actions {
    display: flex;
    gap: 4px;

    :deep(.el-button + .el-button) {
      margin-left: 0;
    }
  }

  .column-config-reset {
    justify-self: start;
  }

  .focus-card,
  .queue-item {
    min-width: 0;
    overflow: hidden;
    padding: 12px;
    background: var(--fluent-surface);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
    cursor: pointer;
    transition:
      background-color 160ms ease,
      border-color 180ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .focus-card:hover,
  .queue-item:hover,
  .focus-card:focus-visible,
  .queue-item:focus-visible {
    border-color: rgb(var(--fluent-primary-rgb) / 38%);
    background: rgb(248 250 252);
    outline: none;
  }

  .focus-card span,
  .queue-item span {
    display: block;
    min-width: 0;
    color: var(--fluent-muted);
    font-size: 12px;
    font-weight: 680;
    overflow-wrap: anywhere;
  }

  .focus-card strong {
    display: block;
    min-width: 0;
    margin-top: 5px;
    color: var(--fluent-text);
    font-size: clamp(16px, 1.7vw, 20px);
    font-weight: 780;
    line-height: 1.22;
    overflow: hidden;
    overflow-wrap: anywhere;
    word-break: break-word;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .focus-card {
    min-height: 84px;
  }

  .focus-card p,
  .queue-item p {
    margin: 6px 0 0;
    color: var(--fluent-text-soft);
    font-size: 12px;
    line-height: 1.5;
  }

  .queue-item {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
    border-left: 4px solid var(--fluent-primary);
  }

  .queue-item > div {
    min-width: 0;
  }

  .queue-item.warning {
    border-left-color: var(--fluent-amber);
  }

  .queue-item.danger {
    border-left-color: var(--fluent-danger);
  }

  .queue-item h3 {
    margin: 5px 0 0;
    color: var(--fluent-text);
    font-size: 15px;
    font-weight: 760;
    max-width: 100%;
    overflow: hidden;
    overflow-wrap: anywhere;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .queue-item :deep(.el-tag) {
    flex: 0 0 auto;
  }

  .archive-table {
    :deep(.el-table__body tr) {
      cursor: pointer;
      transition: background-color 180ms ease;
    }

    :deep(.el-table__body tr:hover) {
      position: relative;
      z-index: 1;
      background: rgb(248 250 252);
    }
  }

  .load-more-row {
    display: flex;
    justify-content: center;
    padding: 12px 0 0;
  }

  .archive-detail {
    display: grid;
    gap: 14px;
  }

  .archive-detail-main,
  .detail-row {
    background: var(--fluent-surface);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius-sm);
  }

  .archive-detail-main {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    justify-content: space-between;
    padding: 14px;
    border-left: 4px solid var(--fluent-primary);

    span {
      color: var(--fluent-muted);
      font-size: 12px;
      font-weight: 680;
    }

    h3 {
      margin: 6px 0 0;
      color: var(--fluent-text);
      font-size: 22px;
      font-weight: 820;
    }

    p {
      margin: 8px 0 0;
      color: var(--fluent-text-soft);
    }
  }

  .archive-detail-grid,
  .archive-record-list {
    display: grid;
    gap: 10px;
  }

  .archive-detail-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .archive-record-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .detail-row {
    display: grid;
    gap: 6px;
    min-width: 0;
    padding: 12px;

    span {
      color: var(--fluent-text-soft);
      font-size: 12px;
      font-weight: 650;
    }

    strong {
      color: var(--fluent-text);
      font-size: 14px;
      line-height: 1.45;
      word-break: break-word;
    }
  }

  @media (max-width: 1180px) {
    .fc-metric-grid,
    .archive-layout,
    .focus-cards {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 760px) {
    .fc-metric-grid,
    .archive-layout,
    .focus-cards,
    .filter-grid {
      grid-template-columns: 1fr;
    }

    .queue-item {
      display: grid;
    }

    .archive-detail-grid,
    .archive-record-list {
      grid-template-columns: 1fr;
    }
  }
</style>
