<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { Message, Modal } from '@arco-design/web-vue'
import {
  RuleConflictError,
  applyRuleDraft,
  createRule,
  deleteRule,
  discardRuleDraft,
  getProjects,
  getRuleMeta,
  getRules,
  toggleRule,
  updateRule,
} from '@/api/http'
import type { IgnoreRule, RuleInput, RuleUpdateInput } from '@/types'

const queryClient = useQueryClient()
const modalVisible = ref(false)
const editingRuleId = ref<string | null>(null)
const editBaseVersion = ref<number>()
const form = reactive<RuleInput>({
  name: '',
  projectId: 'all',
  selector: '',
  pagePattern: '*',
  devicePattern: '*',
  maxDelta: 10,
  enabled: true,
})

const { data: rules, isLoading } = useQuery({ queryKey: ['rules'], queryFn: getRules })
const { data: ruleMeta } = useQuery({ queryKey: ['rule-meta'], queryFn: getRuleMeta })
const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: getProjects })

const resetForm = () => {
  Object.assign(form, {
    name: '',
    projectId: 'all',
    selector: '',
    pagePattern: '*',
    devicePattern: '*',
    maxDelta: 10,
    enabled: true,
  })
}

// 规则改动会立即重算未审批运行，相关查询一并失效刷新
const refreshAfterRuleChange = async () => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['rules'] }),
    queryClient.invalidateQueries({ queryKey: ['rule-meta'] }),
    queryClient.invalidateQueries({ queryKey: ['runs'] }),
    queryClient.invalidateQueries({ queryKey: ['run'] }),
    queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
  ])
}

const createMutation = useMutation({
  mutationFn: createRule,
  onSuccess: async () => {
    Message.success('忽略规则已创建，未审批运行已按新规则重算')
    modalVisible.value = false
    resetForm()
    await refreshAfterRuleChange()
  },
  onError: (error: Error) => Message.error(error.message),
})

const updateMutation = useMutation({
  mutationFn: ({ id, payload }: { id: string; payload: RuleUpdateInput }) => updateRule(id, payload),
  onSuccess: async () => {
    Message.success('规则已更新，未审批运行的判定与差异率已重算')
    modalVisible.value = false
    editingRuleId.value = null
    resetForm()
    await refreshAfterRuleChange()
  },
  onError: async (error: Error) => {
    if (error instanceof RuleConflictError) {
      Message.warning(error.message)
      modalVisible.value = false
      editingRuleId.value = null
      resetForm()
      await refreshAfterRuleChange()
      return
    }
    Message.error(error.message)
  },
})

const toggleMutation = useMutation({
  mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => toggleRule(id, enabled),
  onSuccess: refreshAfterRuleChange,
  onError: (error: Error) => Message.error(error.message),
})

const deleteMutation = useMutation({
  mutationFn: deleteRule,
  onSuccess: async () => {
    Message.success('规则已删除，未审批运行已重算')
    await refreshAfterRuleChange()
  },
  onError: (error: Error) => Message.error(error.message),
})

const applyDraftMutation = useMutation({
  mutationFn: applyRuleDraft,
  onSuccess: async () => {
    Message.success('草稿已按当前规则版本重新应用')
    await refreshAfterRuleChange()
  },
  onError: (error: Error) => Message.error(error.message),
})

const discardDraftMutation = useMutation({
  mutationFn: discardRuleDraft,
  onSuccess: async () => {
    Message.success('草稿已丢弃')
    await refreshAfterRuleChange()
  },
  onError: (error: Error) => Message.error(error.message),
})

const openCreate = () => {
  editingRuleId.value = null
  editBaseVersion.value = undefined
  resetForm()
  modalVisible.value = true
}

const openEdit = (rule: IgnoreRule) => {
  editingRuleId.value = rule.id
  // 记录打开时的规则版本，提交时据此检测其他窗口的并发修改
  editBaseVersion.value = ruleMeta.value?.version
  Object.assign(form, {
    name: rule.name,
    projectId: rule.projectId,
    selector: rule.selector,
    pagePattern: rule.pagePattern,
    devicePattern: rule.devicePattern,
    maxDelta: rule.maxDelta,
    enabled: rule.enabled,
  })
  modalVisible.value = true
}

const submitRule = () => {
  if (!form.name.trim() || !form.selector.trim()) {
    Message.warning('规则名称和选择器不能为空')
    return
  }
  if (editingRuleId.value) {
    updateMutation.mutate({
      id: editingRuleId.value,
      payload: { ...form, baseVersion: editBaseVersion.value },
    })
    return
  }
  createMutation.mutate({ ...form })
}

const confirmDelete = (rule: IgnoreRule) => {
  Modal.warning({
    title: '删除忽略规则',
    content: `删除“${rule.name}”后，未审批运行将立即重算差异区域与差异率。`,
    hideCancel: false,
    onOk: () => deleteMutation.mutate(rule.id),
  })
}

const projectName = (id: string) =>
  id === 'all' ? '全部项目' : projects.value?.find((project) => project.id === id)?.name ?? id
</script>

