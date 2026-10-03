import axios, { type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { normalizePendingRuns, readDb, writeDb, type Database } from '@/mocks/db'
import { applyRulesToRun } from '@/utils/rules'
import type {
  Baseline,
  DashboardData,
  IgnoreRule,
  ImportRunPayload,
  Project,
  ReviewPayload,
  RulesSnapshot,
  RunFilters,
  ScreenshotRun,
} from '@/types'

export class RuleConflictError extends Error {
  latestVersion: number

  constructor(latestVersion: number) {
    super('规则已被其他窗口修改，本次调整已保留为草稿，请核对最新规则后重新提交')
    this.name = 'RuleConflictError'
    this.latestVersion = latestVersion
  }
}

export const api = axios.create({
  baseURL: '/mock-api',
  timeout: 8000,
  headers: { 'Content-Type': 'application/json' },
})

const respond = <T>(config: InternalAxiosRequestConfig, data: T, status = 200) => ({
  data,
  status,
  statusText: status === 200 ? 'OK' : 'Created',
  headers: {},
  config,
})

const parseBody = <T>(config: InternalAxiosRequestConfig): T => {
  if (typeof config.data === 'string') return JSON.parse(config.data) as T
  return config.data as T
}

/** 规则集版本乐观锁：提交基于旧版本时拒绝，由调用方保留草稿。 */
const assertRuleBaseVersion = (db: Database, baseVersion?: number): void => {
  if (typeof baseVersion === 'number' && baseVersion !== db.rulesVersion) {
    throw new RuleConflictError(db.rulesVersion)
  }
}

/** 规则一旦改动：版本递增，未审批运行立即重算差异区域与差异率。 */
const applyRuleChange = (db: Database): void => {
  db.rulesVersion += 1
  normalizePendingRuns(db)
}

const mockAdapter: AxiosAdapter = async (config) => {
  await new Promise((resolve) => window.setTimeout(resolve, 180))
  const db = readDb()
  const method = (config.method ?? 'get').toLowerCase()
  const path = config.url ?? ''

  if (method === 'get' && path === '/projects') {
    return respond<Project[]>(config, db.projects)
  }

  if (method === 'get' && path === '/dashboard') {
    const dashboard: DashboardData = {
      pendingReview: db.runs.filter((run) => run.status === 'pending').length,
      approvedToday: db.runs.filter(
        (run) => run.review?.decision === 'approved' && run.review.reviewedAt.startsWith('2026-09-29'),
      ).length,
      highRisk: db.runs.filter((run) => run.mismatchRate >= 5 && run.status !== 'merged').length,
      activeBaselines: db.baselines.filter((baseline) => baseline.active).length,
      trend: [
        { date: '09-23', total: 36, failed: 7 },
        { date: '09-24', total: 42, failed: 4 },
        { date: '09-25', total: 39, failed: 9 },
        { date: '09-26', total: 47, failed: 6 },
        { date: '09-27', total: 44, failed: 5 },
        { date: '09-28', total: 52, failed: 11 },
        { date: '09-29', total: 29, failed: 8 },
      ],
    }
    return respond(config, dashboard)
  }

  if (method === 'get' && path === '/runs') {
    const filters = (config.params ?? {}) as RunFilters
    const keyword = filters.keyword?.trim().toLowerCase()
    const data = db.runs.filter((run) => {
      return (
        (!filters.projectId || run.projectId === filters.projectId) &&
        (!filters.page || run.page === filters.page) &&
        (!filters.device || run.device === filters.device) &&
        (!filters.theme || run.theme === filters.theme) &&
        (!filters.build || run.build === filters.build) &&
        (!filters.status || run.status === filters.status) &&
        (!keyword ||
          run.name.toLowerCase().includes(keyword) ||
          run.page.toLowerCase().includes(keyword) ||
          run.id.toLowerCase().includes(keyword))
      )
    })
    return respond(config, data)
  }

  const runMatch = path.match(/^\/runs\/([^/]+)$/)
  if (method === 'get' && runMatch) {
    const run = db.runs.find((item) => item.id === runMatch[1])
    if (!run) throw new Error('运行记录不存在')
    return respond(config, run)
  }

  const reviewMatch = path.match(/^\/runs\/([^/]+)\/review$/)
  if (method === 'patch' && reviewMatch) {
    const payload = parseBody<ReviewPayload>(config)
    const run = db.runs.find((item) => item.id === reviewMatch[1])
    if (!run) throw new Error('运行记录不存在')
    // 审批开始时锁定所依据的规则版本：评审期间规则被改动则要求重新确认
    if (typeof payload.ruleVersion === 'number' && payload.ruleVersion !== run.ruleVersion) {
      throw new Error('规则版本已更新，差异区域与差异率已按最新规则重算，请确认后再提交审批')
    }
    run.status = payload.decision
    run.review = {
      category: payload.category,
      decision: payload.decision,
      reviewer: payload.reviewer,
      reason: payload.reason,
      reviewedAt: new Date().toISOString(),
      ruleVersion: run.ruleVersion,
    }
    if (payload.decision === 'approved') {
      const baseline = db.baselines.find(
        (item) =>
          item.projectId === run.projectId &&
          item.page === run.page &&
          item.device === run.device &&
          item.theme === run.theme &&
          item.active,
      )
      if (baseline) baseline.active = false
      db.baselines.unshift({
        id: `base-${Date.now()}`,
        projectId: run.projectId,
        page: run.page,
        device: run.device,
        theme: run.theme,
        version: run.currentVersion,
        approvedBy: payload.reviewer,
        reason: payload.reason,
        approvedAt: new Date().toISOString(),
        runId: run.id,
        active: true,
        ruleVersion: run.ruleVersion,
      })
    }
    writeDb(db)
    return respond(config, run)
  }

  if (method === 'post' && path === '/runs/merge') {
    const ids = parseBody<string[]>(config)
    const selected = db.runs.filter((run) => ids.includes(run.id))
    if (selected.length < 2) throw new Error('至少选择两条运行记录进行合并')
    const [first, ...rest] = selected
    first.mergedRunIds = selected.map((run) => run.id)
    first.status = 'merged'
    first.rawMismatchRate =
      selected.reduce((sum, run) => sum + run.rawMismatchRate, 0) / Math.max(selected.length, 1)
    first.regions = rest.flatMap((run) => run.regions).slice(0, 8)
    applyRulesToRun(first, db.rules)
    first.ruleVersion = db.rulesVersion
    writeDb(db)
    return respond(config, first, 201)
  }

  if (method === 'post' && path === '/runs/import') {
    const payload = parseBody<ImportRunPayload>(config)
    if (
      !payload.projectId ||
      !payload.page.trim() ||
      !payload.device.trim() ||
      !payload.build.trim() ||
      payload.files.length === 0
    ) {
      throw new Error('项目、页面、设备、构建版本和截图文件不能为空')
    }
    const imported = payload.files.map((file, index) => {
      const runId = `run-${Date.now()}-${index + 1}`
      const mismatchRate = Number((0.8 + ((file.name.length + index * 3) % 58) / 10).toFixed(2))
      const severity = mismatchRate >= 5 ? 'high' : mismatchRate >= 2 ? 'medium' : 'low'
      const run: ScreenshotRun = {
        id: runId,
        name: `${payload.page} ${payload.device}回归`,
        projectId: payload.projectId,
        page: payload.page.trim(),
        device: payload.device.trim(),
        theme: payload.theme,
        build: payload.build.trim(),
        status: 'pending',
        mismatchRate,
        rawMismatchRate: mismatchRate,
        ruleVersion: db.rulesVersion,
        capturedAt: new Date().toISOString(),
        baselineVersion: payload.baselineVersion.trim() || '当前有效基线',
        currentVersion: payload.currentVersion.trim() || payload.build.trim(),
        baselineImage: payload.baselineImage,
        currentImage: file.dataUrl,
        regions: [
          {
            id: `${runId}-r1`,
            x: 12 + index * 3,
            y: 22 + index * 2,
            width: 24,
            height: 14,
            severity,
            pixels: Math.round(file.size / 8 || 620),
            kind: 'layout',
            selector: '.page-header-banner',
            ignored: false,
          },
          {
            id: `${runId}-r2`,
            x: 58,
            y: 52,
            width: 16,
            height: 10,
            severity: severity === 'high' ? 'medium' : 'low',
            pixels: Math.round(file.size / 18 || 180),
            kind: 'environment',
            selector: '[data-visual-ignore="relative-time"]',
            ignored: false,
          },
        ],
      }
      applyRulesToRun(run, db.rules)
      return run
    })
    db.runs.unshift(...imported)
    writeDb(db)
    return respond(config, imported, 201)
  }

  if (method === 'get' && path === '/baselines') {
    const projectId = config.params?.projectId as string | undefined
    return respond(
      config,
      db.baselines.filter((baseline) => !projectId || baseline.projectId === projectId),
    )
  }

  if (method === 'get' && path === '/rules') {
    return respond<RulesSnapshot>(config, { version: db.rulesVersion, rules: db.rules })
  }

  if (method === 'post' && path === '/rules') {
    const input = parseBody<RuleMutationPayload>(config)
    assertRuleBaseVersion(db, input.baseVersion)
    const { baseVersion, ...rest } = input
    const rule: IgnoreRule = {
      ...rest,
      id: `rule-${Date.now()}`,
      createdAt: new Date().toISOString(),
    }
    db.rules.unshift(rule)
    applyRuleChange(db)
    writeDb(db)
    return respond<RulesSnapshot>(config, { version: db.rulesVersion, rules: db.rules }, 201)
  }

  const ruleMatch = path.match(/^\/rules\/([^/]+)$/)
  if (method === 'patch' && ruleMatch) {
    const payload = parseBody<Partial<IgnoreRule> & { baseVersion?: number }>(config)
    assertRuleBaseVersion(db, payload.baseVersion)
    const rule = db.rules.find((item) => item.id === ruleMatch[1])
    if (!rule) throw new Error('规则不存在')
    const { baseVersion, ...rest } = payload
    Object.assign(rule, rest)
    applyRuleChange(db)
    writeDb(db)
    return respond<RulesSnapshot>(config, { version: db.rulesVersion, rules: db.rules })
  }
  if (method === 'delete' && ruleMatch) {
    const payload = parseBody<{ baseVersion?: number }>(config)
    assertRuleBaseVersion(db, payload?.baseVersion)
    const index = db.rules.findIndex((item) => item.id === ruleMatch[1])
    if (index < 0) throw new Error('规则不存在')
    db.rules.splice(index, 1)
    applyRuleChange(db)
    writeDb(db)
    return respond<RulesSnapshot>(config, { version: db.rulesVersion, rules: db.rules })
  }

  throw new Error(`Mock API 未实现：${method.toUpperCase()} ${path}`)
}

api.defaults.adapter = mockAdapter

export const getProjects = async (): Promise<Project[]> => (await api.get<Project[]>('/projects')).data
export const getDashboard = async (): Promise<DashboardData> =>
  (await api.get<DashboardData>('/dashboard')).data
export const getRuns = async (filters: RunFilters = {}): Promise<ScreenshotRun[]> =>
  (await api.get<ScreenshotRun[]>('/runs', { params: filters })).data
export const getRun = async (id: string): Promise<ScreenshotRun> =>
  (await api.get<ScreenshotRun>(`/runs/${id}`)).data
export const reviewRun = async (id: string, payload: ReviewPayload): Promise<ScreenshotRun> =>
  (await api.patch<ScreenshotRun>(`/runs/${id}/review`, payload)).data
export const mergeRuns = async (ids: string[]): Promise<ScreenshotRun> =>
  (await api.post<ScreenshotRun>('/runs/merge', ids)).data
export const importRuns = async (payload: ImportRunPayload): Promise<ScreenshotRun[]> =>
  (await api.post<ScreenshotRun[]>('/runs/import', payload)).data
export const getBaselines = async (projectId?: string): Promise<Baseline[]> =>
  (await api.get<Baseline[]>('/baselines', { params: { projectId } })).data

export type RuleInput = Omit<IgnoreRule, 'id' | 'createdAt'>
type RuleMutationPayload = RuleInput & { baseVersion?: number }

export const getRules = async (): Promise<RulesSnapshot> =>
  (await api.get<RulesSnapshot>('/rules')).data
export const createRule = async (payload: RuleInput, baseVersion: number): Promise<RulesSnapshot> =>
  (await api.post<RulesSnapshot>('/rules', { ...payload, baseVersion })).data
export const updateRule = async (
  id: string,
  payload: Partial<RuleInput>,
  baseVersion: number,
): Promise<RulesSnapshot> =>
  (await api.patch<RulesSnapshot>(`/rules/${id}`, { ...payload, baseVersion })).data
export const toggleRule = async (
  id: string,
  enabled: boolean,
  baseVersion: number,
): Promise<RulesSnapshot> =>
  (await api.patch<RulesSnapshot>(`/rules/${id}`, { enabled, baseVersion })).data
export const deleteRule = async (id: string, baseVersion: number): Promise<RulesSnapshot> =>
  (await api.delete<RulesSnapshot>(`/rules/${id}`, { data: { baseVersion } })).data
