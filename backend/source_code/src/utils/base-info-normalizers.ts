export const PEN_CATEGORY_OPTIONS = [
  '犊牛舍',
  '育成舍',
  '育肥舍',
  '公牛舍',
  '配种舍',
  '妊娠舍',
  '产房',
  '泌乳舍',
  '干奶舍',
  '隔离舍',
  '挤奶厅',
  '饲喂中心',
  '备用舍'
] as const

export const PERSON_ROLE_OPTIONS = [
  '管理员',
  '兽医',
  '饲养员',
  '记录员',
  '育种员',
  '技术员'
] as const

export const DISEASE_CATEGORY_OPTIONS = [
  '传染病',
  '寄生虫病',
  '代谢病',
  '营养缺乏病',
  '中毒',
  '乳房疾病',
  '繁殖疾病',
  '外伤'
] as const

export const MEDICINE_CATEGORY_OPTIONS = [
  '抗生素',
  '驱虫药',
  '维生素',
  '疫苗',
  '消毒剂',
  '解热镇痛药',
  '钙磷补充剂',
  '激素类'
] as const

const GENERIC_CATEGORY_RE = /^(general|other|others|unknown|uncategorized|未分类|其他|其它)$/i

function text(...values: unknown[]) {
  return values.map((value) => String(value ?? '').trim()).find(Boolean) || ''
}

function classifyPenCategory(value: unknown) {
  const raw = text(value)
  if (!raw || GENERIC_CATEGORY_RE.test(raw)) return ''
  if ((PEN_CATEGORY_OPTIONS as readonly string[]).includes(raw)) return raw
  const lower = raw.toLowerCase()
  if (/挤奶|奶厅|milking|parlor/.test(lower)) return '挤奶厅'
  if (/tmr|饲喂|饲料|日粮|feeding|feed/.test(lower)) return '饲喂中心'
  if (/泌乳|lactating|lactation|milking_cow/.test(lower)) return '泌乳舍'
  if (/干奶|dry/.test(lower)) return '干奶舍'
  if (/犊牛|calf/.test(lower)) return '犊牛舍'
  if (/育成|后备|heifer/.test(lower)) return '育成舍'
  if (/育肥|fatten|finishing/.test(lower)) return '育肥舍'
  if (/公牛|种公|bull/.test(lower)) return '公牛舍'
  if (/配种|输精|breeding|mating|insemination/.test(lower)) return '配种舍'
  if (/妊娠|怀孕|pregnan|gestation/.test(lower)) return '妊娠舍'
  if (/产房|分娩|产犊|calving|delivery|maternity/.test(lower)) return '产房'
  if (/隔离|检疫|quarantine|isolation/.test(lower)) return '隔离舍'
  if (/备用|临时|backup|spare/.test(lower)) return '备用舍'
  return ''
}

export function normalizePenCategory(value: unknown, context: unknown = '') {
  const explicit = classifyPenCategory(value)
  if (explicit) return explicit
  const inferred = classifyPenCategory(context)
  return inferred || '备用舍'
}

function classifyDiseaseCategory(value: unknown) {
  const raw = text(value)
  if (!raw || GENERIC_CATEGORY_RE.test(raw)) return ''
  if ((DISEASE_CATEGORY_OPTIONS as readonly string[]).includes(raw)) return raw
  const lower = raw.toLowerCase()
  if (/乳房|乳腺|mastitis/.test(lower)) return '乳房疾病'
  if (/繁殖|子宫|胎衣|产后|流产|reproduction/.test(lower)) return '繁殖疾病'
  if (/中毒|毒|nitrite/.test(lower)) return '中毒'
  if (/维生素|缺乏|矿物|营养/.test(lower)) return '营养缺乏病'
  if (/酮病|瘤胃|积食|酸中毒|代谢|消化/.test(lower)) return '代谢病'
  if (/寄生|吸虫|肝蛭|螨|蜱|线虫|绦虫/.test(lower)) return '寄生虫病'
  if (/牛瘟|口蹄疫|结核|肺疫|布病|结节|传染|感染|疫|痢|炭疽|巴氏|沙门|病毒|细菌/.test(lower))
    return '传染病'
  if (/创伤|外伤|骨折|损伤|蹄病|蹄叶炎|腐蹄/.test(lower)) return '外伤'
  return ''
}

