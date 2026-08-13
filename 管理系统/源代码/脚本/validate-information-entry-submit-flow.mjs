import path from 'node:path'
import { createServer } from 'vite'
import { webcrypto } from 'node:crypto'

const BASE_URL = normalizeBaseUrl(
  process.env.ENTRY_SUBMIT_BASE_URL ||
    process.env.IMPORT_VALIDATION_BASE_URL ||
    'http://127.0.0.1:9191'
)
const ADMIN_USER = process.env.ADMIN_USER || 'admin'
const ADMIN_PASSWORD_ENV_NAMES = ['TEST_ADMIN_PASSWORD', 'SECURITY_ADMIN_PASSWORD', 'ADMIN_PASSWORD']
const TEST_DB_CONFIRM_ENV = 'ENTRY_SUBMIT_TEST_DB'
const NON_PROD_CONFIRM_ENV = 'IMPORT_VALIDATION_NON_PROD_OK'
const RUN_ID = `ACPT-SUBMIT-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`
const OPERATOR = '提交链路验收'
const args = parseArgs(process.argv.slice(2))
const keepData = Boolean(args['keep-data'])
const cleanupPrefix = text(args['cleanup-prefix'])
const listOnly = Boolean(args.list)
const debug = Boolean(args.debug)

const validationCases = [
  {
    id: 'single-entry',
    title: '入群：新牛建档 + 标准事件 + 旧表 + 最近记录',
    templateCode: 'animal-event',
    mode: 'single',
    rows: (refs) => [
      {
        牛号: refs.entryCow.number,
        事件类型编码: 'entry',
        event_type: 'entry',
        eventType: 'entry',
        事件名称: '入群',
        发生时间: '2026-06-08 09:00:00',
        to_unit_code: refs.penA.id,
        toUnitCode: refs.penA.id,
        to_unit_id: refs.penA.id,
        目标圈舍: refs.penA.id,
        movement_reason: '购入入群',
        入群原因: '购入入群',
        sex: '母',
        gender: '母',
        breed: '摩拉水牛',
        birth_date: '2025-08-18',
        father_number: `${RUN_ID}-SIRE-EXT`,
        mother_number: `${RUN_ID}-DAM-EXT`,
        记录人: OPERATOR,
        operatorName: OPERATOR,
        备注: RUN_ID
      }
    ],
    verify: async (ctx, refs, commit) => {
      const animal = await expectAny('animal', (row) => animalNumberOf(row) === refs.entryCow.number, '入群应创建 animal 主档')
      const cowId = idOf(animal)
      await expectAny('cows', (row) => animalNumberOf(row) === refs.entryCow.number, '入群应创建 cows 兼容牛档')
      await expectAny('animal_event', (row) => cowIdOf(row) === cowId && eventCodeOf(row) === 'entry', '入群应写 animal_event')
      await expectAny('cow-events', (row) => cowNumberOf(row) === refs.entryCow.number && eventCodeOf(row) === 'entry', '入群应写 cow-events')
      await expectAny('event_movement_detail', (row) => linkedEventIdOf(row, commit) && toUnitOf(row) === refs.penA.id, '入群应写 movement detail 且目标圈舍正确')
      await expectAny('entry-events', (row) => cowNumberOf(row) === refs.entryCow.number, '入群应写 entry-events 旧表')
      await expectAny('animal_parentage', (row) => cowIdOf(row) === cowId && parentNumberOf(row).startsWith(RUN_ID), '入群父母号应写入系谱关系')
      await expectRecentSingleEntry('entry', refs.entryCow.number)
      await expectImportAudit(commit, 'animal-event')
      await expectExportReadback(refs.entryCow.number, 'entry')
    }
  },
  {
    id: 'single-transfer',
    title: '转群：目标圈舍 + 圈舍历史 + 旧表',
    templateCode: 'animal-event',
    mode: 'single',
    rows: (refs) => [
      {
        牛号: refs.transferCow.number,
        牛只ID: refs.transferCow.id,
        事件类型编码: 'transfer',
        event_type: 'transfer',
        eventType: 'transfer',
        事件名称: '转群',
        发生时间: '2026-06-08 10:00:00',
        to_unit_code: refs.penB.id,
        toUnitCode: refs.penB.id,
        to_unit_id: refs.penB.id,
        目标圈舍: refs.penB.id,
        movement_reason: '断奶转群',
        转群原因: '断奶转群',
        记录人: OPERATOR,
        operatorName: OPERATOR,
        备注: RUN_ID
      }
    ],
    verify: async (ctx, refs, commit) => {
      await expectAny('animal_event', (row) => cowIdOf(row) === refs.transferCow.id && eventCodeOf(row) === 'transfer', '转群应写 animal_event')
      await expectAny('cow-events', (row) => cowNumberOf(row) === refs.transferCow.number && eventCodeOf(row) === 'transfer', '转群应写 cow-events')
      await expectAny('event_movement_detail', (row) => linkedEventIdOf(row, commit) && toUnitOf(row) === refs.penB.id, '转群应写目标圈舍明细')
      await expectAny('transfer-events', (row) => cowNumberOf(row) === refs.transferCow.number && toUnitOf(row) === refs.penB.id, '转群应写 transfer-events 旧表')
      await expectAny('animal_pen_assignment', (row) => cowIdOf(row) === refs.transferCow.id && toUnitOf(row) === refs.penB.id && !text(row.end_date || row.endDate), '转群应生成当前圈舍分配')
      await expectAny('cows', (row) => cowNumberOf(row) === refs.transferCow.number && currentPenOf(row) === refs.penB.id, '转群应更新 cows 当前圈舍')
      await expectRecentSingleEntry('transfer', refs.transferCow.number)
      await expectImportAudit(commit, 'animal-event')
      await expectExportReadback(refs.transferCow.number, 'transfer')
    }
  },
  {
    id: 'single-exit',
    title: '离群：当前圈舍清空 + 状态离群 + 旧表',
    templateCode: 'animal-event',
    mode: 'single',
    rows: (refs) => [
      {
        牛号: refs.exitCow.number,
        牛只ID: refs.exitCow.id,
        事件类型编码: 'exit',
        event_type: 'exit',
        eventType: 'exit',
        事件名称: '离群/淘汰',
        发生时间: '2026-06-08 11:00:00',
        movement_reason: '淘汰离群',
        离群原因: '淘汰离群',
        记录人: OPERATOR,
        operatorName: OPERATOR,
        备注: RUN_ID
      }
    ],
    verify: async (ctx, refs, commit) => {
      await expectAny('animal_event', (row) => cowIdOf(row) === refs.exitCow.id && eventCodeOf(row) === 'exit', '离群应写 animal_event')
      await expectAny('cow-events', (row) => cowNumberOf(row) === refs.exitCow.number && eventCodeOf(row) === 'exit', '离群应写 cow-events')
      await expectAny('event_movement_detail', (row) => linkedEventIdOf(row, commit) && !toUnitOf(row), '离群 movement detail 目标圈舍应为空')
      await expectAny('exit-events', (row) => cowNumberOf(row) === refs.exitCow.number, '离群应写 exit-events 旧表')
      await expectAny('cows', (row) => cowNumberOf(row) === refs.exitCow.number && /离群|淘汰/.test(text(row.status)) && !currentPenOf(row), '离群应更新 cows 状态并清空当前圈舍')
      await expectRecentSingleEntry('exit', refs.exitCow.number)
      await expectImportAudit(commit, 'animal-event')
      await expectExportReadback(refs.exitCow.number, 'exit')
    }
  },
  {
    id: 'single-insemination',
    title: '输精：一次提交一条事件 + 忽略手填本胎输精数',
    templateCode: 'animal-event',
    mode: 'single',
    rows: (refs) => [
      {
        牛号: refs.breedingCow.number,
        牛只ID: refs.breedingCow.id,
        事件类型编码: 'insemination',
        event_type: 'insemination',
        eventType: 'insemination',
        事件名称: '输精/配种',
        发生时间: '2026-06-08 12:00:00',
        bull_number: `${RUN_ID}-BULL-EXT`,
        semen_batch: `${RUN_ID}-SEMEN`,
        insemination_count: 99,
        本胎输精次数: 99,
        记录人: OPERATOR,
        operatorName: OPERATOR,
        备注: RUN_ID
      }
    ],
    verify: async (ctx, refs, commit, dryRun) => {
      const warnings = dryRun.errors.filter((item) => item.code === 'SYSTEM_INSEMINATION_COUNT_IGNORED')
      if (!warnings.length) throw new Error('输精 dry-run 应提示本胎输精次数由系统统计，手填值被忽略')
      await expectExactlyOne('animal_event', (row) => cowIdOf(row) === refs.breedingCow.id && eventCodeOf(row) === 'insemination', '输精一次提交只能产生一条 animal_event')
      await expectAny('event_reproduction_detail', (row) => linkedEventIdOf(row, commit) && text(row.reproduction_action || row.reproductionAction) === 'insemination', '输精应写 reproduction detail')
      await expectAny('breeding-events', (row) => cowNumberOf(row) === refs.breedingCow.number && /配种|输精/.test(eventNameOf(row)), '输精应写 breeding-events 旧表')
      await expectRecentSingleEntry('insemination', refs.breedingCow.number)
      await expectImportAudit(commit, 'animal-event')
      await expectExportReadback(refs.breedingCow.number, 'insemination')
    }
  },
  {
    id: 'single-pregnancy-check',
    title: '妊检：结果只允许阴性/阳性并写明细',
    templateCode: 'animal-event',
    mode: 'single',
    rows: (refs) => [
      {
        牛号: refs.breedingCow.number,
        牛只ID: refs.breedingCow.id,
        事件类型编码: 'pregnancy_check',
        event_type: 'pregnancy_check',
        eventType: 'pregnancy_check',
        事件名称: '妊检',
        发生时间: '2026-06-08 13:00:00',
        pregnancy_result: '阳性',
        妊检结果: '阳性',
        记录人: OPERATOR,
        operatorName: OPERATOR,
        备注: RUN_ID
      }
    ],
    verify: async (ctx, refs, commit) => {
      await expectAny('animal_event', (row) => cowIdOf(row) === refs.breedingCow.id && eventCodeOf(row) === 'pregnancy_check', '妊检应写 animal_event')
      await expectAny('event_reproduction_detail', (row) => linkedEventIdOf(row, commit) && text(row.pregnancy_result || row.pregnancyResult) === '阳性', '妊检结果应写 reproduction detail')
      await expectAny('breeding-events', (row) => cowNumberOf(row) === refs.breedingCow.number && /妊/.test(eventNameOf(row)), '妊检应写 breeding-events 旧表')
      await expectAny('cows', (row) => cowNumberOf(row) === refs.breedingCow.number && truthy(row.pregnancy), '妊检阳性应更新 cows 妊娠状态')
      await expectRecentSingleEntry('pregnancy_check', refs.breedingCow.number)
      await expectImportAudit(commit, 'animal-event')
      await expectExportReadback(refs.breedingCow.number, 'pregnancy_check')
    }
  },
  {
    id: 'single-calving-multi-calf',
    title: '产犊：多胎犊牛建档 + 母号系谱',
    templateCode: 'animal-event',
    mode: 'single',
    rows: (refs) => [
      {
        牛号: refs.calvingCow.number,
        牛只ID: refs.calvingCow.id,
        事件类型编码: 'calving',
        event_type: 'calving',
        eventType: 'calving',
        事件名称: '产犊',
        发生时间: '2026-06-08 14:00:00',
        calving_result: '顺产',
        产犊结果: '顺产',
        calves: [
          { cowNumber: `${RUN_ID}-CALF-1`, sex: '母', earTagNumber: `${RUN_ID}-CALF-E1`, remark: RUN_ID },
          { cowNumber: `${RUN_ID}-CALF-2`, sex: '公', earTagNumber: `${RUN_ID}-CALF-E2`, remark: RUN_ID }
        ],
        calfRows: [
          { cowNumber: `${RUN_ID}-CALF-1`, sex: '母', earTagNumber: `${RUN_ID}-CALF-E1`, remark: RUN_ID },
          { cowNumber: `${RUN_ID}-CALF-2`, sex: '公', earTagNumber: `${RUN_ID}-CALF-E2`, remark: RUN_ID }
        ],
        记录人: OPERATOR,
        operatorName: OPERATOR,
        备注: RUN_ID
      }
    ],
    verify: async (ctx, refs, commit) => {
      await expectAny('animal_event', (row) => cowIdOf(row) === refs.calvingCow.id && eventCodeOf(row) === 'calving', '产犊应写 animal_event')
      await expectAny('event_reproduction_detail', (row) => linkedEventIdOf(row, commit) && text(row.calving_result || row.calvingResult) === '顺产', '产犊结果应写 reproduction detail')
      for (const calfNumber of [`${RUN_ID}-CALF-1`, `${RUN_ID}-CALF-2`]) {
        const calf = await expectAny('animal', (row) => animalNumberOf(row) === calfNumber, `产犊应创建犊牛 animal：${calfNumber}`)
        await expectAny('cows', (row) => cowNumberOf(row) === calfNumber, `产犊应写犊牛 cows 兼容表：${calfNumber}`)
        await expectAny('animal_parentage', (row) => cowIdOf(row) === idOf(calf) && parentNumberOf(row) === refs.calvingCow.number && text(row.parent_role || row.parentRole) === 'dam', `犊牛应关联母号：${calfNumber}`)
      }
      await expectAny('breeding-events', (row) => cowNumberOf(row) === refs.calvingCow.number && /产犊/.test(eventNameOf(row)), '产犊应写 breeding-events 旧表')
      await expectRecentSingleEntry('calving', refs.calvingCow.number)
      await expectImportAudit(commit, 'animal-event')
      await expectExportReadback(refs.calvingCow.number, 'calving')
    }
  },
  {
    id: 'single-body-measurement-trait',
    title: '生产/表型：体尺/体重单条录入写标准表和旧镜像',
    templateCode: 'animal-event',
    mode: 'single',
    rows: (refs) => [
      {
        牛号: refs.productionCow.number,
        牛只ID: refs.productionCow.id,
        事件类型编码: 'body_measurement',
        event_type: 'body_measurement',
        eventType: 'body_measurement',
        事件名称: '体尺测定',
        发生时间: '2026-06-08 15:00:00',
        trait_observations: [
          {
            traitCode: 'body_weight',
            traitName: '体重',
            value: 612.5,
            unit: 'kg',
            observedAt: '2026-06-08 15:00:00'
          },
          {
            traitCode: 'body_height',
            traitName: '体高',
            value: 138.2,
            unit: 'cm',
            observedAt: '2026-06-08 15:00:00'
          }
        ],
        measure_method: '人工测定',
        记录人: OPERATOR,
        operatorName: OPERATOR,
        备注: RUN_ID
      }
    ],
    verify: async (ctx, refs, commit) => {
      await expectAny('animal_event', (row) => cowIdOf(row) === refs.productionCow.id && eventCodeOf(row) === 'body_measurement', '体尺测定应写 animal_event')
      await expectAny('event_production_detail', (row) => linkedEventIdOf(row, commit) && text(row.operation_type || row.operationType) === 'body_measurement', '体尺测定应写 production detail')
      await expectAny('trait_observation', (row) => cowIdOf(row) === refs.productionCow.id && traitMatches(row, 'body_weight') && Number(valueOf(row)) === 612.5, '体重应写 trait_observation')
      await expectAny('phenotype-records', (row) => cowIdOf(row) === refs.productionCow.id && traitMatches(row, 'body_weight') && Number(valueOf(row)) === 612.5, '体重应写 phenotype-records 旧镜像')
      await expectRecentSingleEntry('body_measurement', refs.productionCow.number)
      await expectImportAudit(commit, 'animal-event')
      await expectExportReadback(refs.productionCow.number, 'body_measurement')
    }
  },
  {
    id: 'single-milk-measurement',
    title: '生产/泌乳：单条产奶写标准表和旧镜像',
    templateCode: 'milk-measurement',
    mode: 'single',
    rows: (refs) => [
      {
        牛号: refs.productionCow.number,
        牛只ID: refs.productionCow.id,
        班次编号: `${RUN_ID}-MILK-SHIFT`,
        班次名称: '晚班',
        挤奶时间: '2026-06-08 18:00:00',
        产奶量: 9.6,
        乳脂率: 6.2,
        乳蛋白率: 4.4,
        乳糖率: 4.8,
        体细胞数: 210000,
        质量标记: '正常',
        开产时间: '2026-06-01',
        上传胎次: 2,
        记录人: OPERATOR,
        operatorName: OPERATOR,
        备注: RUN_ID
      }
    ],
    verify: async (ctx, refs, commit) => {
      await expectAny('milking_session', (row) => rowHasRunId(row) && text(row.session_code || row.sessionCode).includes(RUN_ID), '产奶应写 milking_session')
      await expectAny('milking_visit', (row) => cowIdOf(row) === refs.productionCow.id && Number(valueOf(row)) === 9.6, '产奶应写 milking_visit')
      await expectAny('milk_measurement', (row) => cowIdOf(row) === refs.productionCow.id && Number(valueOf(row)) === 9.6, '产奶应写 milk_measurement')
      await expectAny('milk-records', (row) => cowIdOf(row) === refs.productionCow.id && Number(valueOf(row)) === 9.6, '产奶应写 milk-records 旧镜像')
      await expectImportAudit(commit, 'milk-measurement')
    }
  }
]

