<template>
  <FcPageShell
    title="系谱管理"
    status-label="系谱状态"
    :status-value="pedigreeStatus"
    primary-action-label="聚焦缺口个体"
    primary-action-icon="ri:focus-3-line"
    secondary-action-label="刷新系谱"
    secondary-action-icon="ri:refresh-line"
    @primary-action="focusIncompleteRows"
    @secondary-action="loadData"
  >
    <template #metrics>
      <section class="fc-metric-grid">
        <FcMetricTile
          label="母系家系"
          :value="maternalLines.length"
          note="已形成家系编号的母系分组"
          icon="ri:team-line"
        />
        <FcMetricTile
          label="完整系谱"
          :value="completeRows.length"
          note="四代字段较完整，可直接分析"
          icon="ri:git-branch-line"
          tone="teal"
        />
        <FcMetricTile
          label="待补父母号"
          :value="criticalMissing.length"
          note="优先补全父母字段，再进入组选分析"
          icon="ri:error-warning-line"
          tone="warning"
        />
        <FcMetricTile
          label="近交风险"
          :value="riskRows.length"
          note="父母或祖代重复"
          icon="ri:shield-flash-line"
          tone="danger"
        />
      </section>
    </template>

    <section class="tree-layout">
      <FcPanel title="实时系谱树">
        <div v-if="pedigreeLoading && !rows.length" class="pedigree-loading-card">
          <span>正在载入系谱档案</span>
          <strong>系谱加载中</strong>
        </div>
        <div class="tree-toolbar">
          <div>
            <span>当前个体</span>
            <strong>{{ selectedCow?.cowNumber || '待选择' }}</strong>
          </div>
          <div class="tree-search">
            <CowNumberAutocomplete
              v-model="keyword"
              placeholder="搜索牛号、耳标、父号、母号"
              @select="handleTreeCowSearchSelect"
            />
          </div>
        </div>

        <div
          v-if="selectedCow"
          ref="pedigreeCanvasRef"
          class="pedigree-canvas"
          aria-label="实时系谱树"
        >
          <svg class="pedigree-link-layer" :viewBox="pedigreeLinkViewBox" aria-hidden="true">
            <path
              v-for="link in pedigreeLinks"
              :key="link.id"
              class="pedigree-link"
              :class="link.tone"
              :d="link.path"
            />
          </svg>
          <div class="generation-label">祖代</div>
          <div class="tree-generation is-ancestors">
            <article
              v-for="node in ancestorNodes"
              :key="node.id"
              :data-node-id="node.id"
              :ref="setTreeNodeElement"
              class="tree-node"
              :class="node.tone"
              role="button"
              tabindex="0"
              @click="traceToNode(node)"
              @keydown.enter.prevent="traceToNode(node)"
              @keydown.space.prevent="traceToNode(node)"
            >
              <span>{{ node.role }}</span>
              <strong>{{ node.label }}</strong>
              <p>{{ node.subtitle }}</p>
            </article>
          </div>

          <div class="tree-action-row">
            <ElButton size="small" :disabled="!selectedFather" @click="traceParent('father')"
              >上追父系</ElButton
            >
            <ElButton size="small" :disabled="!selectedMother" @click="traceParent('mother')"
              >上追母系</ElButton
            >
            <ElButton size="small" :disabled="!descendantRows.length" @click="traceFirstDescendant"
              >下追后代 {{ descendantRows.length }}</ElButton
            >
            <ElButton
              size="small"
              :disabled="!originCow || originCow.id === selectedCow.id"
              @click="resetTrace"
              >回到当前牛</ElButton
            >
          </div>

          <div class="generation-label">父母代</div>
          <div class="tree-generation is-parents">
            <article
              v-for="node in parentNodes"
              :key="node.id"
              :data-node-id="node.id"
              :ref="setTreeNodeElement"
              class="tree-node"
              :class="node.tone"
              role="button"
              tabindex="0"
              @click="traceToNode(node)"
              @keydown.enter.prevent="traceToNode(node)"
              @keydown.space.prevent="traceToNode(node)"
            >
              <span>{{ node.role }}</span>
              <strong>{{ node.label }}</strong>
              <p>{{ node.subtitle }}</p>
            </article>
          </div>

          <div v-if="descendantRows.length" class="descendant-strip" aria-label="后代列表">
            <button
              v-for="descendant in descendantRows.slice(0, 4)"
              :key="descendant.id"
              type="button"
              @click="selectCow(descendant)"
            >
              <span>后代</span>
              <strong>{{ descendant.cowNumber }}</strong>
            </button>
          </div>

          <div class="generation-label">当前个体</div>
          <div class="tree-generation is-current">
            <article
              :data-node-id="currentNode.id"
              :ref="setTreeNodeElement"
              class="tree-node is-selected"
              :class="{ 'is-origin-compressed': originCow?.id !== selectedCow.id }"
            >
              <span>{{ currentNode.role }}</span>
              <strong>{{ currentNode.label }}</strong>
              <p>{{ currentNode.subtitle }}</p>
            </article>
          </div>
          <div v-if="originCow && originCow.id !== selectedCow.id" class="trace-origin-strip">
            <button type="button" @click="resetTrace">
              <span>原始当前牛</span>
              <strong>{{ originCow.cowNumber }}</strong>
              <small>当前正在向上追溯，原牛保留在树底部</small>
            </button>
          </div>
        </div>

        <FcEmptyState
          v-else
          icon="ri:git-branch-line"
          title="暂无系谱数据"
          description="暂无牛只档案。"
        />
      </FcPanel>

      <FcPanel title="待处理事项">
        <div class="queue-list">
          <article
            v-for="item in issueQueue"
            :key="item.id"
            class="queue-item"
            :class="item.tone"
            role="button"
            tabindex="0"
            @click="openCowDetailById(item.cowId)"
            @keydown.enter.prevent="openCowDetailById(item.cowId)"
            @keydown.space.prevent="openCowDetailById(item.cowId)"
          >
            <div>
              <span>{{ item.kind }}</span>
              <h3>{{ item.title }}</h3>
              <p>{{ item.description }}</p>
            </div>
            <ElTag :type="item.tagType">{{ item.level }}</ElTag>
          </article>
          <FcEmptyState
            v-if="!issueQueue.length"
            icon="ri:checkbox-circle-line"
            title="暂无待处理事项"
            description="暂无缺口或重复风险。"
          />
        </div>
      </FcPanel>
    </section>

    <FcPanel title="牛只系谱卡片">
      <div class="card-toolbar">
        <div>
          <strong>{{ filteredRows.length }}</strong>
          <span>头个体</span>
        </div>
        <ElButton text @click="keyword = ''">清空检索</ElButton>
      </div>

      <div
        v-if="filteredRows.length"
        ref="cowCardContainerRef"
        class="cow-card-scroll"
        @scroll.passive="onCowCardScroll"
        @wheel.passive="onCowCardWheel"
      >
        <div class="cow-card-grid">
          <article
            v-for="cow in visibleCowRows"
            :key="cow.id"
            class="cow-card"
            :class="{
              'is-active': cow.id === selectedCow?.id,
              'has-risk': hasDuplicatePedigree(cow),
              'has-gap': isPedigreeIncomplete(cow)
            }"
            role="button"
            tabindex="0"
            @click="selectCow(cow)"
            @keydown.enter.prevent="selectCow(cow)"
            @keydown.space.prevent="selectCow(cow)"
          >
            <div class="cow-card-head">
              <div>
                <span>{{ cow.currentPen || '未分配圈舍' }}</span>
                <h3>牛号 {{ cow.cowNumber }}</h3>
                <p
                  >{{ formatBreed(cow.breed) }} · {{ formatGender(cow.gender) }} ·
                  {{ formatType(cow.type) }}</p
                >
              </div>
              <ElTag :type="getCowTagType(cow)">{{ normalizeStatus(cow.status) }}</ElTag>
            </div>

            <div class="pedigree-fields">
              <div>
                <span>父号</span>
                <strong>{{ cow.fatherNumber || '待补录' }}</strong>
              </div>
              <div>
                <span>母号</span>
                <strong>{{ cow.motherNumber || '待补录' }}</strong>
              </div>
              <div>
                <span>外祖父</span>
                <strong>{{ cow.grandfatherNumber || '待补录' }}</strong>
              </div>
              <div>
                <span>外祖母</span>
                <strong>{{ cow.grandmotherNumber || '待补录' }}</strong>
              </div>
            </div>

            <div class="card-progress">
              <div>
                <span>系谱完整度</span>
                <strong>{{ getPedigreeCompleteness(cow) }}%</strong>
              </div>
              <ElProgress
                :percentage="getPedigreeCompleteness(cow)"
                :stroke-width="7"
                :show-text="false"
              />
            </div>

            <div class="card-footer">
              <span>{{ getMaternalLineName(cow) }}</span>
              <strong>{{ getRiskText(cow) }}</strong>
            </div>
          </article>
        </div>
      </div>

      <FcEmptyState
        v-else
        icon="ri:search-eye-line"
        title="没有匹配个体"
        description="当前检索无结果。"
      />
    </FcPanel>
  </FcPageShell>

  <ElDialog
    v-model="detailDialogVisible"
    :title="detailDialog.title"
    width="760px"
    class="pedigree-detail-dialog"
  >
    <div class="pedigree-detail-shell">
      <div class="detail-summary">
        <span>{{ detailDialog.subtitle }}</span>
        <strong>{{ detailDialog.primary }}</strong>
      </div>

      <div class="detail-grid">
        <div v-for="row in detailDialog.rows" :key="row.label" class="detail-row">
          <span>{{ row.label }}</span>
          <strong>{{ row.value }}</strong>
        </div>
      </div>

      <div v-if="detailDialog.items.length" class="detail-table">
        <div v-for="item in detailDialog.items" :key="item.label" class="detail-item">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </div>
      </div>

      <div class="detail-note">{{ detailDialog.note }}</div>
    </div>
  </ElDialog>
