import type { DifferenceRegion, IgnoreRule, ScreenshotRun } from '@/types'

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 通配符匹配：仅支持 `*`，`*` 或空串匹配一切。
 */
export const matchPattern = (pattern: string | undefined, value: string): boolean => {
  const trimmed = (pattern ?? '').trim()
  if (!trimmed || trimmed === '*') return true
  const regex = new RegExp(`^${trimmed.split('*').map(escapeRegExp).join('.*')}$`)
  return regex.test(value)
}

/**
 * 规则是否命中运行的作用域：项目（all 表示全部）、页面、设备三个维度。
 */
export const ruleHitsRun = (
  rule: IgnoreRule,
  run: Pick<ScreenshotRun, 'projectId' | 'page' | 'device'>,
): boolean =>
  (rule.projectId === 'all' || rule.projectId === run.projectId) &&
  matchPattern(rule.pagePattern, run.page) &&
  matchPattern(rule.devicePattern, run.device)

const patternWeight = (pattern: string | undefined): number => {
  const trimmed = (pattern ?? '').trim()
  return trimmed === '*' ? 0 : trimmed.length
}

/** 作用范围具体度：命中的非通配维度数量。 */
const scopeScore = (rule: IgnoreRule): number =>
  (rule.projectId === 'all' ? 0 : 1) +
  (patternWeight(rule.pagePattern) > 0 ? 1 : 0) +
  (patternWeight(rule.devicePattern) > 0 ? 1 : 0)

/** 同维度数量时，用非通配模式的总长度区分具体度。 */
const scopeLength = (rule: IgnoreRule): number =>
  (rule.projectId === 'all' ? 0 : rule.projectId.length) +
  patternWeight(rule.pagePattern) +
  patternWeight(rule.devicePattern)

/**
 * 命中同一区域时的优先级：作用范围更具体的优先；同样具体取更严色差（maxDelta 更小）；
 * 再相同按创建时间先后保证结果稳定。
 */
export const compareRulePriority = (a: IgnoreRule, b: IgnoreRule): number => {
  const scoreDiff = scopeScore(b) - scopeScore(a)
  if (scoreDiff !== 0) return scoreDiff
  const lengthDiff = scopeLength(b) - scopeLength(a)
  if (lengthDiff !== 0) return lengthDiff
  if (a.maxDelta !== b.maxDelta) return a.maxDelta - b.maxDelta
  return a.createdAt.localeCompare(b.createdAt)
}

/** 区域被哪条启用规则忽略：选择器一致且规则作用于该运行。 */
export const pickRegionRule = (
  region: DifferenceRegion,
  scopedRules: IgnoreRule[],
): IgnoreRule | undefined => {
  const selector = region.selector?.trim()
  if (!selector) return undefined
  const hits = scopedRules.filter((rule) => rule.enabled && rule.selector.trim() === selector)
  return hits.sort(compareRulePriority)[0]
}

/**
 * 按当前规则重算运行的差异区域与差异率：
 * 被规则忽略的区域不计入差异率，差异率 = 原始差异率 × 待判定像素占比。
 */
export const applyRulesToRun = (run: ScreenshotRun, rules: IgnoreRule[]): ScreenshotRun => {
  const scopedRules = rules.filter((rule) => ruleHitsRun(rule, run))
  run.regions.forEach((region) => {
    const winner = pickRegionRule(region, scopedRules)
    region.ignored = Boolean(winner)
    region.ruleId = winner?.id
  })
  const totalPixels = run.regions.reduce((sum, region) => sum + region.pixels, 0)
  const activePixels = run.regions
    .filter((region) => !region.ignored)
    .reduce((sum, region) => sum + region.pixels, 0)
  run.mismatchRate =
    totalPixels > 0
      ? Number(((run.rawMismatchRate * activePixels) / totalPixels).toFixed(2))
      : run.rawMismatchRate
  return run
}
