import type { DifferenceRegion, IgnoreRule } from '@/types'

/** 每 1000 个差异像素折算 1% 差异率 */
export const PIXELS_PER_PERCENT = 1000

export interface RunScope {
  projectId: string
  page: string
  device: string
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 支持 `*` 通配的作用域匹配，空串与 `*` 视为全部命中 */
export const globMatch = (pattern: string, value: string): boolean => {
  const trimmed = pattern.trim()
  if (!trimmed || trimmed === '*') return true
  const source = trimmed.split('*').map(escapeRegExp).join('.*')
  return new RegExp(`^${source}$`).test(value)
}

/** 作用范围具体度：项目、页面、设备每明确一项计一分 */
export const ruleSpecificity = (rule: IgnoreRule): number =>
  (rule.projectId && rule.projectId !== 'all' ? 1 : 0) +
  (rule.pagePattern.trim() && rule.pagePattern.trim() !== '*' ? 1 : 0) +
  (rule.devicePattern.trim() && rule.devicePattern.trim() !== '*' ? 1 : 0)

const ruleMatchesRun = (rule: IgnoreRule, run: RunScope): boolean =>
  (rule.projectId === 'all' || rule.projectId === run.projectId) &&
  globMatch(rule.pagePattern, run.page) &&
  globMatch(rule.devicePattern, run.device)

/**
 * 解析命中某个差异区域的规则：
 * 1. 作用范围（项目 / 页面 / 设备）与选择器同时命中，且区域色差未超过规则上限；
 * 2. 多条命中时作用范围更具体的优先；
 * 3. 同样具体时取色差上限更严（更小）的一条，再按创建时间兜底保证稳定。
 */
export const resolveRegionRule = (
  region: DifferenceRegion,
  run: RunScope,
  rules: IgnoreRule[],
): IgnoreRule | undefined => {
  if (!region.selector) return undefined
  const candidates = rules.filter(
    (rule) =>
      rule.enabled &&
      rule.selector === region.selector &&
      ruleMatchesRun(rule, run) &&
      (region.delta ?? 0) <= rule.maxDelta,
  )
  return [...candidates].sort(
    (a, b) =>
      ruleSpecificity(b) - ruleSpecificity(a) ||
      a.maxDelta - b.maxDelta ||
      a.createdAt.localeCompare(b.createdAt),
  )[0]
}

/** 差异率只统计未忽略区域，被规则折叠的区域不再计入 */
export const computeMismatchRate = (regions: DifferenceRegion[]): number =>
  Math.round(
    (regions
      .filter((region) => !region.ignored)
      .reduce((total, region) => total + region.pixels, 0) /
      PIXELS_PER_PERCENT) *
      100,
  ) / 100

export const evaluateRunRegions = (
  run: RunScope & { regions: DifferenceRegion[] },
  rules: IgnoreRule[],
): DifferenceRegion[] =>
  run.regions.map((region) => {
    const rule = resolveRegionRule(region, run, rules)
    return { ...region, ignored: Boolean(rule), ruleId: rule?.id }
  })

export const evaluateRun = (
  run: RunScope & { regions: DifferenceRegion[] },
  rules: IgnoreRule[],
): { regions: DifferenceRegion[]; mismatchRate: number } => {
  const regions = evaluateRunRegions(run, rules)
  return { regions, mismatchRate: computeMismatchRate(regions) }
}
