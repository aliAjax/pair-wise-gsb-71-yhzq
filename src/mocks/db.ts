import type { Baseline, DifferenceRegion, IgnoreRule, Project, ScreenshotRun } from '@/types'
import { applyRulesToRun } from '@/utils/rules'

const STORAGE_KEY = 'visual-regression-platform-v1'

export interface Database {
  projects: Project[]
  runs: ScreenshotRun[]
  baselines: Baseline[]
  rules: IgnoreRule[]
  rulesVersion: number
}

const projects: Project[] = [
  { id: 'p-commerce', name: '零售交易工作台', code: 'RETAIL', owner: '沈宁', pageCount: 42 },
  { id: 'p-console', name: '云资源控制台', code: 'CLOUD', owner: '周航', pageCount: 67 },
  { id: 'p-growth', name: '增长运营平台', code: 'GROWTH', owner: '许薇', pageCount: 31 },
]

const makeRegions = (prefix: string, intensity: number): DifferenceRegion[] => [
  {
    id: `${prefix}-r1`,
    x: 11,
    y: 18,
    width: 28,
    height: 16,
    severity: 'high',
    pixels: Math.round(1840 * intensity),
    kind: 'layout',
    selector: '.order-summary-panel',
    ignored: false,
  },
  {
    id: `${prefix}-r2`,
    x: 54,
    y: 34,
    width: 19,
    height: 11,
    severity: 'medium',
    pixels: Math.round(720 * intensity),
    kind: 'color',
    selector: '.user-avatar img',
    ignored: false,
  },
  {
    id: `${prefix}-r3`,
    x: 72,
    y: 71,
    width: 18,
    height: 13,
    severity: 'low',
    pixels: Math.round(216 * intensity),
    kind: 'environment',
    selector: '[data-visual-ignore="relative-time"]',
    ignored: false,
  },
]

const runs: ScreenshotRun[] = [
  {
    id: 'run-1048',
    name: '结算页桌面端回归',
    projectId: 'p-commerce',
    page: '订单结算页',
    device: 'Desktop 1440',
    theme: 'light',
    build: 'release/6.18.0',
    status: 'pending',
    mismatchRate: 3.82,
    rawMismatchRate: 3.82,
    ruleVersion: 1,
    capturedAt: '2026-09-29T08:42:00+08:00',
    baselineVersion: 'v6.17.4-baseline',
    currentVersion: 'v6.18.0-rc2',
    regions: makeRegions('1048', 1),
  },
  {
    id: 'run-1047',
    name: '商品列表移动端回归',
    projectId: 'p-commerce',
    page: '商品列表页',
    device: 'iPhone 15',
    theme: 'light',
    build: 'release/6.18.0',
    status: 'pending',
    mismatchRate: 1.36,
    rawMismatchRate: 1.36,
    ruleVersion: 1,
    capturedAt: '2026-09-29T08:36:00+08:00',
    baselineVersion: 'v6.17.4-baseline',
    currentVersion: 'v6.18.0-rc2',
    regions: makeRegions('1047', 0.7),
  },
  {
    id: 'run-1046',
    name: '账单明细暗色主题回归',
    projectId: 'p-console',
    page: '账单明细',
    device: 'Desktop 1920',
    theme: 'dark',
    build: 'feature/billing-v3',
    status: 'approved',
    mismatchRate: 5.14,
    rawMismatchRate: 5.14,
    ruleVersion: 1,
    capturedAt: '2026-09-28T17:20:00+08:00',
    baselineVersion: 'v5.9.1-baseline',
    currentVersion: 'billing-v3.7',
    regions: makeRegions('1046', 1.4),
    review: {
      category: 'design-change',
      decision: 'approved',
      reviewer: '林默',
      reason: '新计费周期列按需求上线，已核对设计稿和验收单。',
      reviewedAt: '2026-09-28T18:02:00+08:00',
      ruleVersion: 1,
    },
  },
  {
    id: 'run-1045',
    name: '活动配置页移动端回归',
    projectId: 'p-growth',
    page: '活动配置',
    device: 'Android Pixel 8',
    theme: 'light',
    build: 'feature/campaign-editor',
    status: 'rejected',
    mismatchRate: 10.73,
    rawMismatchRate: 10.73,
    ruleVersion: 1,
    capturedAt: '2026-09-28T15:11:00+08:00',
    baselineVersion: 'v2.4.0-baseline',
    currentVersion: 'campaign-v2',
    regions: makeRegions('1045', 2.2),
    review: {
      category: 'render-error',
      decision: 'rejected',
      reviewer: '梁琪',
      reason: '主操作区被侧栏遮挡，属于阻断性渲染异常。',
      reviewedAt: '2026-09-28T15:44:00+08:00',
      ruleVersion: 1,
    },
  },
  {
    id: 'run-1044',
    name: '资源详情页桌面端回归',
    projectId: 'p-console',
    page: '资源详情',
    device: 'Desktop 1440',
    theme: 'light',
    build: 'release/5.10.0',
    status: 'pending',
    mismatchRate: 2.08,
    rawMismatchRate: 2.08,
    ruleVersion: 1,
    capturedAt: '2026-09-28T13:30:00+08:00',
    baselineVersion: 'v5.9.1-baseline',
    currentVersion: 'v5.10.0-rc1',
    regions: makeRegions('1044', 0.9),
  },
  {
    id: 'run-1043',
    name: '首页推荐位回归',
    projectId: 'p-growth',
    page: '运营首页',
    device: 'Desktop 1440',
    theme: 'light',
    build: 'release/2.6.0',
    status: 'pending',
    mismatchRate: 0.94,
    rawMismatchRate: 0.94,
    ruleVersion: 1,
    capturedAt: '2026-09-27T19:15:00+08:00',
    baselineVersion: 'v2.5.3-baseline',
    currentVersion: 'v2.6.0-rc3',
    regions: makeRegions('1043', 0.5),
  },
]