async function main() {
  if (listOnly) {
    validationCases.forEach((item, index) => {
      console.log(`${index + 1}. ${item.id} - ${item.title}`)
    })
    return
  }

  await requireExplicitNonProductionTarget('信息录入真实提交链路验收')
  setupBrowserMocks()
  const server = await createValidationServer()
  const results = []
  let ctx = null
  try {
    const token = await login()
    globalThis.__ENTRY_SUBMIT_TOKEN__ = token
    if (cleanupPrefix) {
      await cleanupValidationData(cleanupPrefix)
      console.log(`已清理验证数据前缀：${cleanupPrefix}`)
      return
    }

    const adapter = await server.ssrLoadModule('/src/services/import-adapter.ts')
    ctx = { adapter, refs: null }
    await cleanupValidationData(RUN_ID).catch(() => undefined)
    ctx.refs = await seedReferenceData()

    for (const testCase of validationCases) {
      if (debug) console.log(`[ENTRY-SUBMIT] start ${testCase.id}`)
      const result = await runCase(ctx, testCase)
      results.push(result)
      console.log(formatResult(result))
      if (debug) console.log(`[ENTRY-SUBMIT] end ${testCase.id}`)
    }
  } finally {
    if (ctx && !keepData && !cleanupPrefix) {
      await cleanupValidationData(RUN_ID).catch((error) => {
        console.error(`清理 ACPT-SUBMIT 验证数据失败：${error.message || error}`)
      })
    }
    await server.close()
  }

  printSummary(results)
  if (results.some((item) => item.status !== 'PASS')) process.exitCode = 1
}

