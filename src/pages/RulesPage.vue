<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { Message, Modal } from '@arco-design/web-vue'
import {
  createRule,
  deleteRule,
  getProjects,
  getRules,
  RuleConflictError,
  toggleRule,
  updateRule,
  type RuleInput,
} from '@/api/http'
import type { IgnoreRule } from '@/types'

const queryClient = useQueryClient()
const modalVisible = ref(false)
const editingRuleId = ref<string | null>(null)
const form = reactive<RuleInput>({
  name: '',
  projectId: 'all',
  selector: '',
  pagePattern: '*',
  devicePattern: '*',
  maxDelta: 10,
  enabled: true,
})

const { data: snapshot, isLoading } = useQuery({ queryKey: ['rules'], queryFn: getRules })
const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: getProjects })

const rules = computed(() => snapshot.value?.rules ?? [])
const rulesVersion = computed(() => snapshot.value?.version ?? 0)

const refreshRules = async () => queryClient.invalidateQueries({ queryKey: ['rules'] })

/** 规则改动后，待审批运行的差异区域与差异率已在服务端重算，同步失效相关查询。 */
const refreshAfterRuleChange = async () => {
  await refreshRules()
  await queryClient.invalidateQueries({ queryKey: ['runs'] })
  await queryClient.invalidateQueries({ queryKey: ['run'] })
  await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
}

const handleMutationError = async (error: Error) => {
  if (error instanceof RuleConflictError) {
    // 晚到一方保留草稿：表单内容不清空，仅刷新到最新版本后由用户重新提交
    Message.warning(error.message)
    await refreshRules()
    return
  }
  Message.error(error.message)
}

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

const openCreate = () => {
  editingRuleId.value = null
  resetForm()
  modalVisible.value = true
}

const openEdit = (rule: IgnoreRule) => {
  editingRuleId.value = rule.id
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

const saveMutation = useMutation({
  mutationFn: () =>
    editingRuleId.value
      ? updateRule(editingRuleId.value, { ...form }, rulesVersion.value)
      : createRule({ ...form }, rulesVersion.value),
  onSuccess: async () => {
    Message.success('规则已保存，待审批运行的差异区域与差异率已重算')
    modalVisible.value = false
    editingRuleId.value = null
    await refreshAfterRuleChange()
  },
  onError: handleMutationError,
})

const toggleMutation = useMutation({
  mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
    toggleRule(id, enabled, rulesVersion.value),
  onSuccess: async () => {
    Message.success('规则状态已更新，待审批运行已重算')
    await refreshAfterRuleChange()
  },
  onError: handleMutationError,
})

const deleteMutation = useMutation({
  mutationFn: (id: string) => deleteRule(id, rulesVersion.value),
  onSuccess: async () => {
    Message.success('规则已删除，待审批运行已按剩余规则重算')
    await refreshAfterRuleChange()
  },
  onError: handleMutationError,
})

const submitRule = () => {
  if (!form.name.trim() || !form.selector.trim()) {
    Message.warning('规则名称和选择器不能为空')
    return
  }
  saveMutation.mutate()
}

const confirmDelete = (rule: IgnoreRule) => {
  Modal.warning({
    title: '删除忽略规则',
    content: `删除“${rule.name}”后，待审批运行将立即按剩余规则重算差异区域。`,
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
      <p>用稳定的 DOM 选择器和限制条件排除时间、水印、随机头像等环境噪声。</p>
    </div>
    <a-space>
      <a-tag color="arcoblue">当前规则版本 v{{ rulesVersion }}</a-tag>
      <a-button type="primary" @click="openCreate"><icon-plus /> 新建规则</a-button>
    </a-space>
  </section>

  <a-alert type="info" style="margin-bottom: 16px">
    规则按项目、页面、设备和区域选择器命中；同一区域命中多条时作用范围更具体的优先，同样具体取更严色差。
    规则保存后立即重算待审批运行的差异区域与差异率，已批准基线保留当时的规则版本。
  </a-alert>

  <a-card class="table-panel" :bordered="false">
    <a-table :data="rules" :loading="isLoading" :pagination="false" row-key="id">
      <template #columns>
        <a-table-column title="规则名称" :width="190">
          <template #cell="{ record }">
            <div class="primary-cell"><strong>{{ record.name }}</strong><span>{{ record.id }}</span></div>
          </template>
        </a-table-column>
        <a-table-column title="作用范围" :width="160">
          <template #cell="{ record }">{{ projectName(record.projectId) }}</template>
        </a-table-column>
        <a-table-column title="DOM 选择器" :width="240">
          <template #cell="{ record }"><code>{{ record.selector }}</code></template>
        </a-table-column>
        <a-table-column title="页面 / 设备" :width="180">
          <template #cell="{ record }">{{ record.pagePattern }} · {{ record.devicePattern }}</template>
        </a-table-column>
        <a-table-column title="最大色差" :width="110">
          <template #cell="{ record }">Δ {{ record.maxDelta }}</template>
        </a-table-column>
        <a-table-column title="启用" :width="100">
          <template #cell="{ record }">
            <a-switch
              :model-value="record.enabled"
              size="small"
              @change="(value: string | number | boolean) => toggleMutation.mutate({ id: record.id, enabled: Boolean(value) })"
            />
          </template>
        </a-table-column>
        <a-table-column title="操作" :width="140">
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
    :title="editingRuleId ? '编辑忽略规则' : '新建忽略规则'"
    :ok-loading="saveMutation.isPending.value"
    @ok="submitRule"
  >
    <a-alert v-if="editingRuleId" type="warning" style="margin-bottom: 16px">
      基于规则版本 v{{ rulesVersion }} 编辑；若其他窗口先提交，本次修改会保留为草稿。
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
      <a-form-item label="保存后立即启用">
        <a-switch v-model="form.enabled" />
      </a-form-item>
    </a-form>
  </a-modal>
</template>
