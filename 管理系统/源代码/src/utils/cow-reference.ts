export interface CowReferenceContext<TCow extends Record<string, any> = Record<string, any>> {
  byId: Map<string, TCow>
  byNumber: Map<string, TCow>
  byEarTag: Map<string, TCow>
  byIdentifier: Map<string, TCow>
}

export interface ResolvedCowReference<TCow extends Record<string, any> = Record<string, any>> {
  cowId: string
  cowNumber: string
  cowName: string
  cow?: TCow
  resolved: boolean
  sourceKey: string
  originalCowId: string
  originalCowNumber: string
  resolvedBy?: string
  identifierType?: string
}

export function buildCowReferenceContext<TCow extends Record<string, any>>(
  cows: TCow[] = [],
  identifiers: Record<string, any>[] = []
): CowReferenceContext<TCow> {
  const byId = new Map<string, TCow>()
  const byNumber = new Map<string, TCow>()
  const byEarTag = new Map<string, TCow>()
  const byIdentifier = new Map<string, TCow>()

  cows.forEach((cow) => {
    const id = text(cow.id ?? cow.cowId ?? cow.cow_id ?? cow.animalId ?? cow.animal_id)
    const number = text(
      cow.cowNumber ?? cow.cow_number ?? cow.animalNumber ?? cow.animal_number ?? cow.number
    )
    const earTag = text(cow.earTagNumber ?? cow.ear_tag_number ?? cow.earTag ?? cow.ear_tag)
    if (id) byId.set(id, cow)
    if (number) byNumber.set(number, cow)
    if (earTag) byEarTag.set(earTag, cow)
    ;[
      number,
      earTag,
      text(cow.electronicTag ?? cow.electronic_tag),
      text(cow.rfid ?? cow.rfidNo ?? cow.rfid_no)
    ]
      .filter(Boolean)
      .forEach((value) => byIdentifier.set(value, cow))
  })

  identifiers.forEach((identifier) => {
    const value = text(
      identifier.identifierValue ??
        identifier.identifier_value ??
        identifier.value ??
        identifier.number
    )
    if (!value) return
    const animalId = text(
      identifier.animalId ?? identifier.animal_id ?? identifier.cowId ?? identifier.cow_id
    )
    const cow = byId.get(animalId)
    if (!cow) return
    const type = text(
      identifier.identifierType ?? identifier.identifier_type ?? identifier.type
    ).toLowerCase()
    byIdentifier.set(value, cow)
    if (
      ['main', 'primary', 'cow_number', 'animal_number', 'number', '主编号', '牛号'].includes(type)
    )
      byNumber.set(value, cow)
    if (['耳标', 'ear_tag_number', '电子耳标', '耳标', '耳号', 'rfid'].includes(type))
      byEarTag.set(value, cow)
  })

  return { byId, byNumber, byEarTag, byIdentifier }
}

export function resolveCowRef<TCow extends Record<string, any>>(
  row: Record<string, any> = {},
  context: CowReferenceContext<TCow>
): ResolvedCowReference<TCow> {
  const originalCowId = text(row.cowId ?? row.cow_id ?? row.animalId ?? row.animal_id)
  const originalCowNumber = text(
    row.cowNumber ?? row.cow_number ?? row.animalNumber ?? row.animal_number ?? row.number
  )
  const originalEarTag = text(row.earTagNumber ?? row.ear_tag_number ?? row.earTag ?? row.ear_tag)
  const originalIdentifier = text(
    row.identifierValue ??
      row.identifier_value ??
      row.identifier ??
      row.externalNumber ??
      row.external_number
  )

  const match = [
    { cow: context.byId.get(originalCowId), resolvedBy: 'cowId', identifierType: 'id' },
    {
      cow: context.byNumber.get(originalCowNumber),
      resolvedBy: 'cowNumber',
      identifierType: 'number'
    },
    { cow: context.byEarTag.get(originalEarTag), resolvedBy: 'earTag', identifierType: '耳标' },
    {
      cow: context.byIdentifier.get(originalIdentifier),
      resolvedBy: 'identifier',
      identifierType: text(row.identifierType ?? row.identifier_type)
    }
  ].find((item) => item.cow)
  const cow = match?.cow

  if (cow) {
    const cowId =
      text(cow.id ?? cow.cowId ?? cow.cow_id ?? cow.animalId ?? cow.animal_id) || originalCowId
    const cowNumber =
      text(
        cow.cowNumber ?? cow.cow_number ?? cow.animalNumber ?? cow.animal_number ?? cow.number
      ) || originalCowNumber
    return {
      cowId,
      cowNumber,
      cowName: text(cow.cowName ?? cow.name ?? cow.nameCn ?? cow.name_cn),
      cow,
      resolved: true,
      sourceKey: cowId || cowNumber,
      originalCowId,
      originalCowNumber,
      resolvedBy: match?.resolvedBy,
      identifierType: match?.identifierType
    }
  }

  const fallback =
    originalCowId ||
    originalCowNumber ||
    originalEarTag ||
    originalIdentifier ||
    sourceRecordKey(row)
  return {
    cowId: originalCowId,
    cowNumber: originalCowNumber,
    cowName: text(row.cowName ?? row.cow_name),
    resolved: false,
    sourceKey: fallback,
    originalCowId,
    originalCowNumber
  }
}

export function cowCalculationKey(row: Record<string, any>, context?: CowReferenceContext): string {
  if (context) return resolveCowRef(row, context).sourceKey
  return (
    text(row.cowId ?? row.cow_id) || text(row.cowNumber ?? row.cow_number) || sourceRecordKey(row)
  )
}

export function matchesCowRef(row: Record<string, any>, cow: Record<string, any>): boolean {
  const rowId = text(row.cowId ?? row.cow_id ?? row.animalId ?? row.animal_id)
  const rowNumber = text(row.cowNumber ?? row.cow_number ?? row.animalNumber ?? row.animal_number)
  const cowId = text(cow.id ?? cow.cowId ?? cow.cow_id ?? cow.animalId ?? cow.animal_id)
  const cowNumber = text(
    cow.cowNumber ?? cow.cow_number ?? cow.animalNumber ?? cow.animal_number ?? cow.number
  )
  return (
    (!!rowId && !!cowId && rowId === cowId) ||
    (!!rowNumber && !!cowNumber && rowNumber === cowNumber)
  )
}

export function sourceRecordKey(row: Record<string, any>): string {
  return (
    [
      text(row.sourceTable ?? row.source_table),
      text(row.sourceRecordId ?? row.source_record_id ?? row.id)
    ]
      .filter(Boolean)
      .join(':') || `unresolved:${JSON.stringify(row).slice(0, 80)}`
  )
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}