</template>

<script setup lang="ts">
  import {
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    reactive,
    watch,
    type ComponentPublicInstance
  } from 'vue'
  import { ElMessage } from 'element-plus'
  import { useLazyGridRenderWindow } from '@/hooks'
  import FcPageShell from '@/components/business/fluent-console/FcPageShell.vue'
  import FcMetricTile from '@/components/business/fluent-console/FcMetricTile.vue'
  import FcPanel from '@/components/business/fluent-console/FcPanel.vue'
  import FcEmptyState from '@/components/business/fluent-console/FcEmptyState.vue'
  import CowNumberAutocomplete from '@/components/business/cow/CowNumberAutocomplete.vue'
  import { buildUnifiedDataContext } from '@/services/unified-records'
  import { formatDateOnly } from '@/utils/date-display'
  import { normalizeCattleBreedOrDefault } from '@/utils/cattle-breeds'
  import { getPedigreeCompleteness, normalizeStatus } from '@/views/breeding-platform/platform-data'
  import type { CowBasic } from '@/types/cow'

  type TagType = 'primary' | 'success' | 'info' | 'warning' | 'danger'
  type NodeTone = 'linked' | 'missing' | 'pending' | 'selected'

  interface PedigreeNode {
    id: string
    role: string
    label: string
    subtitle: string
    tone: NodeTone
    cowId?: string
    number?: string
  }

  interface PedigreeLink {
    id: string
    path: string
    tone: NodeTone
  }

  type DetailLine = { label: string; value: string }

  const rows = ref<CowBasic[]>([])
  const pedigreeLoading = ref(false)
  const selectedCowId = ref('')
  const originCowId = ref('')
  const keyword = ref('')
  const pedigreeCanvasRef = ref<HTMLElement | null>(null)
  const pedigreeLinkViewBox = ref('0 0 1000 420')
  const measuredLinks = ref<PedigreeLink[]>([])
  const treeNodeElements = new Map<string, HTMLElement>()
  let pedigreeResizeObserver: ResizeObserver | null = null
  let pedigreeLinkFrame = 0
  const detailDialogVisible = ref(false)
  const detailDialog = reactive({
    title: '牛只详情',
    subtitle: '系谱详情',
    primary: '',
    note: '',
    rows: [] as DetailLine[],
    items: [] as DetailLine[]
  })

  const completeRows = computed(() =>
    rows.value.filter((cow) => getPedigreeCompleteness(cow) >= 75)
  )
  const criticalMissing = computed(() =>
    rows.value.filter((cow) => !cow.fatherNumber || !cow.motherNumber)
  )
  const riskRows = computed(() => rows.value.filter(hasDuplicatePedigree))
  const sortedRows = computed(() => {
    return [...rows.value].sort((left, right) => {
      const completenessDelta = getPedigreeCompleteness(right) - getPedigreeCompleteness(left)
      if (completenessDelta !== 0) return completenessDelta
      const leftGap = left.fatherNumber && left.motherNumber ? 0 : 1
      const rightGap = right.fatherNumber && right.motherNumber ? 0 : 1
      if (leftGap !== rightGap) return leftGap - rightGap
      return String(left.cowNumber).localeCompare(String(right.cowNumber), 'zh-CN')
    })
  })

  const cowByNumber = computed(() => {
    return rows.value.reduce<Record<string, CowBasic>>((result, cow) => {
      result[normalizeKey(cow.cowNumber)] = cow
      if (cow.earTagNumber) result[normalizeKey(cow.earTagNumber)] = cow
      return result
    }, {})
  })

  const filteredRows = computed(() => {
    const value = keyword.value.trim().toLowerCase()
    if (!value) return sortedRows.value
    return sortedRows.value.filter((cow) =>
      [
        cow.cowNumber,
        cow.earTagNumber,
        cow.currentPen,
        cow.breed,
        cow.fatherNumber,
        cow.motherNumber,
        cow.grandfatherNumber,
        cow.grandmotherNumber
      ]
        .join(' ')
        .toLowerCase()
        .includes(value)
    )
  })
  const {
    containerRef: cowCardContainerRef,
    visibleItems: visibleCowRows,
    startIndex: cowCardStartIndex,
    endIndex: cowCardEndIndex,
    totalCount: cowCardTotalCount,
    handleScroll: onCowCardScroll,
    handleWheel: onCowCardWheel
  } = useLazyGridRenderWindow(filteredRows, {
    rowCount: 2,
    minItemWidth: 310,
    gap: 14,
    fallbackColumns: 3,
    mode: 'fixed-window'
  })

  const selectedCow = computed(() => {
    return (
      rows.value.find((cow) => cow.id === selectedCowId.value) ||
      filteredRows.value[0] ||
      rows.value[0] ||
      null
    )
  })
  const originCow = computed(() => {
    return rows.value.find((cow) => cow.id === originCowId.value) || selectedCow.value
  })

  const selectedFather = computed(() => getCowByNumber(selectedCow.value?.fatherNumber))
  const selectedMother = computed(() => getCowByNumber(selectedCow.value?.motherNumber))
  const descendantRows = computed(() => {
    const cow = selectedCow.value
    if (!cow) return []
    const number = normalizeKey(cow.cowNumber)
    return rows.value
      .filter(
        (item) =>
          normalizeKey(item.fatherNumber) === number || normalizeKey(item.motherNumber) === number
      )
      .sort((left, right) => String(left.cowNumber).localeCompare(String(right.cowNumber), 'zh-CN'))
  })

  const ancestorNodes = computed<PedigreeNode[]>(() => {
    const cow = selectedCow.value
    if (!cow) return []
    return [
      buildNode('父系祖父', selectedFather.value?.fatherNumber),
      buildNode('父系祖母', selectedFather.value?.motherNumber),
      buildNode('外祖父', cow.grandfatherNumber || selectedMother.value?.fatherNumber),
      buildNode('外祖母', cow.grandmotherNumber || selectedMother.value?.motherNumber)
    ]
  })

  const parentNodes = computed<PedigreeNode[]>(() => {
    const cow = selectedCow.value
    if (!cow) return []
    return [buildNode('父号', cow.fatherNumber), buildNode('母号', cow.motherNumber)]
  })

  const currentNode = computed<PedigreeNode>(() => {
    const cow = selectedCow.value
    if (!cow) {
      return {
        id: 'current-missing',
        role: '当前个体',
        label: '待选择',
        subtitle: '请选择牛只',
        tone: 'missing'
      }
    }
    const tracing = originCow.value && originCow.value.id !== cow.id
    return {
      id: 'current-node',
      role: tracing ? '追溯焦点' : cow.currentPen || '当前个体',
      label: cow.cowNumber,
      cowId: cow.id,
      number: cow.cowNumber,
      subtitle: `${formatBreed(cow.breed)} · ${formatGender(cow.gender)} · ${formatType(cow.type)} · ${normalizeStatus(cow.status)}`,
      tone: 'selected'
    }
  })

  const pedigreeLinks = computed<PedigreeLink[]>(() => {
    return measuredLinks.value
  })

  const maternalLines = computed(() => {
    const grouped = rows.value.reduce<Record<string, CowBasic[]>>((result, cow) => {
      const key = getMaternalLineName(cow)
      result[key] = result[key] || []
      result[key].push(cow)
      return result
    }, {})

    return Object.entries(grouped)
      .map(([name, items]) => ({
        name,
        count: items.length,
        completeness: Math.round(
          items.reduce((sum, cow) => sum + getPedigreeCompleteness(cow), 0) / items.length
        ),
        example: items[0]?.cowNumber || '-'
      }))
      .sort((left, right) => right.count - left.count)
  })

  const issueQueue = computed<
    Array<{
      id: string
      cowId: string
      kind: string
      title: string
      description: string
      level: string
      tagType: TagType
      tone: 'warning' | 'danger'
    }>
  >(() => [
    ...criticalMissing.value.slice(0, 3).map((cow) => ({
      id: `missing-${cow.id}`,
      cowId: cow.id,
      kind: '关键缺口',
      title: `牛号 ${cow.cowNumber}`,
      description: '父号或母号缺失，建议优先补录，再进入家系与育种分析。',
      level: '待补录',
      tagType: 'warning' as TagType,
      tone: 'warning' as const
    })),
    ...riskRows.value.slice(0, 2).map((cow) => ({
      id: `risk-${cow.id}`,
      cowId: cow.id,
      kind: '近交风险',
      title: `牛号 ${cow.cowNumber}`,
      description: '父母号或祖代重复。',
      level: '需复核',
      tagType: 'danger' as TagType,
      tone: 'danger' as const
    }))
  ])

  const pedigreeStatus = computed(() => {
    if (!rows.value.length) return '待导入'
    if (completeRows.value.length / rows.value.length >= 0.7) return '可直接分析'
    if (completeRows.value.length / rows.value.length >= 0.4) return '补录后可用'
    return '待清洗'
  })

  function normalizeKey(value: unknown) {
    return String(value || '')
      .trim()
      .toLowerCase()
  }

  function getCowByNumber(number: unknown) {
    const key = normalizeKey(number)
    return key ? cowByNumber.value[key] : undefined
  }

  function buildNode(role: string, number: unknown): PedigreeNode {
    const label = String(number || '').trim()
    const matchedCow = getCowByNumber(label)
    if (!label) {
      return {
        id: `${role}-missing`,
        role,
        label: '待补录',
        subtitle: '关键系谱字段缺失',
        tone: 'missing'
      }
    }
    return {
      id: `${role}-${label}`,
      role,
      label,
      number: label,
      cowId: matchedCow?.id,
      subtitle: matchedCow
        ? `${formatBreed(matchedCow.breed)} · ${formatGender(matchedCow.gender)} · ${normalizeStatus(matchedCow.status)}`
        : '编号已记录，个体档案待关联',
      tone: matchedCow ? 'linked' : 'pending'
    }
  }

  function hasDuplicatePedigree(cow: CowBasic) {
    const values = [
      cow.fatherNumber,
      cow.motherNumber,
      cow.grandfatherNumber,
      cow.grandmotherNumber
    ]
      .map((item) => String(item || '').trim())
      .filter(Boolean)
    return new Set(values).size !== values.length
  }

  function isPedigreeIncomplete(cow: CowBasic) {
    return getPedigreeCompleteness(cow) < 75
  }

  function getRiskText(cow: CowBasic) {
    if (!cow.fatherNumber || !cow.motherNumber) return '父母号缺失，先补录'
    if (hasDuplicatePedigree(cow)) return '存在近交或字段重复风险'
    if (getPedigreeCompleteness(cow) < 75) return '祖代字段待补齐'
    return '可用于家系与亲缘分析'
  }

  function getMaternalLineName(cow: CowBasic) {
    return cow.motherNumber ? `母系 ${cow.motherNumber}` : '母系待补'
  }

  function getCowTagType(cow: CowBasic): TagType {
    const status = normalizeStatus(cow.status)
    if (status === '健康' || status === '在群') return 'success'
    if (status === '异常') return 'danger'
    if (status === '发情' || status === '预产') return 'warning'
    return 'info'
  }

  function formatBreed(value: unknown) {
    return normalizeCattleBreedOrDefault(value)
  }

  function formatGender(value: unknown) {
    const text = String(value || '').trim()
    const map: Record<string, string> = {
      male: '公',
      female: '母',
      bull: '公',
      cow: '母'
    }
    return map[text.toLowerCase()] || text || '-'
  }

  function formatType(value: unknown) {
    const text = String(value || '').trim()
    return text || '档案待补'
  }

  function formatDateTime(value: unknown) {
    return formatDateOnly(value)
  }

  function getDefaultFocusCow() {
    return (
      sortedRows.value.find((cow) => getPedigreeCompleteness(cow) >= 75) ||
      sortedRows.value[0] ||
      null
    )
  }

  function selectCow(cow: CowBasic) {
    selectedCowId.value = cow.id
    originCowId.value = cow.id
  }

  function handleTreeCowSearchSelect(item: { cowNumber: string; cowId?: string }) {
    keyword.value = item.cowNumber
    const cow =
      rows.value.find((row) => row.id === item.cowId) ||
      rows.value.find((row) => normalizeKey(row.cowNumber) === normalizeKey(item.cowNumber))
    if (cow) selectCow(cow)
  }

  function traceToNode(node: PedigreeNode) {
    if (!node.cowId) {
      ElMessage.info(`${node.role} ${node.label} 尚未关联到个体档案`)
      return
    }
    const cow = rows.value.find((item) => item.id === node.cowId)
    if (cow) selectCow(cow)
  }

  function traceParent(side: 'father' | 'mother') {
    const cow = side === 'father' ? selectedFather.value : selectedMother.value
    if (cow) selectedCowId.value = cow.id
  }

  function traceFirstDescendant() {
    const cow = descendantRows.value[0]
    if (cow) selectCow(cow)
  }

  function resetTrace() {
    if (originCow.value) selectedCowId.value = originCow.value.id
  }

  function openCowDetail(cow: CowBasic) {
    selectCow(cow)
    const completeness = getPedigreeCompleteness(cow)
    detailDialog.title = `牛号 ${cow.cowNumber}`
    detailDialog.subtitle = '系谱详情'
    detailDialog.primary = `${completeness}%`
    detailDialog.note = getRiskText(cow)
    detailDialog.rows = [
      { label: '当前圈舍', value: cow.currentPen || '未分配圈舍' },
      { label: '品种', value: formatBreed(cow.breed) },
      { label: '性别', value: formatGender(cow.gender) },
      { label: '状态', value: normalizeStatus(cow.status) },
      { label: '入库依据', value: '系谱登记、亲本编号和场内个体档案' },
      { label: '统计口径', value: '按父母号与祖代字段计算系谱完整度' },
      {
        label: '更新时间',
        value: formatDateTime((cow as any).updatedAt || (cow as any).createdAt)
      },
      { label: '风险判断', value: getRiskText(cow) }
    ]
    detailDialog.items = [
      { label: '父号', value: cow.fatherNumber || '待补录' },
      { label: '母号', value: cow.motherNumber || '待补录' },
      { label: '外祖父', value: cow.grandfatherNumber || '待补录' },
      { label: '外祖母', value: cow.grandmotherNumber || '待补录' },
      { label: '母系', value: getMaternalLineName(cow) },
      { label: '完整度', value: `${completeness}%` }
    ]
    detailDialogVisible.value = true
  }

  function openCowDetailById(id: string) {
    const cow = rows.value.find((item) => item.id === id)
    if (cow) openCowDetail(cow)
  }

  function focusIncompleteRows() {
    const target = criticalMissing.value[0]
    if (!target) {
      ElMessage.success('当前没有父母号缺口个体')
      return
    }
    selectCow(target)
    ElMessage.info(`已定位待补录个体：${target.cowNumber}`)
  }

  async function loadData() {
    if (pedigreeLoading.value) return
    pedigreeLoading.value = true
    try {
      const context = await buildUnifiedDataContext()
      rows.value = [...context.cows] as CowBasic[]
      if (!rows.value.some((cow) => cow.id === selectedCowId.value)) {
        selectedCowId.value = getDefaultFocusCow()?.id || ''
      }
      if (!rows.value.some((cow) => cow.id === originCowId.value)) {
        originCowId.value = selectedCowId.value
      }
    } finally {
      pedigreeLoading.value = false
    }
  }

  onMounted(() => {
    window.setTimeout(() => {
      void loadData().catch((error) => {
        console.error('加载系谱数据失败', error)
        ElMessage.warning('系谱页面已打开，数据稍后可刷新重试')
      })
    }, 0)
  })

  function setTreeNodeElement(element: Element | ComponentPublicInstance | null) {
    const dom = element && '$el' in element ? element.$el : element
    if (!(dom instanceof HTMLElement)) return
    const nodeId = dom.dataset.nodeId
    if (!nodeId) return
    treeNodeElements.set(nodeId, dom)
    observeTreeNode(dom)
  }

  function observeTreeNode(element: HTMLElement) {
    if (typeof ResizeObserver === 'undefined') return
    if (!pedigreeResizeObserver) {
      pedigreeResizeObserver = new ResizeObserver(() => schedulePedigreeLinkUpdate())
    }
    pedigreeResizeObserver.observe(element)
  }

  function nodeAnchor(nodeId: string, side: 'top' | 'bottom') {
    const canvas = pedigreeCanvasRef.value
    const node = treeNodeElements.get(nodeId)
    if (!canvas || !node) return null
    const canvasRect = canvas.getBoundingClientRect()
    const rect = node.getBoundingClientRect()
    return {
      x: rect.left - canvasRect.left + rect.width / 2,
      y: side === 'top' ? rect.top - canvasRect.top : rect.bottom - canvasRect.top
    }
  }

  function linkPath(fromId: string, toId: string) {
    const from = nodeAnchor(fromId, 'bottom')
    const to = nodeAnchor(toId, 'top')
    if (!from || !to) return ''
    const midY = from.y + Math.max(18, (to.y - from.y) / 2)
    return `M${from.x.toFixed(1)} ${from.y.toFixed(1)} C${from.x.toFixed(1)} ${midY.toFixed(1)} ${to.x.toFixed(1)} ${midY.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`
  }

  function buildMeasuredLink(
    id: string,
    fromId: string | undefined,
    toId: string | undefined,
    tone: NodeTone
  ): PedigreeLink | null {
    if (!fromId || !toId) return null
    const path = linkPath(fromId, toId)
    return path ? { id, path, tone } : null
  }

  async function updatePedigreeLinks() {
    await nextTick()
    const canvas = pedigreeCanvasRef.value
    if (!canvas) {
      measuredLinks.value = []
      return
    }
    const rect = canvas.getBoundingClientRect()
    pedigreeLinkViewBox.value = `0 0 ${Math.max(1, rect.width).toFixed(0)} ${Math.max(1, rect.height).toFixed(0)}`
    const ancestors = ancestorNodes.value
    const parents = parentNodes.value
    const nextLinks = [
      buildMeasuredLink(
        'father-grand-sire',
        ancestors[0]?.id,
        parents[0]?.id,
        ancestors[0]?.tone || 'pending'
      ),
      buildMeasuredLink(
        'father-grand-dam',
        ancestors[1]?.id,
        parents[0]?.id,
        ancestors[1]?.tone || 'pending'
      ),
      buildMeasuredLink(
        'mother-grand-sire',
        ancestors[2]?.id,
        parents[1]?.id,
        ancestors[2]?.tone || 'pending'
      ),
      buildMeasuredLink(
        'mother-grand-dam',
        ancestors[3]?.id,
        parents[1]?.id,
        ancestors[3]?.tone || 'pending'
      ),
      buildMeasuredLink(
        'father-current',
        parents[0]?.id,
        currentNode.value.id,
        parents[0]?.tone || 'pending'
      ),
      buildMeasuredLink(
        'mother-current',
        parents[1]?.id,
        currentNode.value.id,
        parents[1]?.tone || 'pending'
      )
    ].filter((link): link is PedigreeLink => Boolean(link))
    measuredLinks.value = nextLinks
  }

  function schedulePedigreeLinkUpdate() {
    if (pedigreeLinkFrame) return
    pedigreeLinkFrame = window.requestAnimationFrame(() => {
      pedigreeLinkFrame = 0
      updatePedigreeLinks()
    })
  }

  watch([selectedCow, ancestorNodes, parentNodes], () => {
    treeNodeElements.clear()
    measuredLinks.value = []
    schedulePedigreeLinkUpdate()
  })

  onBeforeUnmount(() => {
    if (pedigreeLinkFrame) window.cancelAnimationFrame(pedigreeLinkFrame)
    pedigreeResizeObserver?.disconnect()
  })
