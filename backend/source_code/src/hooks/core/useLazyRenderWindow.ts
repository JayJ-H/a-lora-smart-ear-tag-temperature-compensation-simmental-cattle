import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  unref,
  watch,
  type ComputedRef,
  type Ref
} from 'vue'

type MaybeRef<T> = T | Ref<T> | ComputedRef<T>

interface LazyRenderOptions {
  initialCount: MaybeRef<number>
  batchSize?: MaybeRef<number>
  bottomThreshold?: number
  mode?: 'append' | 'fixed-window'
}

const normalizeCount = (value: unknown, fallback: number) => {
  const count = Math.floor(Number(value))
  return Number.isFinite(count) && count > 0 ? count : fallback
}

const getScrollTarget = (input: Event | HTMLElement) => {
  if (input instanceof HTMLElement) return input
  if (input.currentTarget instanceof HTMLElement) return input.currentTarget
  return input.target instanceof HTMLElement ? input.target : null
}

export function useLazyRenderWindow<T>(source: MaybeRef<T[]>, options: LazyRenderOptions) {
  const bottomThreshold = options.bottomThreshold ?? 64
  const mode = options.mode ?? 'append'
  const visibleCount = ref(normalizeCount(unref(options.initialCount), 10))
  const startIndex = ref(0)

  const sourceItems = computed(() => unref(source) || [])
  const totalCount = computed(() => sourceItems.value.length)
  const currentInitialCount = computed(() => normalizeCount(unref(options.initialCount), 10))
  const currentBatchSize = computed(() =>
    normalizeCount(unref(options.batchSize ?? options.initialCount), currentInitialCount.value)
  )
  const windowSize = computed(() => Math.min(totalCount.value, currentInitialCount.value))
  const visibleItems = computed(() => {
    if (mode === 'fixed-window') {
      return sourceItems.value.slice(startIndex.value, startIndex.value + windowSize.value)
    }
    return sourceItems.value.slice(0, visibleCount.value)
  })
  const hasMore = computed(() =>
    mode === 'fixed-window'
      ? startIndex.value + windowSize.value < totalCount.value
      : visibleCount.value < totalCount.value
  )
  const hasPrevious = computed(() => mode === 'fixed-window' && startIndex.value > 0)
  const endIndex = computed(() => startIndex.value + visibleItems.value.length)

  function resetVisibleCount() {
    startIndex.value = 0
    visibleCount.value = Math.min(totalCount.value, currentInitialCount.value)
  }

  function loadMore(count = currentBatchSize.value) {
    if (!hasMore.value) return
    if (mode === 'fixed-window') {
      startIndex.value = Math.min(
        Math.max(totalCount.value - windowSize.value, 0),
        startIndex.value + normalizeCount(count, currentBatchSize.value)
      )
      return
    }
    visibleCount.value = Math.min(
      totalCount.value,
      visibleCount.value + normalizeCount(count, currentBatchSize.value)
    )
  }

  function loadPrevious(count = currentBatchSize.value) {
    if (mode !== 'fixed-window' || !hasPrevious.value) return
    startIndex.value = Math.max(0, startIndex.value - normalizeCount(count, currentBatchSize.value))
  }

  function handleScroll(input: Event | HTMLElement) {
    const target = getScrollTarget(input)
    if (!target) return
    if (mode === 'fixed-window') {
      if (target.scrollTop <= bottomThreshold) {
        const before = startIndex.value
        loadPrevious()
        if (startIndex.value !== before) {
          target.scrollTop = 0
        }
        return
      }
      if (target.scrollTop + target.clientHeight >= target.scrollHeight - bottomThreshold) {
        const before = startIndex.value
        loadMore()
        if (startIndex.value !== before && target.scrollHeight > target.clientHeight) {
          target.scrollTop = 0
        }
      }
      return
    }
    if (target.scrollTop + target.clientHeight >= target.scrollHeight - bottomThreshold) {
      loadMore()
    }
  }

  function handleWheel(event: WheelEvent) {
    if (mode === 'fixed-window') {
      const target = getScrollTarget(event)
      const canScroll = !!target && target.scrollHeight > target.clientHeight + 1
      if (event.deltaY > 0) {
        if (
          canScroll &&
          target!.scrollTop + target!.clientHeight < target!.scrollHeight - bottomThreshold
        ) {
          return
        }
        loadMore()
      } else if (event.deltaY < 0) {
        if (canScroll && target!.scrollTop > bottomThreshold) return
        const before = startIndex.value
        loadPrevious()
        if (target && startIndex.value !== before) target.scrollTop = 0
      }
      return
    }
    if (event.deltaY > 0) loadMore()
  }

  function jumpToIndex(index: number) {
    if (mode !== 'fixed-window') return
    const nextIndex = Math.floor(Number(index))
    if (!Number.isFinite(nextIndex)) return
    startIndex.value = Math.min(
      Math.max(totalCount.value - windowSize.value, 0),
      Math.max(0, nextIndex)
    )
  }

  watch([sourceItems, currentInitialCount], resetVisibleCount, { immediate: true })

  return {
    visibleCount,
    startIndex,
    endIndex,
    visibleItems,
    totalCount,
    hasMore,
    hasPrevious,
    resetVisibleCount,
    loadMore,
    loadPrevious,
    jumpToIndex,
    handleScroll,
    handleWheel
  }
}

interface LazyGridRenderOptions {
  rowCount?: MaybeRef<number>
  minItemWidth: MaybeRef<number>
  gap?: MaybeRef<number>
  fallbackColumns?: MaybeRef<number>
  bottomThreshold?: number
  mode?: 'append' | 'fixed-window'
}

export function useLazyGridRenderWindow<T>(source: MaybeRef<T[]>, options: LazyGridRenderOptions) {
  const containerRef = ref<HTMLElement | null>(null)
  const containerWidth = ref(0)
  let resizeObserver: ResizeObserver | null = null

  const gap = computed(() => normalizeCount(unref(options.gap ?? 16), 16))
  const minItemWidth = computed(() => normalizeCount(unref(options.minItemWidth), 260))
  const rowCount = computed(() => normalizeCount(unref(options.rowCount ?? 2), 2))
  const fallbackColumns = computed(() => normalizeCount(unref(options.fallbackColumns ?? 3), 3))
  const columnCount = computed(() => {
    if (!containerWidth.value) return fallbackColumns.value
    return Math.max(
      1,
      Math.floor((containerWidth.value + gap.value) / (minItemWidth.value + gap.value))
    )
  })
  const initialCount = computed(() => columnCount.value * rowCount.value)

  const lazyWindow = useLazyRenderWindow(source, {
    initialCount,
    batchSize: initialCount,
    bottomThreshold: options.bottomThreshold,
    mode: options.mode
  })

  const observeContainer = async () => {
    await nextTick()
    resizeObserver?.disconnect()
    resizeObserver = null
    const el = containerRef.value
    if (!el) return
    containerWidth.value = el.clientWidth
    resizeObserver = new ResizeObserver((entries) => {
      containerWidth.value = entries[0]?.contentRect.width || el.clientWidth
    })
    resizeObserver.observe(el)
  }

  watch(containerRef, observeContainer)
  onMounted(observeContainer)
  onBeforeUnmount(() => resizeObserver?.disconnect())

  return {
    ...lazyWindow,
    containerRef,
    containerWidth,
    columnCount
  }
}