async function runCase(ctx, testCase) {
  const startedAt = Date.now()
  const result = {
    id: testCase.id,
    title: testCase.title,
    status: 'PASS',
    dryRun: null,
    commit: null,
    errors: [],
    durationMs: 0
  }
  try {
    const rows = testCase.rows(ctx.refs)
    const dryRun = await ctx.adapter.dryRunImportRows({
      mode: testCase.mode,
      templateCode: testCase.templateCode,
      rows,
      operatorId: `operator-${RUN_ID}`,
      operatorName: OPERATOR
    })
    result.dryRun = pickStats(dryRun)
    if (dryRun.errorRows) {
      throw new Error(`dry-run 有 ${dryRun.errorRows} 行错误：${summarizeImportErrors(dryRun.errors)}`)
    }
    const commit = await ctx.adapter.commitImportRows({
      mode: testCase.mode,
      templateCode: testCase.templateCode,
      rows,
      operatorId: `operator-${RUN_ID}`,
      operatorName: OPERATOR
    })
    result.commit = pickStats(commit)
    if (commit.errorRows) {
      throw new Error(`commit 有 ${commit.errorRows} 行错误：${summarizeImportErrors(commit.errors)}`)
    }
    if (commit.committedRows < 1) {
      throw new Error(`commit 未写入业务行：${JSON.stringify(pickStats(commit))}`)
    }
    await testCase.verify(ctx, ctx.refs, commit, dryRun)
  } catch (error) {
    result.status = 'FAIL'
    result.errors.push(error?.stack || error?.message || String(error))
  } finally {
    result.durationMs = Date.now() - startedAt
  }
  return result
}