const baselines: Baseline[] = [
  {
    id: 'base-commerce-checkout',
    projectId: 'p-commerce',
    page: '订单结算页',
    device: 'Desktop 1440',
    theme: 'light',
    version: 'v6.17.4-baseline',
    approvedBy: '林默',
    reason: '合入优惠券区域改版，设计稿版本 DS-318。',
    approvedAt: '2026-09-19T11:30:00+08:00',
    runId: 'run-998',
    active: true,
    ruleVersion: 1,
  },
  {
    id: 'base-console-billing',
    projectId: 'p-console',
    page: '账单明细',
    device: 'Desktop 1920',
    theme: 'dark',
    version: 'v5.9.1-baseline',
    approvedBy: '周航',
    reason: '升级账单表格主题变量，无业务布局变化。',
    approvedAt: '2026-09-12T14:05:00+08:00',
    runId: 'run-961',
    active: true,
    ruleVersion: 1,
  },
  {
    id: 'base-growth-campaign',
    projectId: 'p-growth',
    page: '活动配置',
    device: 'Android Pixel 8',
    theme: 'light',
    version: 'v2.4.0-baseline',
    approvedBy: '许薇',
    reason: '第一版移动端活动配置工作台基线。',
    approvedAt: '2026-08-28T10:10:00+08:00',
    runId: 'run-902',
    active: false,
    ruleVersion: 1,
  },
  {
    id: 'base-commerce-list',
    projectId: 'p-commerce',
    page: '商品列表页',
    device: 'iPhone 15',
    theme: 'light',
    version: 'v6.17.4-baseline',
    approvedBy: '沈宁',
    reason: '商品卡信息密度调整完成，已通过交互验收。',
    approvedAt: '2026-09-20T16:40:00+08:00',
    runId: 'run-1002',
    active: true,
    ruleVersion: 1,
  },
]