</script>

<style scoped lang="scss">
  .fc-metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 14px;
  }

  .tree-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 340px;
    gap: 14px;
    align-items: start;
  }

  .tree-toolbar,
  .card-toolbar,
  .cow-card-head,
  .card-footer,
  .queue-item {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    justify-content: space-between;
  }

  .tree-toolbar {
    align-items: center;
    margin-bottom: 14px;
  }

  .tree-toolbar span,
  .card-toolbar span,
  .tree-node span,
  .queue-item span,
  .cow-card-head span,
  .pedigree-fields span,
  .card-progress span,
  .card-footer span,
  .generation-label {
    color: var(--fluent-muted);
    font-size: 12px;
    font-weight: 680;
  }

  .tree-toolbar strong,
  .card-toolbar strong {
    display: block;
    margin-top: 3px;
    color: var(--fluent-text);
    font-size: 20px;
    font-weight: 780;
  }

  .tree-toolbar p {
    margin: 4px 0 0;
    color: var(--fluent-text-soft);
    font-size: 13px;
  }

  .tree-search {
    width: min(360px, 48%);
    min-width: 260px;
  }

  .tree-search :deep(.cow-number-autocomplete) {
    width: 100%;
    min-width: 0;
  }

  .pedigree-loading-card {
    display: grid;
    gap: 4px;
    margin-bottom: 12px;
    padding: 10px 12px;
    background: rgb(var(--fluent-primary-rgb) / 8%);
    border: 1px solid rgb(var(--fluent-primary-rgb) / 18%);
    border-radius: var(--fluent-radius);
  }

  .pedigree-loading-card span {
    color: var(--fluent-muted);
    font-size: 12px;
    font-weight: 720;
  }

  .pedigree-loading-card strong {
    color: var(--fluent-text);
    font-size: 13px;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .pedigree-canvas {
    position: relative;
    display: grid;
    gap: 10px;
    min-height: 390px;
    padding: 16px;
    overflow: auto;
    background: var(--fluent-surface);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
  }

  .pedigree-link-layer {
    position: absolute;
    inset: 0;
    z-index: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .pedigree-link {
    fill: none;
    stroke: rgb(var(--fluent-primary-rgb) / 48%);
    stroke-linecap: round;
    stroke-width: 3;
  }

  .pedigree-link.pending {
    stroke: rgb(245 158 11 / 48%);
    stroke-dasharray: 8 8;
  }

  .pedigree-link.missing {
    stroke: rgb(209 52 56 / 46%);
    stroke-dasharray: 5 8;
  }

  .generation-label {
    position: relative;
    z-index: 1;
    text-transform: uppercase;
  }

  .tree-generation {
    position: relative;
    z-index: 1;
    display: grid;
    gap: 12px;
    align-items: stretch;
  }

  .tree-generation.is-ancestors {
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  }

  .tree-generation.is-parents {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    max-width: 720px;
    margin: 0 auto;
  }

  .tree-generation.is-current {
    max-width: 360px;
    margin: 0 auto;
  }

  .tree-node {
    min-width: 0;
    padding: 14px;
    cursor: pointer;
    background: var(--fluent-surface);
    border: 1px solid var(--fluent-border);
    border-top: 4px solid var(--fluent-primary);
    border-radius: var(--fluent-radius);
    box-shadow: var(--fluent-inset-highlight), var(--fluent-shadow);
    backdrop-filter: var(--fluent-blur);
    -webkit-backdrop-filter: var(--fluent-blur);
    transition:
      border-color 180ms cubic-bezier(0.16, 1, 0.3, 1),
      box-shadow 180ms cubic-bezier(0.16, 1, 0.3, 1),
      transform 180ms cubic-bezier(0.16, 1, 0.3, 1),
      background-color 180ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .tree-node:hover,
  .tree-node:focus-visible {
    outline: none;
    border-color: rgb(var(--fluent-primary-rgb) / 38%);
    background: rgb(248 250 252);
    box-shadow: var(--fluent-inset-highlight), var(--fluent-shadow-hover);
    transform: var(--fluent-card-hover-transform);
  }

  .tree-node.pending {
    border-top-color: var(--fluent-amber);
  }

  .tree-node.missing {
    border-top-color: var(--fluent-danger);
    background: rgb(255 247 247 / 72%);
  }

  .tree-node.is-selected {
    border-color: rgb(var(--fluent-primary-rgb) / 45%);
    border-top-color: var(--fluent-primary);
    background: rgb(var(--fluent-primary-rgb) / 8%);
  }

  .tree-node.is-origin-compressed {
    max-width: 260px;
    padding: 10px 12px;
    margin: 0 auto;
  }

  .tree-node strong {
    display: block;
    margin-top: 5px;
    min-width: 0;
    overflow: hidden;
    color: var(--fluent-text);
    font-size: 18px;
    font-weight: 780;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tree-node span,
  .tree-node p {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tree-node p {
    min-height: 34px;
    margin: 7px 0 0;
    color: var(--fluent-text-soft);
    font-size: 12px;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .tree-action-row {
    position: relative;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
    min-height: 30px;
  }

  .descendant-strip {
    position: relative;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
    min-height: 34px;
  }

  .descendant-strip button {
    display: grid;
    gap: 2px;
    min-width: 104px;
    padding: 7px 10px;
    cursor: pointer;
    background: rgb(255 255 255 / 68%);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius-sm);
  }

  .descendant-strip button:hover,
  .descendant-strip button:focus-visible {
    outline: none;
    border-color: rgb(var(--fluent-primary-rgb) / 38%);
  }

  .descendant-strip span {
    color: var(--fluent-muted);
    font-size: 11px;
    font-weight: 680;
  }

  .descendant-strip strong {
    color: var(--fluent-text);
    font-size: 13px;
    font-weight: 760;
  }

  .trace-origin-strip {
    position: relative;
    z-index: 1;
    display: flex;
    justify-content: center;
  }

  .trace-origin-strip button {
    display: grid;
    gap: 3px;
    min-width: min(100%, 280px);
    padding: 9px 12px;
    color: var(--fluent-text);
    cursor: pointer;
    background: var(--fluent-surface-subtle);
    border: 1px dashed var(--fluent-border-strong);
    border-radius: var(--fluent-radius-sm);
  }

  .trace-origin-strip span,
  .trace-origin-strip small {
    color: var(--fluent-muted);
    font-size: 11px;
    font-weight: 680;
  }

  .trace-origin-strip strong {
    color: var(--fluent-text);
    font-size: 14px;
    font-weight: 780;
  }

  .queue-list {
    display: grid;
    gap: 12px;
  }

  .queue-item {
    padding: 12px;
    cursor: pointer;
    background: var(--fluent-surface);
    border: 1px solid var(--fluent-border);
    border-left: 4px solid var(--fluent-primary);
    border-radius: var(--fluent-radius);
    transition:
      background-color 160ms ease,
      border-color 160ms ease;
  }

  .queue-item:hover {
    background: rgb(248 250 252);
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
  }

  .queue-item p {
    margin: 8px 0 0;
    color: var(--fluent-text-soft);
    font-size: 13px;
    line-height: 1.6;
  }

  .card-toolbar {
    align-items: center;
    margin-bottom: 14px;
  }

  .cow-card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
    gap: 12px;
  }

  .cow-card-scroll {
    max-height: min(44vh, 360px);
    overflow-y: auto;
    padding-right: 6px;
  }

  .cow-card {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 12px;
    cursor: pointer;
    background: var(--fluent-surface);
    border: 1px solid var(--fluent-border);
    border-left: 4px solid var(--fluent-primary);
    border-radius: var(--fluent-radius);
    transition:
      background-color 160ms ease,
      border-color 160ms ease;
  }

  .cow-card:hover,
  .cow-card:focus-visible,
  .cow-card.is-active:hover,
  .cow-card.is-active:focus-visible {
    border-color: rgb(var(--fluent-primary-rgb) / 45%);
    background: rgb(248 250 252);
  }

  .cow-card.has-gap {
    border-left-color: var(--fluent-amber);
  }

  .cow-card.has-risk {
    border-left-color: var(--fluent-danger);
  }

  .cow-card.is-active {
    background: rgb(var(--fluent-primary-rgb) / 7%);
  }

  .cow-card h3 {
    margin: 5px 0 0;
    color: var(--fluent-text);
    font-size: 16px;
    font-weight: 780;
    overflow-wrap: anywhere;
  }

  .cow-card p {
    margin: 5px 0 0;
    color: var(--fluent-text-soft);
    font-size: 13px;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }

  .pedigree-detail-shell {
    display: grid;
    gap: 12px;
  }

  .detail-summary {
    display: grid;
    gap: 4px;
    padding: 14px;
    background: rgb(var(--fluent-primary-rgb) / 7%);
    border: 1px solid rgb(var(--fluent-primary-rgb) / 12%);
    border-radius: var(--fluent-radius);
  }

  .detail-summary span,
  .detail-row span,
  .detail-item span {
    color: var(--fluent-muted);
    font-size: 12px;
    font-weight: 680;
  }

  .detail-summary strong {
    color: var(--fluent-text);
    font-size: 24px;
    font-weight: 780;
  }

  .detail-grid,
  .detail-table {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .detail-row,
  .detail-item {
    min-width: 0;
    padding: 10px;
    background: rgb(255 255 255 / 48%);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
  }

  .detail-row strong,
  .detail-item strong {
    display: block;
    margin-top: 4px;
    color: var(--fluent-text);
    font-size: 13px;
    font-weight: 760;
  }

  .detail-note {
    padding: 10px 12px;
    color: var(--fluent-text-soft);
    font-size: 13px;
    line-height: 1.6;
    background: rgb(var(--fluent-primary-rgb) / 5%);
    border: 1px solid rgb(var(--fluent-primary-rgb) / 10%);
    border-radius: var(--fluent-radius);
  }

  .pedigree-fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .pedigree-fields div {
    min-width: 0;
    padding: 10px;
    background: rgb(255 255 255 / 42%);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
  }

  .pedigree-fields strong {
    display: block;
    margin-top: 4px;
    overflow: hidden;
    color: var(--fluent-text);
    font-size: 14px;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-progress {
    display: grid;
    gap: 8px;
  }

  .card-progress div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .card-progress strong,
  .card-footer strong {
    color: var(--fluent-text);
    font-size: 13px;
    font-weight: 760;
  }

  .card-footer {
    align-items: center;
    padding-top: 2px;
  }

  @media (max-width: 1180px) {
    .fc-metric-grid,
    .tree-layout {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .tree-layout {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 900px) {
    .fc-metric-grid,
    .tree-generation.is-ancestors,
    .tree-generation.is-parents {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .tree-search {
      width: 100%;
    }

    .tree-toolbar {
      display: grid;
    }
  }

  @media (max-width: 640px) {
    .fc-metric-grid,
    .tree-generation.is-ancestors,
    .tree-generation.is-parents,
    .pedigree-fields {
      grid-template-columns: 1fr;
    }

    .pedigree-canvas {
      padding: 14px;
    }

    .pedigree-link-layer {
      opacity: 0.55;
    }

    .queue-item,
    .cow-card-head,
    .card-footer {
      display: grid;
    }
  }
</style>