async function seedReferenceData() {
  const now = new Date().toISOString()
  const penA = { id: `${RUN_ID}-PEN-A`, name: `${RUN_ID} 验收圈舍A` }
  const penB = { id: `${RUN_ID}-PEN-B`, name: `${RUN_ID} 验收圈舍B` }
  await ensureFarmUnit(penA)
  await ensureFarmUnit(penB)
  await ensureTrait('body_weight', '体重', 'kg', 'phenotype')
  await ensureTrait('body_height', '体高', 'cm', 'body_measurement')
  await ensureTrait('milk_yield', '单次产奶量', 'kg', 'lactation')

  const refs = {
    penA,
    penB,
    entryCow: { number: `${RUN_ID}-ENTRY` },
    transferCow: cowRef('TRANSFER', penA.id),
    exitCow: cowRef('EXIT', penA.id),
    breedingCow: cowRef('BREED', penA.id),
    calvingCow: cowRef('CALVING', penA.id),
    productionCow: cowRef('PROD', penA.id)
  }
  for (const cow of [refs.transferCow, refs.exitCow, refs.breedingCow, refs.calvingCow, refs.productionCow]) {
    await seedCow(cow, now)
  }
  return refs
}

function cowRef(suffix, penId) {
  const number = `${RUN_ID}-${suffix}`
  return {
    id: compactId('animal', number),
    number,
    earTag: `${number}-ET`,
    penId
  }
}