<template>
  <section class="page-intro compact">
    <div>
      <h2>差异忽略规则</h2>
      <p>按项目、页面、设备和选择器命中差异区域；命中区域不再计入差异率。</p>
    </div>
    <a-space>
      <a-tag color="arcoblue">规则版本 v{{ ruleMeta?.version ?? 1 }}</a-tag>
      <a-button type="primary" @click="openCreate"><icon-plus /> 新建规则</a-button>
    </a-space>
  </section>

  <a-alert type="info" style="margin-bottom: 16px">
    同一区域命中多条规则时，作用范围更具体的优先，同样具体取色差上限更严的一条。规则改动后立即重算未审批运行的判定与差异率；已批准基线保留当时的规则依据。
  </a-alert>

  <a-card v-if="ruleMeta?.drafts.length" class="table-panel draft-panel" :bordered="false" style="margin-bottom: 16px">
    <template #title>冲突草稿（{{ ruleMeta.drafts.length }}）</template>
    <template #extra><span class="muted">其他窗口已先行提交，以下调整暂未生效</span></template>
    <div v-for="draft in ruleMeta.drafts" :key="draft.id" class="draft-row">
      <div class="draft-main">
        <strong>{{ draft.ruleName }}</strong>
        <span>
          基于规则 v{{ draft.baseVersion }} 修改 · 当前已至 v{{ draft.currentVersion }} ·
          {{ draft.savedAt.slice(0, 16).replace('T', ' ') }}
        </span>
      </div>
      <a-space>
        <a-button size="small" type="primary" :loading="applyDraftMutation.isPending.value" @click="applyDraftMutation.mutate(draft.id)">
          按当前版本重新应用
        </a-button>
        <a-button size="small" status="danger" @click="discardDraftMutation.mutate(draft.id)">丢弃</a-button>
      </a-space>
    </div>
  </a-card>

  <a-card class="table-panel" :bordered="false">
    <a-table :data="rules" :loading="isLoading" :pagination="false" row-key="id">
      <template #columns>
        <a-table-column title="规则名称" :width="180">
          <template #cell="{ record }">
            <div class="primary-cell"><strong>{{ record.name }}</strong><span>{{ record.id }}</span></div>
          </template>
        </a-table-column>
        <a-table-column title="作用范围" :width="130">
          <template #cell="{ record }">{{ projectName(record.projectId) }}</template>
        </a-table-column>
        <a-table-column title="DOM 选择器" :width="220">
          <template #cell="{ record }"><code>{{ record.selector }}</code></template>
        </a-table-column>
        <a-table-column title="页面 / 设备" :width="160">
          <template #cell="{ record }">{{ record.pagePattern }} · {{ record.devicePattern }}</template>
        </a-table-column>
        <a-table-column title="最大色差" :width="100">
          <template #cell="{ record }">Δ {{ record.maxDelta }}</template>
        </a-table-column>
        <a-table-column title="更新时间" :width="140">
          <template #cell="{ record }">{{ record.updatedAt.slice(0, 16).replace('T', ' ') }}</template>
        </a-table-column>
        <a-table-column title="启用" :width="80">
          <template #cell="{ record }">
            <a-switch
              :model-value="record.enabled"
              size="small"
              @change="(value: string | number | boolean) => toggleMutation.mutate({ id: record.id, enabled: Boolean(value) })"
            />
          </template>
        </a-table-column>
        <a-table-column title="操作" :width="130" fixed="right">
          <template #cell="{ record }">
            <a-space>
              <a-button type="text" size="small" @click="openEdit(record)">编辑</a-button>
              <a-button type="text" status="danger" size="small" @click="confirmDelete(record)">删除</a-button>
            </a-space>
          </template>
        </a-table-column>
      </template>
    </a-table>
  </a-card>

  <a-modal
    v-model:visible="modalVisible"
    :title="editingRuleId ? '调整忽略规则' : '新建忽略规则'"
    :ok-loading="createMutation.isPending.value || updateMutation.isPending.value"
    @ok="submitRule"
  >
    <a-alert v-if="editingRuleId" type="warning" style="margin-bottom: 16px">
      基于规则 v{{ editBaseVersion ?? 1 }} 调整；若提交时已有其他窗口先行保存，本次调整将保留为草稿。
    </a-alert>
    <a-form :model="form" layout="vertical">
      <a-form-item label="规则名称" required>
        <a-input v-model="form.name" placeholder="例如：环境水印" />
      </a-form-item>
      <a-grid :cols="2" :col-gap="16">
        <a-grid-item>
          <a-form-item label="作用项目" required>
            <a-select v-model="form.projectId">
              <a-option value="all">全部项目</a-option>
              <a-option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</a-option>
            </a-select>
          </a-form-item>
        </a-grid-item>
        <a-grid-item>
          <a-form-item label="最大色差" required>
            <a-input-number v-model="form.maxDelta" :min="0" :max="255" />
          </a-form-item>
        </a-grid-item>
      </a-grid>
      <a-form-item label="DOM 选择器" required>
        <a-input v-model="form.selector" placeholder=".environment-watermark" />
      </a-form-item>
      <a-grid :cols="2" :col-gap="16">
        <a-grid-item>
          <a-form-item label="页面匹配">
            <a-input v-model="form.pagePattern" placeholder="*" />
          </a-form-item>
        </a-grid-item>
        <a-grid-item>
          <a-form-item label="设备匹配">
            <a-input v-model="form.devicePattern" placeholder="*" />
          </a-form-item>
        </a-grid-item>
      </a-grid>
      <a-form-item label="立即启用">
        <a-switch v-model="form.enabled" />
      </a-form-item>
    </a-form>
  </a-modal>
</template>