export function normalizeDiseaseCategory(value: unknown, context: unknown = '') {
  return classifyDiseaseCategory(context) || classifyDiseaseCategory(value) || '传染病'
}

function classifyMedicineCategory(value: unknown) {
  const raw = text(value)
  if (!raw || GENERIC_CATEGORY_RE.test(raw)) return ''
  if ((MEDICINE_CATEGORY_OPTIONS as readonly string[]).includes(raw)) return raw
  const lower = raw.toLowerCase()
  if (/疫苗|苗|vaccine/.test(lower)) return '疫苗'
  if (/消毒|过氧化氢|碘伏|戊二醛|alcohol|disinfect/.test(lower)) return '消毒剂'
  if (/伊维菌素|阿苯达唑|驱虫|寄生虫|ivermectin/.test(lower)) return '驱虫药'
  if (/青霉素|四环素|阿莫西林|头孢|庆大|抗生素|penicillin|tetracycline|amoxicillin/.test(lower))
    return '抗生素'
  if (/布洛芬|氟尼辛|退热|镇痛|解热|ibuprofen|flunixin/.test(lower)) return '解热镇痛药'
  if (/葡萄糖酸钙|钙|磷|镁|calcium|gluconate/.test(lower)) return '钙磷补充剂'
  if (/维生素|ad3e|营养|vitamin/.test(lower)) return '维生素'
  if (/前列腺素|促性腺|孕酮|激素|hormone|pgf/.test(lower)) return '激素类'
  return ''
}

export function normalizeMedicineCategory(value: unknown, context: unknown = '') {
  return classifyMedicineCategory(context) || classifyMedicineCategory(value) || '抗生素'
}

export function normalizeBaseInfoStatus(value: unknown, options: readonly string[] = []) {
  const raw = text(value)
  if (!raw) return ''
  const exact = options.find((item) => item === raw)
  if (exact) return exact
  const lower = raw.toLowerCase()
  if (/^(false|0|停用|禁用|disabled|inactive|closed|retired)$/.test(lower))
    return options.includes('停用') ? '停用' : raw
  if (/^(离职|resigned|left)$/.test(lower)) return options.includes('离职') ? '离职' : raw
  if (/维护|维修|maintenance|repair/.test(lower)) return options.includes('维护中') ? '维护中' : raw
  if (/^(true|1|正常|启用|active|enabled|enable|normal|online)$/.test(lower)) {
    if (options.includes('正常')) return '正常'
    if (options.includes('启用')) return '启用'
  }
  const byCase = options.find((item) => item.toLowerCase() === lower)
  return byCase || raw
}

function classifyPersonRole(value: unknown) {
  const raw = text(value)
  if (!raw) return ''
  if ((PERSON_ROLE_OPTIONS as readonly string[]).includes(raw)) return raw
  const lower = raw.toLowerCase()
  if (/管理员|管理|主管|负责人|经理|admin|manager|owner/.test(lower)) return '管理员'
  if (/兽医|健康|诊疗|防疫|vet|veterinarian|health/.test(lower)) return '兽医'
  if (/饲养|饲喂|奶厅|采奶|生产|feed|keeper|herdsman|milker|parlor/.test(lower)) return '饲养员'
  if (/记录|录入|数据|台账|审核|record|data|clerk|operator/.test(lower)) return '记录员'
  if (/育种|繁殖|配种|组学|科研|试验|breed|reproduction|omics|research/.test(lower)) return '育种员'
  if (/技术|维护|设备|传感器|实验|检测|tech|maintenance|lab|sensor/.test(lower)) return '技术员'
  return ''
}

export function normalizePersonRole(value: unknown, context: unknown = '') {
  return classifyPersonRole(value) || classifyPersonRole(context) || '技术员'
}