async function seedCow(cow, now) {
  await rpc('addTableData', {
    tableName: 'animal',
    data: [
      {
        id: cow.id,
        animalId: cow.id,
        animal_id: cow.id,
        cowId: cow.id,
        cow_id: cow.id,
        animalNumber: cow.number,
        animal_number: cow.number,
        cowNumber: cow.number,
        cow_number: cow.number,
        earTagNumber: cow.earTag,
        ear_tag_number: cow.earTag,
        species: '水牛',
        breed: '摩拉水牛',
        sex: '母',
        birthDate: '2022-01-02',
        birth_date: '2022-01-02',
        entryDate: '2024-01-01',
        entry_date: '2024-01-01',
        currentPenId: cow.penId,
        current_pen_id: cow.penId,
        currentUnitId: cow.penId,
        current_unit_id: cow.penId,
        status: '在群',
        notes: RUN_ID,
        createdAt: now,
        created_at: now,
        updatedAt: now,
        updated_at: now
      }
    ]
  })
  await rpc('addTableData', {
    tableName: 'cows',
    data: [
      {
        id: cow.id,
        cowId: cow.id,
        cow_id: cow.id,
        animalId: cow.id,
        animal_id: cow.id,
        cowNumber: cow.number,
        cow_number: cow.number,
        animalNumber: cow.number,
        animal_number: cow.number,
        earTagNumber: cow.earTag,
        ear_tag_number: cow.earTag,
        breed: '摩拉水牛',
        gender: '母',
        sex: '母',
        birthDate: '2022-01-02',
        birth_date: '2022-01-02',
        type: '泌乳',
        cowType: '泌乳',
        cow_type: '泌乳',
        currentPen: cow.penId,
        current_pen: cow.penId,
        currentPenId: cow.penId,
        current_pen_id: cow.penId,
        currentUnitId: cow.penId,
        current_unit_id: cow.penId,
        status: '在群',
        pregnancy: false,
        parity: 1,
        notes: RUN_ID,
        createdAt: now,
        created_at: now,
        updatedAt: now,
        updated_at: now
      }
    ]
  })
  await rpc('addTableData', {
    tableName: 'animal_identifier',
    data: [
      {
        id: compactId('identifier', cow.id),
        animalId: cow.id,
        animal_id: cow.id,
        identifierType: 'animal_number',
        identifier_type: 'animal_number',
        identifierValue: cow.number,
        identifier_value: cow.number,
        isPrimary: true,
        is_primary: true,
        createdAt: now,
        created_at: now,
        updatedAt: now,
        updated_at: now
      }
    ]
  })
  await rpc('addTableData', {
    tableName: 'animal_pen_assignment',
    data: [
      {
        id: compactId('pen-assignment', cow.id, cow.penId, 'seed'),
        animalId: cow.id,
        animal_id: cow.id,
        cowId: cow.id,
        cow_id: cow.id,
        animalNumber: cow.number,
        animal_number: cow.number,
        cowNumber: cow.number,
        cow_number: cow.number,
        unitId: cow.penId,
        unit_id: cow.penId,
        unitCode: cow.penId,
        unit_code: cow.penId,
        startDate: '2024-01-01',
        start_date: '2024-01-01',
        assignedAt: '2024-01-01 00:00:00',
        assigned_at: '2024-01-01 00:00:00',
        sourceType: 'ACPT-SUBMIT-SEED',
        source_type: 'ACPT-SUBMIT-SEED',
        notes: RUN_ID,
        createdAt: now,
        created_at: now,
        updatedAt: now,
        updated_at: now
      }
    ]
  })
}

async function ensureFarmUnit(pen) {
  const now = new Date().toISOString()
  await rpc('addTableData', {
    tableName: 'farm_unit',
    data: [
      {
        id: pen.id,
        code: pen.id,
        unitId: pen.id,
        unit_id: pen.id,
        name: pen.name,
        unitName: pen.name,
        unit_name: pen.name,
        unitType: 'pen',
        unit_type: 'pen',
        capacity: 120,
        status: 'active',
        notes: RUN_ID,
        createdAt: now,
        created_at: now,
        updatedAt: now,
        updated_at: now
      }
    ]
  })
}

async function ensureTrait(code, name, unit, traitType) {
  const now = new Date().toISOString()
  const categoryId = compactId('trait-category', traitType)
  const traitId = compactId('trait', code)
  const [existingCategories, existingV2Traits, existingLegacyTraits] = await Promise.all([
    rpc('getTableData', { tableName: 'trait_category', pageSize: 5000 }).catch(() => []),
    rpc('getTableData', { tableName: 'trait_definition', pageSize: 5000 }).catch(() => []),
    rpc('getTableData', { tableName: 'phenotype-trait-definitions', pageSize: 5000 }).catch(
      () => []
    )
  ])
  const hasCategory = existingCategories.some(
    (row) => text(row.id) === categoryId || text(row.code) === categoryId
  )
  const hasV2Trait = existingV2Traits.some(
    (row) => text(row.code || row.trait_code || row.traitCode) === code
  )
  const hasLegacyTrait = existingLegacyTraits.some(
    (row) => text(row.code || row.trait_code || row.traitCode) === code
  )
  if (!hasCategory) {
    await rpc('addTableData', {
      tableName: 'trait_category',
      data: [
        {
          id: categoryId,
          code: categoryId,
          name: traitType === 'lactation' ? '泌乳性能' : '表型性状',
          domain: 'phenotype',
          notes: RUN_ID,
          createdAt: now,
          created_at: now,
          updatedAt: now,
          updated_at: now
        }
      ]
    })
  }
  if (!hasV2Trait) {
    await rpc('addTableData', {
      tableName: 'trait_definition',
      data: [
        {
          id: traitId,
          code,
          traitCode: code,
          trait_code: code,
          name,
          traitName: name,
          trait_name: name,
          categoryId,
          category_id: categoryId,
          traitType,
          trait_type: traitType,
          dataType: 'number',
          data_type: 'number',
          unit,
          status: 'active',
          notes: RUN_ID,
          createdAt: now,
          created_at: now,
          updatedAt: now,
          updated_at: now
        }
      ]
    })
  }
  if (!hasLegacyTrait) {
    await rpc('addTableData', {
      tableName: 'phenotype-trait-definitions',
      data: [
        {
          id: traitId,
          code,
          name,
          category:
            traitType === 'lactation'
              ? '泌乳'
              : traitType === 'body_measurement'
                ? '体尺'
                : '体重',
          dataType: '数值',
          unit,
          source: traitType === 'lactation' ? '奶厅导入' : '人工采集',
          status: '启用',
          notes: RUN_ID,
          createdAt: now,
          updatedAt: now
        }
      ]
    })
  }
}