const rules: IgnoreRule[] = [
  {
    id: 'rule-time',
    name: '动态时间区域',
    projectId: 'all',
    selector: '[data-visual-ignore="relative-time"]',
    pagePattern: '*',
    devicePattern: '*',
    maxDelta: 12,
    enabled: true,
    createdAt: '2026-09-02T09:00:00+08:00',
  },
  {
    id: 'rule-avatar',
    name: '用户头像随机图',
    projectId: 'p-commerce',
    selector: '.user-avatar img',
    pagePattern: '订单*',
    devicePattern: '*',
    maxDelta: 20,
    enabled: true,
    createdAt: '2026-09-05T13:25:00+08:00',
  },
  {
    id: 'rule-commerce-time',
    name: '交易时间戳严格忽略',
    projectId: 'p-commerce',
    selector: '[data-visual-ignore="relative-time"]',
    pagePattern: '*',
    devicePattern: 'Desktop*',
    maxDelta: 6,
    enabled: true,
    createdAt: '2026-09-10T10:00:00+08:00',
  },
  {
    id: 'rule-watermark',
    name: '测试环境水印',
    projectId: 'all',
    selector: '.environment-watermark',
    pagePattern: '*',
    devicePattern: '*',
    maxDelta: 5,
    enabled: true,
    createdAt: '2026-08-21T11:08:00+08:00',
  },
  {
    id: 'rule-animation',
    name: '旧版骨架屏动画',
    projectId: 'p-console',
    selector: '.skeleton-shimmer',
    pagePattern: '*',
    devicePattern: 'iPhone*',
    maxDelta: 8,
    enabled: false,
    createdAt: '2026-08-16T17:12:00+08:00',
  },
]

const seed = (): Database => ({ projects, runs, baselines, rules, rulesVersion: 1 })

/** 未审批运行按当前规则重算差异区域与差异率，并标记所依据的规则版本。 */
export const normalizePendingRuns = (db: Database): void => {
  db.runs.forEach((run) => {
    if (run.status !== 'pending') return
    applyRulesToRun(run, db.rules)
    run.ruleVersion = db.rulesVersion
  })
}

/**
 * 旧数据迁移：规则缺少作用域记录时按全部项目、全部页面、全部设备回填；
 * 运行补充原始差异率与规则版本；区域缺少选择器时按命中规则回填。
 */
const migrateDb = (db: Database): boolean => {
  let changed = false
  if (typeof db.rulesVersion !== 'number') {
    db.rulesVersion = 1
    changed = true
  }
  db.rules.forEach((rule) => {
    if (!rule.projectId) {
      rule.projectId = 'all'
      changed = true
    }
    if (!rule.pagePattern) {
      rule.pagePattern = '*'
      changed = true
    }
    if (!rule.devicePattern) {
      rule.devicePattern = '*'
      changed = true
    }
  })
  db.runs.forEach((run) => {
    if (typeof run.rawMismatchRate !== 'number') {
      run.rawMismatchRate = run.mismatchRate
      changed = true
    }
    if (typeof run.ruleVersion !== 'number') {
      run.ruleVersion = db.rulesVersion
      changed = true
    }
    run.regions.forEach((region) => {
      if (!region.selector && region.ruleId) {
        const source = db.rules.find((rule) => rule.id === region.ruleId)
        if (source) {
          region.selector = source.selector
          changed = true
        }
      }
    })
  })
  db.baselines.forEach((baseline) => {
    if (typeof baseline.ruleVersion !== 'number') {
      baseline.ruleVersion = db.rulesVersion
      changed = true
    }
  })
  return changed
}

export const readDb = (): Database => {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const initial = seed()
    normalizePendingRuns(initial)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial))
    return initial
  }
  try {
    const parsed = JSON.parse(raw) as Database
    if (migrateDb(parsed)) {
      normalizePendingRuns(parsed)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed))
    }
    return parsed
  } catch {
    const initial = seed()
    normalizePendingRuns(initial)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial))
    return initial
  }
}

export const writeDb = (db: Database): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
}
