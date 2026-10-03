<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { Message } from '@arco-design/web-vue'
import DiffCanvas from '@/components/DiffCanvas.vue'
import StatusTag from '@/components/StatusTag.vue'
import { ReviewConflictError, getRun, lockRunReview, reviewRun } from '@/api/http'
import { useReviewStore } from '@/stores/review'
import type { DifferenceRegion, ReviewCategory, ReviewPayload } from '@/types'

interface ReviewForm {
  category: ReviewCategory
  decision: 'approved' | 'rejected'
  reviewer: string
  reason: string
}

const route = useRoute()
const router = useRouter()
const queryClient = useQueryClient()
const reviewStore = useReviewStore()
const runId = computed(() => String(route.params.id))
const localRegions = ref<DifferenceRegion[]>([])
const regionsDirty = ref(false)
const lockRequested = ref(false)

const form = reactive<ReviewForm>({
  category: 'design-change',
  decision: 'approved',
  reviewer: '林默',
  reason: '',
})

const { data: run, isLoading } = useQuery({
  queryKey: computed(() => ['run', runId.value]),
  queryFn: () => getRun(runId.value),
})

const lockMutation = useMutation({
  mutationFn: () => lockRunReview(runId.value),
  onSuccess: async () => {
    await queryClient.invalidateQueries({ queryKey: ['run', runId.value] })
  },
})

watch(
  run,
  (value) => {
    if (!value) return
    if (!regionsDirty.value) {
      localRegions.value = value.regions.map((region) => ({ ...region }))
    }
    reviewStore.setDifferenceFilter('all')
    // 审批开始时锁定所依据的规则版本
    if (value.status === 'pending' && !lockRequested.value) {
      lockRequested.value = true
      lockMutation.mutate()
    }
  },
  { immediate: true },
)

const visibleRegions = computed(() =>
  localRegions.value.filter(
    (region) =>
      reviewStore.differenceFilter === 'all' || region.severity === reviewStore.differenceFilter,
  ),
)

const suspiciousPixels = computed(() =>
  localRegions.value
    .filter((region) => !region.ignored)
    .reduce((total, region) => total + region.pixels, 0),
)

const reviewMutation = useMutation({
  mutationFn: (payload: ReviewPayload) => reviewRun(runId.value, payload),
  onSuccess: async (updated) => {
    Message.success(updated.review?.decision === 'approved' ? '审批通过，新基线已留痕' : '已驳回归并保留原基线')
    await queryClient.invalidateQueries({ queryKey: ['run', runId.value] })
    await queryClient.invalidateQueries({ queryKey: ['runs'] })
    await queryClient.invalidateQueries({ queryKey: ['baselines'] })
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    await router.push('/approvals')
  },
  onError: async (error: Error) => {
    if (error instanceof ReviewConflictError) {
      // 晚到提交：不覆盖他人结论，本地调整已被服务端保留为草稿
      Message.warning(error.message)
      regionsDirty.value = false
      await queryClient.invalidateQueries({ queryKey: ['run', runId.value] })
      await queryClient.invalidateQueries({ queryKey: ['runs'] })
      return
    }
    Message.error(error.message)
  },
})

const toggleIgnored = (target: DifferenceRegion) => {
  const region = localRegions.value.find((item) => item.id === target.id)
  if (region) {
    region.ignored = !region.ignored
    regionsDirty.value = true
  }
}

const handleDifferenceFilter = (value: string | number | boolean) => {
  const allowed = ['all', 'high', 'medium', 'low']
  if (allowed.includes(String(value))) {
    reviewStore.setDifferenceFilter(String(value) as 'all' | 'high' | 'medium' | 'low')
  }
}

const loadReviewDraft = () => {
  const draft = run.value?.reviewDraft
  if (!draft) return
  Object.assign(form, {
    category: draft.payload.category,
    decision: draft.payload.decision,
    reviewer: draft.payload.reviewer,
    reason: draft.payload.reason,
  })
  if (draft.payload.regions) {
    const overrides = new Map(draft.payload.regions.map((item) => [item.id, item.ignored]))
    localRegions.value = localRegions.value.map((region) =>
      overrides.has(region.id) ? { ...region, ignored: overrides.get(region.id)! } : region,
    )
    regionsDirty.value = true
  }
  Message.info('草稿已载入表单，可继续调整后重新提交')
}