async function cleanupValidationData(prefix = RUN_ID) {
  const tables = [
    'operation-audit-logs',
    'derivation_recompute_job',
    'milk-records',
    'milk_measurement',
    'milking_visit',
    'milking_session',
    'phenotype-records',
    'trait_observation',
    'trait_observation_batch',
    'event_medicine_detail',
    'event_health_detail',
    'event_production_detail',
    'event_reproduction_detail',
    'event_movement_detail',
    'veterinary-events',
    'breeding-events',
    'exit-events',
    'transfer-events',
    'entry-events',
    'cow-events',
    'animal_event',
    'animal_pen_assignment',
    'animal_parentage',
    'animal_identifier',
    'cows',
    'animal',
    'farm_unit',
    'phenotype-trait-definitions',
    'trait_definition',
    'trait_category'
  ]
  for (const tableName of tables) {
    const rows = await rpc('getTableData', { tableName }).catch(() => [])
    for (const row of rows) {
      if (!rowHasRunId(row, prefix)) continue
      const id = idOf(row)
      if (id) await rpc('deleteTableRecord', { tableName, id }).catch(() => undefined)
    }
  }
}

async function expectRecentSingleEntry(eventCode, cowNumber) {
  await expectAny('animal_event', (row) => {
    const details = parseObject(row.details || row.custom_values || row.customValues)
    return (
      cowNumberOf(row) === cowNumber &&
      eventCodeOf(row) === eventCode &&
      (text(row.source_type || row.sourceType || details.source_type || details.sourceType) === 'single_entry' ||
        text(row.import_mode || row.importMode || details.import_mode || details.importMode) === 'single')
    )
  }, `最近单条记录来源应包含 ${eventCode}/${cowNumber}`)
}

async function expectImportAudit(commit, templateCode) {
  await expectAny('operation-audit-logs', (row) => {
    const request = parseObject(row.request_payload || row.requestPayload)
    const result = parseObject(row.result_payload || row.resultPayload)
    return (
      text(row.action_type || row.actionType) === 'import_commit' &&
      text(request.templateCode) === templateCode &&
      Number(result.committedRows || row.committed_rows || 0) >= 1 &&
      (commit.targetRecordIds || []).some((id) => JSON.stringify(row).includes(id))
    )
  }, `应写入 ${templateCode} import_commit 操作审计`)
}

async function expectExportReadback(cowNumber, eventCode) {
  const rows = await rpc('getTableData', { tableName: 'animal_event', pageSize: 5000 })
  const matched = rows.find((row) => rowHasRunId(row) && cowNumberOf(row) === cowNumber && eventCodeOf(row) === eventCode)
  if (!matched) throw new Error(`信息导出回看源 animal_event 未找到 ${cowNumber}/${eventCode}`)
  const unifiedRows = await fetchCowEventsExportSource().catch(() => [])
  if (Array.isArray(unifiedRows) && unifiedRows.length) {
    const found = unifiedRows.find((row) => rowHasRunId(row) && cowNumberOf(row) === cowNumber && eventCodeOf(row) === eventCode)
    if (!found) throw new Error(`统一事件导出接口未回看到 ${cowNumber}/${eventCode}`)
  }
}

async function fetchCowEventsExportSource() {
  const res = await fetch(new URL('/api/cow/export/exportCowEvents', BASE_URL), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: globalThis.__ENTRY_SUBMIT_TOKEN__ || ''
    },
    body: JSON.stringify({ args: [{ cowNumbers: [RUN_ID], format: 'json' }] })
  })
  if (!res.ok) return []
  const payload = await res.json().catch(() => null)
  const data = payload?.data || payload
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.rows)) return data.rows
  if (Array.isArray(data?.records)) return data.records
  if (Array.isArray(data?.exportRows)) return data.exportRows
  return []
}

async function expectAny(tableName, predicate, message) {
  const rows = await rpc('getTableData', { tableName, pageSize: 5000 })
  const matched = rows.find((row) => rowHasRunId(row) && predicate(row))
  if (!matched) {
    const sample = rows.filter((row) => rowHasRunId(row)).slice(0, 5).map((row) => ({ id: row.id, ...row }))
    throw new Error(`${message}；表 ${tableName} 未匹配。样例：${JSON.stringify(sample)}`)
  }
  return matched
}

async function expectExactlyOne(tableName, predicate, message) {
  const rows = await rpc('getTableData', { tableName, pageSize: 5000 })
  const matched = rows.filter((row) => rowHasRunId(row) && predicate(row))
  if (matched.length !== 1) {
    throw new Error(`${message}；表 ${tableName} 匹配 ${matched.length} 条：${JSON.stringify(matched.slice(0, 5))}`)
  }
  return matched[0]
}

async function login() {
  const res = await fetch(new URL('/api/auth/login', BASE_URL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName: ADMIN_USER, password: getRequiredAdminPassword() })
  })
  const payload = await res.json()
  if (!res.ok || payload.code !== 200) throw new Error(`登录失败：${payload.msg || res.statusText}`)
  return payload.data.token
}

async function rpc(method, payload = {}) {
  const res = await fetch(new URL('/api/db/rpc', BASE_URL), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: globalThis.__ENTRY_SUBMIT_TOKEN__ || ''
    },
    body: JSON.stringify({ method, ...payload })
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || data?.code !== 200) {
    throw new Error(`RPC ${method}(${payload.tableName || ''}) 失败：${data?.msg || res.statusText}`)
  }
  return data.data
}

