import axios, { type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { readDb, writeDb, type Database } from '@/mocks/db'
import { computeMismatchRate, evaluateRun } from '@/utils/rules'
import type {
  Baseline,
  DashboardData,
  IgnoreRule,
  ImportRunPayload,
  Project,
  ReviewPayload,
  RuleDraft,
  RuleInput,
  RuleMeta,
  RuleUpdateInput,
  RunFilters,
  Severity,
  ScreenshotRun,
} from '@/types'

/** 规则编辑基于过期版本提交：调整已转存为草稿，未覆盖他人修改 */
export class RuleConflictError extends Error {
  constructor(public draft: RuleDraft) {
    super('规则已被其他窗口修改，你的调整已保留为草稿')
    this.name = 'RuleConflictError'
  }
}

/** 同一运行已被其他窗口提交审批：本次调整保留为草稿 */
export class ReviewConflictError extends Error {
  constructor(public run: ScreenshotRun) {
    super('该运行已被其他窗口提交，你的调整已保留为草稿')
    this.name = 'ReviewConflictError'
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

/** 规则改动后立即重算所有未审批运行的差异区域、判定依据与差异率 */
const recomputePendingRuns = (db: Database) => {
  db.runs.forEach((run) => {
    if (run.status !== 'pending') return
    const evaluated = evaluateRun(run, db.rules)
    run.regions = evaluated.regions
    run.mismatchRate = evaluated.mismatchRate
    run.ruleVersion = db.meta.rulesVersion
  })
}

const bumpRulesVersion = (db: Database) => {
  db.meta.rulesVersion += 1
  recomputePendingRuns(db)
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

  const reviewLockMatch = path.match(/^\/runs\/([^/]+)\/review-lock$/)
  if (method === 'post' && reviewLockMatch) {
    const run = db.runs.find((item) => item.id === reviewLockMatch[1])
    if (!run) throw new Error('运行记录不存在')
    // 审批开始时锁住所依据的规则版本，评审期间的规则改动不影响本次留痕
    if (run.status === 'pending') {
      run.lockedRuleVersion = run.ruleVersion ?? db.meta.rulesVersion
      writeDb(db)
    }
    return respond(config, run)
  }

  const reviewMatch = path.match(/^\/runs\/([^/]+)\/review$/)
  if (method === 'patch' && reviewMatch) {
    const payload = parseBody<ReviewPayload>(config)
    const run = db.runs.find((item) => item.id === reviewMatch[1])
    if (!run) throw new Error('运行记录不存在')
    if (run.status !== 'pending') {
      // 晚到的提交不覆盖已有结论，调整保留为草稿
      run.reviewDraft = { payload, savedAt: new Date().toISOString() }
      writeDb(db)
      throw new ReviewConflictError(run)
    }
    if (payload.regions) {
      const overrides = new Map(payload.regions.map((region) => [region.id, region.ignored]))
      run.regions = run.regions.map((region) =>
        overrides.has(region.id) ? { ...region, ignored: overrides.get(region.id)! } : region,
      )
      run.mismatchRate = computeMismatchRate(run.regions)
    }
    const basisRuleVersion = run.lockedRuleVersion ?? run.ruleVersion ?? db.meta.rulesVersion
    run.status = payload.decision
    run.review = {
      category: payload.category,
      decision: payload.decision,
      reviewer: payload.reviewer,
      reason: payload.reason,
      reviewedAt: new Date().toISOString(),
      ruleVersion: basisRuleVersion,
    }
    delete run.reviewDraft
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
        ruleVersion: basisRuleVersion,
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
    first.regions = rest.flatMap((run) => run.regions).slice(0, 8)
    first.mismatchRate = computeMismatchRate(first.regions)
    first.ruleVersion = db.meta.rulesVersion
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
    const severityOf = (pixels: number): Severity =>
      pixels >= 1500 ? 'high' : pixels >= 600 ? 'medium' : 'low'
    const imported = payload.files.map((file, index) => {
      const runId = `run-${Date.now()}-${index + 1}`
      const scope = {
        projectId: payload.projectId,
        page: payload.page.trim(),
        device: payload.device.trim(),
      }
      const layoutPixels = Math.round(file.size / 8 || 620)
      const noisePixels = Math.round(file.size / 18 || 180)
      const evaluated = evaluateRun(
        {
          ...scope,
          regions: [
            {
              id: `${runId}-r1`,
              x: 12 + index * 3,
              y: 22 + index * 2,
              width: 24,
              height: 14,
              severity: severityOf(layoutPixels),
              pixels: layoutPixels,
              kind: 'layout' as const,
              ignored: false,
              selector: '[data-visual="main-layout"]',
              delta: 32,
            },
            {
              id: `${runId}-r2`,
              x: 58,
              y: 52,
              width: 16,
              height: 10,
              severity: severityOf(noisePixels),
              pixels: noisePixels,
              kind: 'environment' as const,
              ignored: false,
              selector: '[data-visual-ignore="relative-time"]',
              delta: 5,
            },
          ],
        },
        db.rules,
      )
      const run: ScreenshotRun = {
        id: runId,
        name: `${payload.page} ${payload.device}回归`,
        ...scope,
        theme: payload.theme,
        build: payload.build.trim(),
        status: 'pending',
        mismatchRate: evaluated.mismatchRate,
        capturedAt: new Date().toISOString(),
        baselineVersion: payload.baselineVersion.trim() || '当前有效基线',
        currentVersion: payload.currentVersion.trim() || payload.build.trim(),
        baselineImage: payload.baselineImage,
        currentImage: file.dataUrl,
        regions: evaluated.regions,
        ruleVersion: db.meta.rulesVersion,
      }
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
    return respond<IgnoreRule[]>(config, db.rules)
  }

  if (method === 'get' && path === '/rules/meta') {
    return respond<RuleMeta>(config, { version: db.meta.rulesVersion, drafts: db.ruleDrafts })
  }

  if (method === 'post' && path === '/rules') {
    const input = parseBody<RuleInput>(config)
    const now = new Date().toISOString()
    const rule: IgnoreRule = {
      ...input,
      id: `rule-${Date.now()}`,
      createdAt: now,
      updatedAt: now,
    }
    db.rules.unshift(rule)
    bumpRulesVersion(db)
    writeDb(db)
    return respond(config, rule, 201)
  }

  const draftApplyMatch = path.match(/^\/rules\/drafts\/([^/]+)\/apply$/)
  if (method === 'post' && draftApplyMatch) {
    const draft = db.ruleDrafts.find((item) => item.id === draftApplyMatch[1])
    if (!draft) throw new Error('草稿不存在')
    const rule = db.rules.find((item) => item.id === draft.ruleId)
    if (!rule) throw new Error('原规则已被删除，草稿无法应用')
    Object.assign(rule, draft.changes)
    rule.updatedAt = new Date().toISOString()
    db.ruleDrafts = db.ruleDrafts.filter((item) => item.id !== draft.id)
    bumpRulesVersion(db)
    writeDb(db)
    return respond(config, rule)
  }

  const draftMatch = path.match(/^\/rules\/drafts\/([^/]+)$/)
  if (method === 'delete' && draftMatch) {
    const index = db.ruleDrafts.findIndex((item) => item.id === draftMatch[1])
    if (index < 0) throw new Error('草稿不存在')
    db.ruleDrafts.splice(index, 1)
    writeDb(db)
    return respond(config, { success: true })
  }

  const ruleMatch = path.match(/^\/rules\/([^/]+)$/)
  if (method === 'patch' && ruleMatch) {
    const payload = parseBody<RuleUpdateInput>(config)
    const rule = db.rules.find((item) => item.id === ruleMatch[1])
    if (!rule) throw new Error('规则不存在')
    const { baseVersion, ...changes } = payload
    if (typeof baseVersion === 'number' && baseVersion !== db.meta.rulesVersion) {
      // 基于过期版本提交的调整不直接覆盖，保留为草稿等待确认
      const draft: RuleDraft = {
        id: `draft-${Date.now()}`,
        ruleId: rule.id,
        ruleName: rule.name,
        changes,
        baseVersion,
        currentVersion: db.meta.rulesVersion,
        savedAt: new Date().toISOString(),
      }
      db.ruleDrafts.unshift(draft)
      writeDb(db)
      throw new RuleConflictError(draft)
    }
    Object.assign(rule, changes)
    rule.updatedAt = new Date().toISOString()
    bumpRulesVersion(db)
    writeDb(db)
    return respond(config, rule)
  }
  if (method === 'delete' && ruleMatch) {
    const index = db.rules.findIndex((item) => item.id === ruleMatch[1])
    if (index < 0) throw new Error('规则不存在')
    db.rules.splice(index, 1)
    bumpRulesVersion(db)
    writeDb(db)
    return respond(config, { success: true })
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
export const lockRunReview = async (id: string): Promise<ScreenshotRun> =>
  (await api.post<ScreenshotRun>(`/runs/${id}/review-lock`)).data
export const reviewRun = async (id: string, payload: ReviewPayload): Promise<ScreenshotRun> =>
  (await api.patch<ScreenshotRun>(`/runs/${id}/review`, payload)).data
export const mergeRuns = async (ids: string[]): Promise<ScreenshotRun> =>
  (await api.post<ScreenshotRun>('/runs/merge', ids)).data
export const importRuns = async (payload: ImportRunPayload): Promise<ScreenshotRun[]> =>
  (await api.post<ScreenshotRun[]>('/runs/import', payload)).data
export const getBaselines = async (projectId?: string): Promise<Baseline[]> =>
  (await api.get<Baseline[]>('/baselines', { params: { projectId } })).data
export const getRules = async (): Promise<IgnoreRule[]> =>
  (await api.get<IgnoreRule[]>('/rules')).data
export const getRuleMeta = async (): Promise<RuleMeta> =>
  (await api.get<RuleMeta>('/rules/meta')).data
export const createRule = async (payload: RuleInput): Promise<IgnoreRule> =>
  (await api.post<IgnoreRule>('/rules', payload)).data
export const updateRule = async (id: string, payload: RuleUpdateInput): Promise<IgnoreRule> =>
  (await api.patch<IgnoreRule>(`/rules/${id}`, payload)).data
export const toggleRule = async (id: string, enabled: boolean): Promise<IgnoreRule> =>
  (await api.patch<IgnoreRule>(`/rules/${id}`, { enabled })).data
export const deleteRule = async (id: string): Promise<{ success: boolean }> =>
  (await api.delete<{ success: boolean }>(`/rules/${id}`)).data
export const applyRuleDraft = async (draftId: string): Promise<IgnoreRule> =>
  (await api.post<IgnoreRule>(`/rules/drafts/${draftId}/apply`)).data
export const discardRuleDraft = async (draftId: string): Promise<{ success: boolean }> =>
  (await api.delete<{ success: boolean }>(`/rules/drafts/${draftId}`)).data