const submitReview = () => {
  if (!form.reason.trim()) {
    Message.warning('请填写审批原因')
    return
  }
  if (!run.value) return
  reviewMutation.mutate({
    ...form,
    baseRuleVersion: run.value.lockedRuleVersion ?? run.value.ruleVersion,
    regions: localRegions.value.map((region) => ({ id: region.id, ignored: region.ignored })),
  })
}
</script>

<template>
  <a-spin :loading="isLoading" style="width: 100%">
    <template v-if="run">
      <section class="detail-heading">
        <div>
          <a-space>
            <h2>{{ run.name }}</h2>
            <StatusTag :status="run.status" />
          </a-space>
          <p>{{ run.page }} · {{ run.device }} · {{ run.theme === 'light' ? '浅色主题' : '深色主题' }}</p>
        </div>
        <a-space>
          <a-button @click="router.push('/runs')"><icon-left /> 返回列表</a-button>
          <a-button type="primary" :loading="reviewMutation.isPending.value" @click="submitReview">
            <icon-check /> 提交审批
          </a-button>
        </a-space>
      </section>

      <a-alert
        v-if="run.status === 'pending' && run.lockedRuleVersion && run.ruleVersion !== run.lockedRuleVersion"
        type="warning"
        style="margin-bottom: 16px"
      >
        评审期间忽略规则已更新至 v{{ run.ruleVersion }}，差异区域与差异率已重算；本次审批仍按锁定的规则 v{{ run.lockedRuleVersion }} 留痕。
      </a-alert>
      <a-alert v-if="run.reviewDraft" type="error" style="margin-bottom: 16px">
        <div class="draft-alert">
          <span>
            该运行已被其他窗口提交，你于 {{ run.reviewDraft.savedAt.slice(5, 16).replace('T', ' ') }} 的调整已保留为草稿。
          </span>
          <a-button size="mini" @click="loadReviewDraft">载入草稿</a-button>
        </div>
      </a-alert>

      <div class="run-facts">
        <div><span>差异率</span><strong :class="{ danger: run.mismatchRate >= 5 }">{{ run.mismatchRate.toFixed(2) }}%</strong></div>
        <div><span>待判定像素</span><strong>{{ suspiciousPixels.toLocaleString() }}</strong></div>
        <div><span>运行标识</span><strong>{{ run.id }}</strong></div>
        <div>
          <span>判定依据</span>
          <strong>
            规则 v{{ run.ruleVersion ?? 1 }}
            <template v-if="run.lockedRuleVersion">（锁定 v{{ run.lockedRuleVersion }}）</template>
          </strong>
        </div>
        <div><span>构建链路</span><strong>{{ run.baselineVersion }} → {{ run.currentVersion }}</strong></div>
      </div>

      <div class="review-workspace">
        <div class="comparison-area">
          <div class="compare-toolbar">
            <a-space>
              <span class="toolbar-label">差异筛选</span>
              <a-radio-group
                type="button"
                :model-value="reviewStore.differenceFilter"
                size="small"
                @change="handleDifferenceFilter"
              >
                <a-radio value="all">全部</a-radio>
                <a-radio value="high">高</a-radio>
                <a-radio value="medium">中</a-radio>
                <a-radio value="low">低</a-radio>
              </a-radio-group>
            </a-space>
            <a-space>
              <a-button-group size="small">
                <a-button @click="reviewStore.setZoom(reviewStore.zoom - 10)"><icon-zoom-out /></a-button>
                <a-button>{{ reviewStore.zoom }}%</a-button>
                <a-button @click="reviewStore.setZoom(reviewStore.zoom + 10)"><icon-zoom-in /></a-button>
              </a-button-group>
              <a-button size="small" @click="reviewStore.setZoom(100)"><icon-refresh /> 复位</a-button>
            </a-space>
          </div>
          <div class="canvas-grid">
            <DiffCanvas :run="run" side="baseline" :zoom="reviewStore.zoom" :regions="visibleRegions" />
            <DiffCanvas :run="run" side="current" :zoom="reviewStore.zoom" :regions="visibleRegions" />
          </div>
        </div>

        <aside class="review-panel">
          <div class="panel-title">
            <div>
              <h3>差异区域</h3>
              <span>已按当前筛选展示 {{ visibleRegions.length }} 处</span>
            </div>
            <a-tag color="red">{{ localRegions.filter((item) => !item.ignored).length }} 待判定</a-tag>
          </div>
          <div class="region-list">
            <button
              v-for="region in visibleRegions"
              :key="region.id"
              class="region-item"
              :class="{ ignored: region.ignored }"
              @click="toggleIgnored(region)"
            >
              <span class="region-severity" :class="region.severity">{{ region.severity.toUpperCase() }}</span>
              <span class="region-copy">
                <strong>{{ region.kind === 'layout' ? '布局位移' : region.kind === 'color' ? '色彩变化' : region.kind === 'content' ? '内容变更' : '环境噪声' }}</strong>
                <small>
                  区域 {{ region.x }}%, {{ region.y }}% · {{ region.pixels.toLocaleString() }} px
                  <template v-if="region.ruleId"> · 命中 {{ region.ruleId }}</template>
                </small>
              </span>
              <span class="ignore-action">{{ region.ignored ? '恢复' : '忽略' }}</span>
            </button>
          </div>

          <a-divider />

          <div class="panel-title">
            <div>
              <h3>评审结论</h3>
              <span>原因、批准人和新版基线会永久留痕</span>
            </div>
          </div>
          <a-form :model="form" layout="vertical" @submit-success="submitReview">
            <a-form-item
              field="category"
              label="变化类型"
              :rules="[{ required: true, message: '请选择变化类型' }]"
            >
              <a-select v-model="form.category">
                <a-option value="design-change">设计变更</a-option>
                <a-option value="render-error">渲染异常</a-option>
                <a-option value="environment-noise">环境噪声</a-option>
              </a-select>
            </a-form-item>
            <a-form-item
              field="decision"
              label="审批结论"
              :rules="[{ required: true, message: '请选择审批结论' }]"
            >
              <a-radio-group v-model="form.decision" type="button">
                <a-radio value="approved">批准为新基线</a-radio>
                <a-radio value="rejected">驳回归</a-radio>
              </a-radio-group>
            </a-form-item>
            <a-form-item
              field="reviewer"
              label="批准人"
              :rules="[{ required: true, message: '请填写批准人' }]"
            >
              <a-input v-model="form.reviewer" />
            </a-form-item>
            <a-form-item
              field="reason"
              label="审批原因"
              :rules="[
                { required: true, message: '请填写审批原因' },
                { minLength: 8, message: '审批原因至少 8 个字符' },
              ]"
            >
              <a-textarea
                v-model="form.reason"
                :auto-size="{ minRows: 4, maxRows: 7 }"
                placeholder="说明业务需求、设计稿或异常依据"
              />
            </a-form-item>
            <a-alert v-if="form.decision === 'approved'" type="warning" style="margin-bottom: 16px">
              批准后只会新增基线版本，原基线仍可追溯，不会被覆盖。
            </a-alert>
            <a-button html-type="submit" type="primary" long :loading="reviewMutation.isPending.value">
              确认{{ form.decision === 'approved' ? '批准并创建基线' : '驳回' }}
            </a-button>
          </a-form>

          <div v-if="run.review" class="review-record">
            <h4>最近一次审批</h4>
            <dl>
              <dt>结论</dt><dd>{{ run.review.decision === 'approved' ? '已批准' : '已驳回' }}</dd>
              <dt>类型</dt><dd>{{ run.review.category }}</dd>
              <dt>人员</dt><dd>{{ run.review.reviewer }}</dd>
              <dt>时间</dt><dd>{{ run.review.reviewedAt.slice(0, 16).replace('T', ' ') }}</dd>
              <dt>依据规则</dt><dd>v{{ run.review.ruleVersion ?? 1 }}</dd>
            </dl>
            <p>{{ run.review.reason }}</p>
          </div>
        </aside>
      </div>
    </template>
  </a-spin>
</template>