async function createValidationServer() {
  const mockPlugin = {
    name: 'information-entry-submit-flow-mocks',
    enforce: 'pre',
    resolveId(id) {
      const normalized = String(id).replace(/\\/g, '/')
      if (id === '@/utils/http' || normalized.endsWith('/src/utils/http/index.ts') || normalized.endsWith('/src/utils/http')) {
        return '\0mock-http'
      }
      if (
        /\.(css|scss|sass|less|png|jpg|jpeg|gif|svg|webp)$/.test(id) ||
        id.startsWith('@imgs') ||
        id.startsWith('@styles') ||
        id.startsWith('@icons')
      ) {
        return '\0mock-asset'
      }
      return null
    },
    load(id) {
      if (id === '\0mock-asset') return 'export default ""'
      if (id === '\0mock-http') {
        return `
          async function request(config) {
            const base = globalThis.__ENTRY_SUBMIT_BASE_URL__ || '${BASE_URL}'
            const url = new URL(config.url, base)
            if (config.params) Object.entries(config.params).forEach(([key, value]) => url.searchParams.set(key, String(value)))
            const headers = { ...(config.headers || {}) }
            if (globalThis.__ENTRY_SUBMIT_TOKEN__) headers.Authorization = globalThis.__ENTRY_SUBMIT_TOKEN__
            let body = config.data
            if (body !== undefined && body !== null && typeof body !== 'string') {
              headers['Content-Type'] = headers['Content-Type'] || 'application/json'
              body = JSON.stringify(body)
            }
            const res = await fetch(url, { method: config.method || 'GET', headers, body })
            const txt = await res.text()
            let payload
            try { payload = txt ? JSON.parse(txt) : null } catch { payload = txt }
            if (!res.ok) throw new Error(payload?.msg || payload?.message || res.statusText)
            if (payload && typeof payload === 'object' && 'code' in payload) {
              if (payload.code !== 200) throw new Error(payload.msg || payload.message || 'request failed')
              return payload.data
            }
            return payload
          }
          export default {
            get: (config) => request({ ...config, method: 'GET' }),
            post: (config) => request({ ...config, method: 'POST' }),
            put: (config) => request({ ...config, method: 'PUT' }),
            del: (config) => request({ ...config, method: 'DELETE' }),
            request
          }
        `
      }
      return null
    }
  }

  globalThis.__ENTRY_SUBMIT_BASE_URL__ = BASE_URL
  globalThis.__SKIP_PRODUCTION_FACT_REBUILD__ = true
  return createServer({
    configFile: false,
    mode: '生产配置',
    envDir: process.cwd(),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
    resolve: {
      alias: {
        '@': path.resolve('src'),
        '@imgs': path.resolve('src/assets/images'),
        '@icons': path.resolve('src/assets/icons'),
        '@styles': path.resolve('src/assets/styles')
      }
    },
    define: { __APP_VERSION__: JSON.stringify('entry-submit-validation') },
    optimizeDeps: { noDiscovery: true, entries: [] },
    plugins: [mockPlugin]
  })
}

function setupBrowserMocks() {
  const storage = makeStorage()
  const session = makeStorage()
  const location = {
    href: `${BASE_URL}/#/`,
    origin: BASE_URL,
    pathname: '/',
    search: '',
    hash: '#/'
  }
  Object.defineProperty(globalThis, 'location', { value: location, configurable: true })
  Object.defineProperty(globalThis, 'history', { value: { state: null, pushState() {}, replaceState() {} }, configurable: true })
  Object.defineProperty(globalThis, 'window', {
    value: {
      crypto: webcrypto,
      location,
      history: globalThis.history,
      addEventListener() {},
      removeEventListener() {},
      navigator: { userAgent: 'node' }
    },
    configurable: true
  })
  Object.defineProperty(globalThis, 'document', {
    value: {
      documentElement: {
        style: { setProperty() {} },
        classList: { contains() { return false }, add() {}, remove() {} }
      },
      body: {},
      title: '',
      addEventListener() {},
      removeEventListener() {},
      createElement() {
        return { style: {}, click() {}, setAttribute() {}, appendChild() {}, remove() {} }
      }
    },
    configurable: true
  })
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node' }, configurable: true })
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
  Object.defineProperty(globalThis, 'sessionStorage', { value: session, configurable: true })
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}

function makeStorage() {
  const values = new Map()
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null
    },
    setItem(key, value) {
      values.set(key, String(value))
    },
    removeItem(key) {
      values.delete(key)
    },
    clear() {
      values.clear()
    },
    key(index) {
      return Array.from(values.keys())[index] || null
    },
    get length() {
      return values.size
    }
  }
}

async function requireExplicitNonProductionTarget(action) {
  if (process.env[TEST_DB_CONFIRM_ENV] !== '1' && process.env[NON_PROD_CONFIRM_ENV] !== '1') {
    throw new Error(`${action} 会写入临时验收数据；请设置 ${TEST_DB_CONFIRM_ENV}=1 或 ${NON_PROD_CONFIRM_ENV}=1`)
  }
  const descriptor = [
    BASE_URL,
    process.env.NODE_ENV,
    process.env.VITE_APP_ENV,
    process.env.APP_ENV,
    process.env.DB_NAME,
    process.env.MYSQL_DATABASE,
    process.env.DATABASE_URL
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (/prod|production|正式|生产/.test(descriptor)) {
    throw new Error(`${action} 目标疑似生产环境：${descriptor}`)
  }
  if (!/127\.0\.0\.1|localhost|test|testing|dev|staging|local|验证/.test(descriptor)) {
    throw new Error(`${action} 缺少测试环境特征；当前目标：${descriptor}`)
  }
}

function getRequiredAdminPassword() {
  for (const name of ADMIN_PASSWORD_ENV_NAMES) {
    const value = process.env[name]
    if (value) return value
  }
  throw new Error(`缺少管理员密码环境变量：请设置 ${ADMIN_PASSWORD_ENV_NAMES.join(' 或 ')}`)
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) continue
    const [rawKey, inlineValue] = arg.slice(2).split('=', 2)
    if (inlineValue !== undefined) parsed[rawKey] = inlineValue
    else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      parsed[rawKey] = argv[index + 1]
      index += 1
    } else {
      parsed[rawKey] = true
    }
  }
  return parsed
}

function normalizeBaseUrl(value) {
  return String(value || 'http://127.0.0.1:9191').replace(/\/+$/, '')
}

