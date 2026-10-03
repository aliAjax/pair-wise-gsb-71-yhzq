export type ReviewCategory = 'design-change' | 'render-error' | 'environment-noise'
export type RunStatus = 'pending' | 'approved' | 'rejected' | 'merged'
export type Severity = 'high' | 'medium' | 'low'

export interface Project {
  id: string
  name: string
  code: string
  owner: string
  pageCount: number
}

export interface DifferenceRegion {
  id: string
  x: number
  y: number
  width: number
  height: number
  severity: Severity
  pixels: number
  kind: 'layout' | 'content' | 'color' | 'environment'
  ignored: boolean
  ruleId?: string
  selector?: string
  delta?: number
}

export interface ReviewRecord {
  category: ReviewCategory
  decision: 'approved' | 'rejected'
  reviewer: string
  reason: string
  reviewedAt: string
  ruleVersion?: number
}

export interface ScreenshotRun {
  id: string
  name: string
  projectId: string
  page: string
  device: string
  theme: 'light' | 'dark'
  build: string
  status: RunStatus
  mismatchRate: number
  capturedAt: string
  baselineVersion: string
  currentVersion: string
  baselineImage?: string
  currentImage?: string
  regions: DifferenceRegion[]
  review?: ReviewRecord
  mergedRunIds?: string[]
  ruleVersion?: number
  lockedRuleVersion?: number
  reviewDraft?: ReviewDraft
}

export interface Baseline {
  id: string
  projectId: string
  page: string
  device: string
  theme: 'light' | 'dark'
  version: string
  approvedBy: string
  reason: string
  approvedAt: string
  runId: string
  active: boolean
  ruleVersion?: number
}

export interface IgnoreRule {
  id: string
  name: string
  projectId: string
  selector: string
  pagePattern: string
  devicePattern: string
  maxDelta: number
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface RuleInput {
  name: string
  projectId: string
  selector: string
  pagePattern: string
  devicePattern: string
  maxDelta: number
  enabled: boolean
}

export interface RuleUpdateInput extends Partial<RuleInput> {
  baseVersion?: number
}

export interface RuleDraft {
  id: string
  ruleId: string
  ruleName: string
  changes: Partial<RuleInput>
  baseVersion: number
  currentVersion: number
  savedAt: string
}

export interface RuleMeta {
  version: number
  drafts: RuleDraft[]
}

export interface ReviewDraft {
  payload: ReviewPayload
  savedAt: string
}

export interface DashboardData {
  pendingReview: number
  approvedToday: number
  highRisk: number
  activeBaselines: number
  trend: Array<{ date: string; total: number; failed: number }>
}

export interface RunFilters {
  projectId?: string
  page?: string
  device?: string
  theme?: string
  build?: string
  status?: string
  keyword?: string
}

export interface ReviewPayload {
  category: ReviewCategory
  decision: 'approved' | 'rejected'
  reviewer: string
  reason: string
  baseRuleVersion?: number
  regions?: Array<{ id: string; ignored: boolean }>
}

export interface ImportRunPayload {
  projectId: string
  page: string
  device: string
  theme: 'light' | 'dark'
  build: string
  baselineVersion: string
  currentVersion: string
  files: Array<{ name: string; size: number; dataUrl: string }>
  baselineImage?: string
}
