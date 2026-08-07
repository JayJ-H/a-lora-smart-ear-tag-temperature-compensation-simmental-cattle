import fs from 'node:fs'

const templateSource = fs.readFileSync('src/services/import-templates.ts', 'utf8')
const adapterSource = fs.readFileSync('src/services/import-adapter.ts', 'utf8')
const entrySource = fs.readFileSync('src/views/data-import/information/index.vue', 'utf8')
const editSource = fs.readFileSync('src/views/data-edit/information/index.vue', 'utf8')

const checks = [
  {
    name: '系谱模板包含产犊日期',
    ok: /column\(\s*'parity_calving_date'[\s\S]*?'产犊日期'/.test(templateSource)
  },
  {
    name: '系谱模板包含犊牛号',
    ok: /column\(\s*'calf_number'[\s\S]*?'犊牛号'/.test(templateSource)
  },
  {
    name: '系谱提交同步产犊事件',
    ok: /commitPedigreeCalvingEvent/.test(adapterSource) && /reproduction_action:\s*'calving'/.test(adapterSource)
  },
  {
    name: '系谱多胎犊牛号支持分隔',
    ok: /function splitCalfNumbers/.test(adapterSource) && /同胎犊牛/.test(adapterSource)
  },
  {
    name: '业务事件导入发生日期为 date',
    ok:
      !/column\('occurred_at', '发生时间', 'occurred_at', 'datetime'/.test(templateSource) &&
      /column\('occurred_at', '发生日期', 'occurred_at', 'date'/.test(templateSource)
  },
  {
    name: '奶厅和表型模板使用日期加班次',
    ok:
      /column\('measured_at', '挤奶日期', 'measured_at', 'date'/.test(templateSource) &&
      /column\('observed_at', '采集日期', 'observed_at', 'date'/.test(templateSource)
  },
  {
    name: '设备人工导入测量日期为 date',
    ok: /column\('measured_at', '测量日期', 'measured_at', 'date'/.test(templateSource)
  },
  {
    name: '信息录入发生时间控件为 date',
    ok: /v-model="singleForm\.occurredAt"[\s\S]{0,120}type="date"/.test(entrySource)
  },
  {
    name: '信息修改发生时间控件为 date',
    ok: /v-model="editForm\.occurredAt"[\s\S]{0,120}type="date"/.test(editSource)
  }
]

const failed = checks.filter((item) => !item.ok)
console.log(JSON.stringify({ ok: failed.length === 0, checks, failed }, null, 2))
if (failed.length) process.exit(1)