function rowHasRunId(row, prefix = RUN_ID) {
  return JSON.stringify(row || {}).includes(prefix)
}

function idOf(row) {
  return text(row?.id || row?.animalId || row?.animal_id || row?.cowId || row?.cow_id)
}

function cowIdOf(row) {
  return text(row?.animalId || row?.animal_id || row?.cowId || row?.cow_id || row?.id)
}

function cowNumberOf(row) {
  const details = parseObject(row?.details || row?.custom_values || row?.customValues)
  return text(
    row?.cowNumber ||
      row?.cow_number ||
      row?.animalNumber ||
      row?.animal_number ||
      details.cowNumber ||
      details.cow_number ||
      details.animalNumber ||
      details.animal_number
  )
}

function animalNumberOf(row) {
  return cowNumberOf(row)
}

function eventCodeOf(row) {
  const details = parseObject(row?.details || row?.custom_values || row?.customValues)
  return normalizeEventCode(
    row?.eventCode ||
      row?.event_code ||
      row?.eventType ||
      row?.event_type ||
      details.eventCode ||
      details.event_code ||
      details.eventType ||
      details.event_type
  )
}

function eventNameOf(row) {
  return text(row?.eventName || row?.event_name || row?.eventType || row?.event_type)
}

function linkedEventIdOf(row, commit) {
  const id = text(row?.eventId || row?.event_id || row?.id)
  if (!commit) return Boolean(id)
  return (commit.targetRecordIds || []).some((targetId) => id === targetId || text(row.id) === targetId)
}

function toUnitOf(row) {
  return text(
    row?.toUnitId ||
      row?.to_unit_id ||
      row?.toUnitCode ||
      row?.to_unit_code ||
      row?.unitId ||
      row?.unit_id ||
      row?.unitCode ||
      row?.unit_code ||
      row?.toPen ||
      row?.pen
  )
}

function currentPenOf(row) {
  return text(
    row?.currentPen ||
      row?.current_pen ||
      row?.currentPenId ||
      row?.current_pen_id ||
      row?.currentUnitId ||
      row?.current_unit_id ||
      row?.currentPenCode ||
      row?.current_pen_code
  )
}

function parentNumberOf(row) {
  return text(row?.parentNumber || row?.parent_number)
}

function traitCodeOf(row) {
  return text(row?.traitCode || row?.trait_code || row?.traitId || row?.trait_id).replace(/^trait-/, '')
}

function traitMatches(row, code) {
  const wanted = text(code)
  const fields = [
    row?.traitCode,
    row?.trait_code,
    row?.traitId,
    row?.trait_id,
    row?.traitName,
    row?.trait_name,
    row?.name
  ]
    .map(text)
    .filter(Boolean)
  return fields.some((value) => value === wanted || value.includes(wanted))
}

function valueOf(row) {
  return text(row?.numericValue ?? row?.numeric_value ?? row?.value ?? row?.milkYield ?? row?.milk_yield ?? row?.volume)
}

function truthy(value) {
  if (typeof value === 'boolean') return value
  return /^(1|true|yes|是|阳性|pregnant)$/i.test(text(value))
}

function parseObject(value) {
  if (!value) return {}
  if (typeof value === 'object') return value
  try {
    return JSON.parse(String(value))
  } catch {
    return {}
  }
}

function normalizeEventCode(value) {
  const raw = text(value)
  const map = {
    入群: 'entry',
    转群: 'transfer',
    离群: 'exit',
    '离群/淘汰': 'exit',
    配种: 'insemination',
    '输精/配种': 'insemination',
    妊检: 'pregnancy_check',
    妊娠检查: 'pregnancy_check',
    产犊: 'calving',
    体尺测定: 'body_measurement',
    泌乳: 'milking',
    采奶: 'milking_session'
  }
  return map[raw] || raw
}

function text(value) {
  return String(value ?? '').trim()
}

function compactId(...parts) {
  const raw = parts.map(text).filter(Boolean).join('-')
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  if (cleaned.length <= 64) return cleaned
  let hash = 0
  for (let index = 0; index < raw.length; index += 1) {
    hash = (Math.imul(31, hash) + raw.charCodeAt(index)) | 0
  }
  return `${cleaned.slice(0, 47)}-${Math.abs(hash).toString(16)}`
}

function summarizeImportErrors(errors = []) {
  return errors
    .filter((item) => item.level === 'error')
    .slice(0, 8)
    .map((item) => `${item.rowIndex}:${item.code}:${item.message}`)
    .join('; ')
}

function pickStats(result) {
  return {
    totalRows: result.totalRows,
    validRows: result.validRows,
    errorRows: result.errorRows,
    duplicateRows: result.duplicateRows,
    committedRows: result.committedRows,
    skippedRows: result.skippedRows,
    targetRecordIds: result.targetRecordIds
  }
}

function formatResult(result) {
  const errors = result.errors.length ? `\n  ${result.errors.map(firstLines).join('\n  ')}` : ''
  return `[${result.status} | ${result.id} | ${result.durationMs}ms] dry=${JSON.stringify(result.dryRun)} commit=${JSON.stringify(result.commit)}${errors}`
}

function firstLines(value = '') {
  return String(value).split('\n').slice(0, 5).join('\n  ')
}

function printSummary(results) {
  const pass = results.filter((item) => item.status === 'PASS').length
  const fail = results.length - pass
  console.log('\n信息录入真实提交链路验收结果')
  console.log(`RunId: ${RUN_ID}`)
  console.log(`BaseUrl: ${BASE_URL}`)
  console.log(`通过: ${pass}/${results.length}`)
  console.log(`失败: ${fail}/${results.length}`)
  if (fail) {
    console.log('失败项:')
    results
      .filter((item) => item.status !== 'PASS')
      .forEach((item) => console.log(`- ${item.id}: ${firstLines(item.errors[0])}`))
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
})

