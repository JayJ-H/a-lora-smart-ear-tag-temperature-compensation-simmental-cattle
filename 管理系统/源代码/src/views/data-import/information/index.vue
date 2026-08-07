<template>
  <div class="information-import-page">
    <section class="page-head surface-card" :class="{ 'is-entry-head': isInformationEntryRoute }">
      <div>
        <h1>{{ pageTitle }}</h1>
        <p v-if="pageDescription">{{ pageDescription }}</p>
      </div>
      <div v-if="isInformationEntryRoute" class="entry-head-summary" aria-label="当前录入概况">
        <div>
          <span>录入域</span>
          <strong>{{ selectedEventGroup }}</strong>
        </div>
        <div>
          <span>当前事件</span>
          <strong>{{ currentEvent?.label || singleForm.eventName }}</strong>
        </div>
        <div>
          <span>记录状态</span>
          <strong>{{ singleForm.eventStatus }}</strong>
        </div>
      </div>
      <div v-if="!isInformationEntryRoute" class="head-actions">
        <ElButton :icon="Refresh" @click="loadAudits">刷新审计</ElButton>
        <ElButton type="primary" :icon="Download" @click="downloadSelectedTemplate"
          >下载当前模板</ElButton
        >
      </div>
    </section>

    <section v-if="!isInformationEntryRoute" class="metric-grid">
      <article class="metric-card surface-card">
        <span>内置模板</span>
        <strong>{{ templates.length }}</strong>
        <p>覆盖主档、表型、事件、组学和设备</p>
      </article>
      <article class="metric-card surface-card">
        <span>最近预检</span>
        <strong>{{ latestResult?.validRows ?? 0 }}/{{ latestResult?.totalRows ?? 0 }}</strong>
        <p>有效行 / 总行数</p>
      </article>
      <article class="metric-card surface-card">
        <span>最近提交</span>
        <strong>{{ latestResult?.committedRows ?? 0 }}</strong>
        <p>已写入记录批次</p>
      </article>
      <article class="metric-card surface-card">
        <span>审计批次</span>
        <strong>{{ auditRows.length }}</strong>
        <p>可回看来源、操作者和错误行</p>
      </article>
    </section>

    <section v-if="isInformationEntryRoute" class="entry-flow-strip" aria-label="信息录入流程">
      <div class="entry-flow-step is-active">
        <span>01</span>
        <strong>选事件</strong>
        <small>由字典决定字段</small>
      </div>
      <div class="entry-flow-line"></div>
      <div class="entry-flow-step">
        <span>02</span>
        <strong>填业务值</strong>
        <small>牛号自动补齐</small>
      </div>
      <div class="entry-flow-line"></div>
      <div class="entry-flow-step">
        <span>03</span>
        <strong>预检</strong>
        <small>校验周期与重复</small>
      </div>
      <div class="entry-flow-line"></div>
      <div class="entry-flow-step">
        <span>04</span>
        <strong>入库留痕</strong>
        <small>写入事件和审计</small>
      </div>
    </section>

    <ElTabs
      v-model="activeTab"
      class="import-tabs"
      :class="{ 'information-entry-mode': isInformationEntryRoute }"
    >
      <ElTabPane label="单条事件" name="single">
        <section
          class="single-entry-workbench"
          :class="{ 'is-entry-route': isInformationEntryRoute }"
        >
          <aside class="entry-directory surface-card">
            <div class="entry-directory-head">
              <span>{{ isInformationEntryRoute ? '当前录入域' : '事件目录' }}</span>
              <strong>{{ selectedEventGroup }}</strong>
              <small>{{ filteredEvents.length }} 个可录入事件</small>
            </div>
            <div class="entry-event-list">
              <button
                v-for="event in filteredEvents"
                :key="event.code"
                type="button"
                class="entry-event-button"
                :class="{ active: singleForm.eventType === event.code }"
                @click="selectEntryEvent(event)"
              >
                <span>{{ event.label }}</span>
                <small>{{ event.code }}</small>
              </button>
            </div>
          </aside>

          <section class="entry-form-stack">
            <div class="surface-card form-card">
              <div class="section-title">
                <div>
                  <span>{{ singleSectionEyebrow }}</span>
                  <h2>{{ singleSectionTitle }}</h2>
                </div>
                <ElTag v-if="!isInformationEntryRoute">{{ selectedEventGroup }}</ElTag>
              </div>

              <div class="entry-current-bar">
                <div>
                  <span>事件</span>
                  <strong>{{ currentEvent?.label || singleForm.eventName }}</strong>
                </div>
                <div>
                  <span>{{ animalNumberLabel }}</span>
                  <strong>{{ singleForm.animalNumber || '待填写' }}</strong>
                </div>
                <div>
                  <span>发生时间</span>
                  <strong>{{ formatDateTime(singleForm.occurredAt) }}</strong>
                </div>
                <div>
                  <span>记录人</span>
                  <strong>{{ singleForm.operatorName || '待选择' }}</strong>
                </div>
              </div>

              <ElForm label-width="104px" class="compact-form">
                <section v-if="!isInformationEntryRoute" class="form-section is-compact">
                  <h3>录入口径</h3>
                  <div class="form-field-grid">
                    <ElFormItem label="事件分组">
                      <ElSelect
                        v-model="singleForm.eventGroup"
                        class="w-full"
                        @change="syncEventByGroup"
                      >
                        <ElOption
                          v-for="group in eventGroups"
                          :key="group.group"
                          :label="group.group"
                          :value="group.group"
                        />
                      </ElSelect>
                    </ElFormItem>
                    <ElFormItem label="事件名称">
                      <ElSelect
                        v-model="singleForm.eventType"
                        filterable
                        class="w-full"
                        placeholder="选择事件名称"
                      >
                        <ElOption
                          v-for="event in filteredEvents"
                          :key="event.code"
                          :label="event.label"
                          :value="event.code"
                        />
                      </ElSelect>
                    </ElFormItem>
                  </div>
                </section>

                <section class="form-section">
                  <h3>基础信息</h3>
                  <div class="form-field-grid">
                    <ElFormItem :label="animalNumberLabel">
                      <ElInput
                        v-if="singleForm.eventType === 'entry'"
                        v-model="singleForm.animalNumber"
                        class="w-full"
                        clearable
                        :placeholder="animalNumberPlaceholder"
                      />
                      <CowNumberAutocomplete
                        v-else
                        v-model="singleForm.animalNumber"
                        :placeholder="animalNumberPlaceholder"
                        @select="selectCowSuggestion"
                      />
                    </ElFormItem>
                    <ElFormItem label="发生时间">
                      <ElDatePicker
                        v-model="singleForm.occurredAt"
                        type="date"
                        value-format="YYYY-MM-DD"
                        class="w-full"
                      />
                    </ElFormItem>
                    <ElFormItem label="记录人">
                      <ElSelect
                        v-model="singleForm.operatorId"
                        filterable
                        class="w-full"
                        placeholder="选择记录人"
                        @change="syncOperatorName"
                      >
                        <ElOption
                          v-for="person in operatorOptions"
                          :key="person.value"
                          :label="person.label"
                          :value="person.value"
                        />
                      </ElSelect>
                    </ElFormItem>
                    <ElFormItem label="状态">
                      <ElSelect
                        v-model="singleForm.eventStatus"
                        class="w-full"
                        placeholder="选择记录状态"
                      >
                        <ElOption
                          v-for="item in eventStatusOptions"
                          :key="item.value"
                          :label="item.label"
                          :value="item.value"
                        />
                      </ElSelect>
                    </ElFormItem>
                  </div>
                </section>

                <section class="form-section system-section">
                  <h3>系统自动判断</h3>
                  <div class="system-fact-grid">
                    <div class="system-fact">
                      <span>胎次</span>
                      <strong>{{ derivedParityText }}</strong>
                    </div>
                    <div v-if="singleForm.eventType === 'insemination'" class="system-fact">
                      <span>本胎输精统计</span>
                      <strong>{{ currentParityInseminationText }}</strong>
                    </div>
                    <div v-if="isMovementEvent" class="system-fact">
                      <span>当前圈舍</span>
                      <strong>{{ movementCurrentPenText }}</strong>
                    </div>
                  </div>
                </section>

                <section class="form-section">
                  <h3>业务字段</h3>
                  <div class="form-field-grid">
                    <ElFormItem v-if="showSeverityField" label="级别">
                      <ElSelect
                        v-model="singleForm.severity"
                        class="w-full"
                        placeholder="选择事件级别"
                      >
                        <ElOption
                          v-for="item in severityOptions"
                          :key="item.value"
                          :label="item.label"
                          :value="item.value"
                        />
                      </ElSelect>
                    </ElFormItem>
                    <ElFormItem
                      v-for="field in activeEventFields"
                      :key="field.key"
                      :label="field.label"
                    >
                      <ElSelect
                        v-if="field.type === 'select'"
                        v-model="eventDynamicForm[field.key]"
                        filterable
                        clearable
                        :allow-create="field.allowCreate || false"
                        :default-first-option="field.allowCreate || false"
                        class="w-full"
                        :placeholder="field.placeholder || `选择${field.label}`"
                      >
                        <ElOption
                          v-for="item in fieldSelectOptions(field)"
                          :key="item.value"
                          :label="item.label"
                          :value="item.value"
                        />
                      </ElSelect>
                      <ElInputNumber
                        v-else-if="field.type === 'number'"
                        v-model="eventDynamicForm[field.key]"
                        class="w-full"
                        :min="field.min"
                        :step="field.step || 1"
                        controls-position="right"
                        :placeholder="field.placeholder || `填写${field.label}`"
                      />
                      <ElInput
                        v-else-if="field.type === 'text'"
                        v-model="eventDynamicForm[field.key]"
                        class="w-full"
                        clearable
                        :placeholder="field.placeholder || `填写${field.label}`"
                      />
                      <ElDatePicker
                        v-else-if="field.type === 'date'"
                        v-model="eventDynamicForm[field.key]"
                        type="date"
                        value-format="YYYY-MM-DD"
                        class="w-full"
                        :placeholder="field.placeholder || `选择${field.label}`"
                      />
                      <ElDatePicker
                        v-else
                        v-model="eventDynamicForm[field.key]"
                        type="date"
                        value-format="YYYY-MM-DD"
                        class="w-full"
                        :placeholder="field.placeholder || `选择${field.label}`"
                      />
                    </ElFormItem>
                  </div>
                </section>

                <div v-if="singleForm.eventType === 'calving'" class="calf-editor">
                  <div class="calf-editor-head">
                    <div>
                      <span>犊牛建档</span>
                      <strong>按犊牛数逐头录入</strong>
                    </div>
                    <ElButton size="small" :icon="Plus" @click="addCalfRow">加一头</ElButton>
                  </div>
                  <div v-for="(calf, index) in calfRows" :key="index" class="calf-row">
                    <ElFormItem :label="`犊牛${index + 1}号`">
                      <ElInput v-model="calf.cowNumber" clearable placeholder="填写新犊牛号" />
                    </ElFormItem>
                    <ElFormItem label="性别">
                      <ElSelect v-model="calf.sex" class="w-full" placeholder="选择性别">
                        <ElOption
                          v-for="item in calfSexOptions"
                          :key="item.value"
                          :label="item.label"
                          :value="item.value"
                        />
                      </ElSelect>
                    </ElFormItem>
                    <ElFormItem label="耳号">
                      <ElInput v-model="calf.earTagNumber" clearable placeholder="可选" />
                    </ElFormItem>
                    <ElFormItem label="备注">
                      <div class="calf-remark-row">
                        <ElInput v-model="calf.remark" clearable placeholder="可选" />
                        <ElButton
                          v-if="calfRows.length > 1"
                          :icon="Delete"
                          circle
                          @click="removeCalfRow(index)"
                        />
                      </div>
                    </ElFormItem>
                  </div>
                </div>
                <section class="form-section">
                  <h3>备注</h3>
                  <ElFormItem label="备注">
                    <ElInput v-model="singleForm.notes" type="textarea" :rows="3" />
                  </ElFormItem>
                </section>
              </ElForm>

              <div class="action-row entry-action-row">
                <ElButton :icon="Search" @click="dryRunSingle" :loading="checking">预检</ElButton>
                <ElButton type="primary" :icon="Upload" @click="commitSingle" :loading="committing"
                  >提交入库</ElButton
                >
              </div>
            </div>
          </section>

          <aside class="surface-card result-card entry-side-panel">
            <section class="entry-side-section">
              <div class="entry-side-section-head">
                <div>
                  <span>提交反馈</span>
                  <h2>预检与入库结果</h2>
                </div>
              </div>
              <ResultPanel :result="latestResult" @download-errors="downloadErrors" />
            </section>
            <div class="recent-entry-panel">
              <div class="recent-entry-head">
                <div>
                  <span>最近成功</span>
                  <h2>单条录入记录</h2>
                </div>
                <ElTag size="small">{{ filteredRecentSingleRecords.length }} 条</ElTag>
              </div>
              <div class="recent-entry-list" @scroll="handleRecentSingleScroll">
                <article
                  v-for="item in visibleRecentSingleRecords"
                  :key="item.id"
                  class="recent-entry-item"
                >
                  <div class="recent-entry-main">
                    <strong>{{ item.cowNumber || '-' }}</strong>
                    <span>{{ item.eventName || item.eventCode || '-' }}</span>
                  </div>
                  <div class="recent-entry-meta">
                    <span>{{ formatDateTime(item.occurredAt) }}</span>
                    <span>{{ item.operatorName || '-' }}</span>
                  </div>
                </article>
                <p v-if="!visibleRecentSingleRecords.length" class="empty-text"
                  >当前事件暂无成功单条录入记录</p
                >
                <p v-else-if="hasMoreRecentSingleRecords" class="recent-entry-more"
                  >继续滚动加载更多</p
                >
              </div>
            </div>
          </aside>
        </section>
      </ElTabPane>

      <ElTabPane v-if="!isInformationEntryRoute" label="批量表格" name="batch">
        <section class="content-grid">
          <div class="surface-card form-card">
            <div class="section-title">
              <div>
                <span>批量导入</span>
                <h2>表格适配</h2>
              </div>
              <ElTag>{{ selectedTemplate.name }}</ElTag>
            </div>

            <ElForm label-width="104px" class="compact-form">
              <ElFormItem label="导入模板">
                <ElSelect v-model="selectedTemplateCode" filterable class="w-full">
                  <ElOption
                    v-for="template in templates"
                    :key="template.code"
                    :label="`${template.group} / ${template.name}`"
                    :value="template.code"
                  />
                </ElSelect>
              </ElFormItem>
              <ElFormItem label="冲突策略">
                <ElInput :model-value="conflictText(selectedTemplate.conflictStrategy)" disabled />
              </ElFormItem>
              <ElFormItem label="适配规则">
                <ElSelect
                  v-model="selectedImportConfigId"
                  clearable
                  filterable
                  class="w-full"
                  placeholder="可选，使用平台管理中的字段映射规则"
                >
                  <ElOption
                    v-for="config in filteredImportConfigs"
                    :key="config.id"
                    :label="config.name"
                    :value="config.id"
                  />
                </ElSelect>
              </ElFormItem>
              <ElFormItem label="目标表">
                <div class="tag-list">
                  <ElTag v-for="table in selectedTemplate.targetTables" :key="table" size="small">{{
                    table
                  }}</ElTag>
                </div>
              </ElFormItem>
              <ElFormItem label="上传表格">
                <ElUpload
                  drag
                  :auto-upload="false"
                  :show-file-list="false"
                  accept=".xlsx,.xls,.csv"
                  :on-change="handleFileSelect"
                >
                  <div class="upload-box">
                    <ElIcon><Upload /></ElIcon>
                    <strong>{{ selectedFile?.name || '选择或拖入 XLSX/CSV 文件' }}</strong>
                    <span>上传后先预检，不会直接写入数据库</span>
                  </div>
                </ElUpload>
              </ElFormItem>
            </ElForm>

            <div class="action-row">
              <ElButton :icon="Download" @click="downloadSelectedTemplate">下载模板</ElButton>
              <ElButton
                :icon="Search"
                @click="dryRunBatch"
                :loading="checking"
                :disabled="!selectedFile"
                >预检表格</ElButton
              >
              <ElButton
                type="primary"
                :icon="Upload"
                @click="commitBatch"
                :loading="committing"
                :disabled="!selectedFile"
                >提交入库</ElButton
              >
            </div>
            <div v-if="batchProgressVisible" class="import-progress-card">
              <div class="import-progress-head">
                <div>
                  <span>{{ importProgressStageLabel }}</span>
                  <strong>{{ importProgressMessage }}</strong>
                </div>
                <ElTag size="small" :type="importProgressTagType"
                  >{{ importProgressPercent }}%</ElTag
                >
              </div>
              <ElProgress
                :percentage="importProgressPercent"
                :status="importProgressStatus"
                :stroke-width="10"
              />
              <div class="import-progress-detail">
                <span>{{ importProgressDetail }}</span>
                <span v-if="importProgressTable">当前表：{{ importProgressTable }}</span>
              </div>
            </div>
          </div>

          <div class="surface-card result-card">
            <ResultPanel :result="latestResult" @download-errors="downloadErrors" />
          </div>
        </section>

        <section class="surface-card preview-card">
          <div class="section-title">
            <div>
              <span>预览</span>
              <h2>结果预览</h2>
            </div>
            <ElTag
              >{{ visiblePreviewRows.length }}/{{ latestResult?.previewRows.length || 0 }} 行</ElTag
            >
          </div>
          <div
            class="preview-table-scroll"
            @scroll.passive="onPreviewScroll"
            @wheel.passive="onPreviewWheel"
          >
            <ElTable :data="visiblePreviewRows" height="360">
              <ElTableColumn
                v-for="column in previewColumns"
                :key="column"
                :prop="column"
                :label="column"
                min-width="140"
              />
            </ElTable>
          </div>
        </section>
      </ElTabPane>

      <ElTabPane v-if="!isInformationEntryRoute" label="模板下载" name="templates">
        <section
          ref="templateGridContainerRef"
          class="template-grid-scroll"
          @scroll.passive="onTemplateScroll"
          @wheel.passive="onTemplateWheel"
        >
          <div class="template-grid">
            <article
              v-for="template in visibleTemplates"
              :key="template.code"
              class="surface-card template-card"
              :class="{ active: selectedTemplateCode === template.code }"
              @click="selectedTemplateCode = template.code"
            >
              <div>
                <span>{{ template.group }}</span>
                <h3>{{ template.name }}</h3>
                <p>{{ template.description }}</p>
              </div>
              <div class="template-meta">
                <ElTag size="small">{{ template.columns.length }} 列</ElTag>
                <ElTag size="small" type="info">{{ template.targetTables.length }} 表</ElTag>
              </div>
              <div class="template-field-groups">
                <div
                  v-for="group in previewTemplateFieldGroups(template)"
                  :key="`${template.code}-${group.section}`"
                  class="template-field-group"
                >
                  <strong>{{ group.section }}</strong>
                  <span>{{ group.labels.join('、') }}</span>
                </div>
              </div>
              <ElButton
                type="primary"
                size="small"
                :icon="Download"
                @click.stop="downloadTemplate(template)"
                >下载模板</ElButton
              >
            </article>
          </div>
          <div v-if="templates.length > visibleTemplates.length" class="load-more-row">
            <ElButton @click="() => loadMoreTemplates()">
              加载更多模板 {{ visibleTemplates.length }}/{{ templates.length }}
            </ElButton>
          </div>
        </section>
      </ElTabPane>

      <ElTabPane v-if="!isInformationEntryRoute" label="导入审计" name="audit">
        <section class="surface-card preview-card">
          <div class="section-title">
            <div>
              <span>审计</span>
              <h2>导入批次</h2>
            </div>
            <ElButton :icon="Refresh" @click="loadAudits">刷新</ElButton>
          </div>
          <div class="lazy-table-toolbar">
            <ElTag type="info" effect="light"
              >显示 {{ visibleAuditRows.length }}/{{ auditRows.length }} 条</ElTag
            >
          </div>
          <ElTable
            :data="visibleAuditRows"
            height="min(62vh, 520px)"
            @wheel.passive="onAuditTableWheel"
          >
            <ElTableColumn label="时间" width="180">
              <template #default="{ row }">{{
                formatDateTime(row.created_at || row.createdAt)
              }}</template>
            </ElTableColumn>
            <ElTableColumn label="模板/目标" min-width="190">
              <template #default="{ row }">
                {{ row.request_payload?.templateCode || row.requestPayload?.templateCode || '-' }}
                <span class="muted">/ {{ row.target_type || row.targetType }}</span>
              </template>
            </ElTableColumn>
            <ElTableColumn label="操作人" width="130">
              <template #default="{ row }">{{
                row.operator_name || row.operatorName || row.operator || '-'
              }}</template>
            </ElTableColumn>
            <ElTableColumn label="结果" min-width="220">
              <template #default="{ row }">
                成功
                {{ row.result_payload?.committedRows ?? row.resultPayload?.committedRows ?? 0 }}，
                错误 {{ row.result_payload?.errorRows ?? row.resultPayload?.errorRows ?? 0 }}， 跳过
                {{ row.result_payload?.skippedRows ?? row.resultPayload?.skippedRows ?? 0 }}
              </template>
            </ElTableColumn>
            <ElTableColumn label="牛号" min-width="180">
              <template #default="{ row }">{{
                (row.cow_numbers || row.cowNumbers || []).slice(0, 6).join('、') || '-'
              }}</template>
            </ElTableColumn>
          </ElTable>
          <div v-if="auditRows.length > visibleAuditRows.length" class="load-more-row">
            <ElButton @click="() => loadMoreAuditRows()"
              >加载更多 {{ visibleAuditRows.length }}/{{ auditRows.length }}</ElButton
            >
          </div>
        </section>
      </ElTabPane>
    </ElTabs>
  </div>
</template>

<script setup lang="ts">
  import { computed, defineComponent, h, onMounted, reactive, ref, watch, type PropType } from 'vue'
  import { useRoute } from 'vue-router'
  import { ElButton, ElMessage, ElTable, ElTableColumn, ElTag } from 'element-plus'
  import { Delete, Download, Plus, Refresh, Search, Upload } from '@element-plus/icons-vue'
  import { useUserStore } from '@/store/modules/user'
  import CowNumberAutocomplete from '@/components/business/cow/CowNumberAutocomplete.vue'
  import {
    commitImportFile,
    commitImportRows,
    dryRunImportFile,
    dryRunImportRows,
    type ImportDryRunResult,
    type ImportProgressEvent
  } from '@/services/import-adapter'
  import { downloadImportErrorReport, getImportAudits } from '@/services/import-records'
  import {
    EVENT_OPTIONS,
    getImportTemplate,
    getImportTemplates,
    type ImportTemplate
  } from '@/services/import-templates'
  import { downloadImportTemplateWithDictionaries } from '@/services/import-template-dictionaries'
  import * as databaseService from '@/services/database'
  import { buildCowReferenceContext, type CowReferenceContext } from '@/utils/cow-reference'
  import { normalizePenCategory } from '@/utils/base-info-normalizers'
  import { useLazyGridRenderWindow, useLazyRenderWindow } from '@/hooks'
  import * as flexibleExport from '@/utils/flexible-export'
  import type { CustomField, ImportConfig } from '@/utils/flexible-export'
  import { formatDateOnly } from '@/utils/date-display'
  import { SUPPORTED_CATTLE_BREEDS, normalizeCattleBreed } from '@/utils/cattle-breeds'
  import {
    BODY_MEASUREMENT_TRAITS,
    DEFAULT_PHENOTYPE_TRAITS,
    type PhenotypeTraitDefinition
  } from '@/views/germplasm/phenotype/trait-definitions'
  import {
    baseInfoOptions,
    ensureBreedDictionary,
    ensureInformationEntryEventDictionary,
    ensureInformationEntryOptionDictionaries,
    ensureTransferReasonDictionary,
    entryFieldScope,
    getMilkShiftOptions,
    isEnabledStatus,
    normalizeTransferReasonOption,
    uniqueOptions,
    type InformationEntryEventOption,
    type SelectOption
  } from '@/services/platform-dictionary'

  interface CowSuggestion {
    value: string
    cowId: string
    cowNumber: string
    cowName: string
    earTagNumber: string
    currentPen: string
    currentPenName: string
    currentStage: string
    aliases: string[]
    searchText: string
  }

  type EventFieldType = 'select' | 'number' | 'date' | 'datetime' | 'text'
  type EventOptionSource =
    | 'cow'
    | 'pen'
    | 'breed'
    | 'medicine'
    | 'medicineBatch'
    | 'transferReason'
    | 'disease'
    | 'medicineUnit'
    | 'vaccine'
    | 'operator'
    | 'trait'

  interface EventField {
    key: string
    label: string
    type: EventFieldType
    options?: string[]
    optionSource?: EventOptionSource
    min?: number
    step?: number
    placeholder?: string
    allowCreate?: boolean
    required?: boolean
    sortOrder?: number
    traitCode?: string
    traitName?: string
    unit?: string
  }

  interface CalfEntryRow {
    cowNumber: string
    sex: string
    earTagNumber: string
    remark: string
  }

  interface RecentSingleEntryRecord {
    id: string
    cowNumber: string
    eventCode: string
    eventGroup: string
    eventName: string
    occurredAt: string
    operatorName: string
    sortTime: number
    sourceTable: string
  }

  const userStore = useUserStore()
  const route = useRoute()
  const activeTab = ref('single')
  const templates = getImportTemplates()
  const {
    containerRef: templateGridContainerRef,
    visibleItems: visibleTemplates,
    loadMore: loadMoreTemplates,
    handleScroll: onTemplateScroll,
    handleWheel: onTemplateWheel
  } = useLazyGridRenderWindow(templates, {
    rowCount: 2,
    minItemWidth: 240,
    gap: 12,
    fallbackColumns: 3,
    mode: 'fixed-window'
  })
  const selectedTemplateCode = ref('animal-event')
  const selectedImportConfigId = ref('')
  const importConfigs = ref<ImportConfig[]>([])
  const selectedFile = ref<File | null>(null)
  const latestResult = ref<ImportDryRunResult | null>(null)
  const auditRows = ref<any[]>([])
  const {
    visibleItems: visibleAuditRows,
    loadMore: loadMoreAuditRows,
    handleWheel: onAuditTableWheel
  } = useLazyRenderWindow(auditRows, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })
  const checking = ref(false)
  const committing = ref(false)
  const importProgress = ref<ImportProgressEvent | null>(null)
  const importProgressState = ref<'idle' | 'active' | 'success' | 'exception'>('idle')
  const cowOptions = ref<CowSuggestion[]>([])
  const operatorOptions = ref<SelectOption[]>([])
  const penOptions = ref<SelectOption[]>([])
  const breedOptions = ref<SelectOption[]>([])
  const medicineOptions = ref<SelectOption[]>([])
  const medicineBatchOptions = ref<SelectOption[]>([])
  const transferReasonOptions = ref<SelectOption[]>([])
  const diseaseOptions = ref<SelectOption[]>([])
  const medicineUnitOptions = ref<SelectOption[]>([])
  const vaccineOptions = ref<SelectOption[]>([])
  const phenotypeTraits = ref<PhenotypeTraitDefinition[]>([])
  const bodyMeasurementTraits = ref<PhenotypeTraitDefinition[]>([])
  const entryEventOptions = ref<InformationEntryEventOption[]>(
    EVENT_OPTIONS.map((item) => ({ ...item }))
  )
  const entryFieldRows = ref<CustomField[]>([])
  const parityEpisodeRows = ref<any[]>([])
  const parityEventRows = ref<any[]>([])
  const calfRows = reactive<CalfEntryRow[]>([])
  const recentSingleRecords = ref<RecentSingleEntryRecord[]>([])
  const recentSingleRenderCount = ref(10)
  const RECENT_SINGLE_ENTRY_PAGE_SIZE = 10

  const SYSTEM_CONTROLLED_FIELD_KEYS = new Set([
    'parity',
    'parityNo',
    'parity_no',
    'lactationNo',
    'lactation_no',
    'daysInMilk',
    'days_in_milk',
    'DIM',
    'dim',
    'insemination_no',
    'inseminationNo',
    'insemination_count',
    'inseminationCount',
    'current_pen',
    'currentPen',
    'current_pen_code',
    'currentPenCode',
    'current_unit_id',
    'currentUnitId',
    'current_unit_code',
    'currentUnitCode',
    '本胎输精次数',
    '系统胎次',
    '当前圈舍'
  ])

  const isInformationEntryRoute = computed(() => {
    const activePath = String(route.meta.activePath || '')
    return (
      route.path.startsWith('/information-entry') ||
      route.path.startsWith('/event-entry') ||
      activePath.startsWith('/information-entry')
    )
  })
  const pageTitle = computed(() =>
    isInformationEntryRoute.value ? entryRouteTitle.value : '信息导入'
  )
  const pageDescription = computed(() => '')
  const singleSectionEyebrow = computed(() =>
    isInformationEntryRoute.value ? '现场录入' : '单条导入'
  )
  const singleSectionTitle = computed(() =>
    isInformationEntryRoute.value ? '事件记录' : '事件适配'
  )

  const todayInput = () => new Date().toISOString().slice(0, 10)
  const singleForm = reactive({
    eventGroup: '繁殖',
    eventType: 'insemination',
    animalNumber: '',
    cowId: '',
    occurredAt: todayInput(),
    operatorId: '',
    operatorName: operatorName(),
    eventName: '输精/配种',
    severity: '正常',
    eventStatus: '已记录',
    notes: ''
  })
  const eventDynamicForm = reactive<Record<string, any>>({})

  const selectedTemplate = computed(() => getImportTemplate(selectedTemplateCode.value))
  const batchProgressVisible = computed(
    () => checking.value || committing.value || importProgressState.value !== 'idle'
  )
  const importProgressPercent = computed(() =>
    Math.max(0, Math.min(100, Math.round(Number(importProgress.value?.percent || 0))))
  )
  const importProgressMessage = computed(() => importProgress.value?.message || '等待开始')
  const importProgressTable = computed(() => importProgress.value?.tableName || '')
  const importProgressStageLabel = computed(() => {
    const labels: Record<string, string> = {
      read_file: '读取文件',
      prepare: '准备数据',
      parse: '解析映射',
      validate: '预检校验',
      commit: '生成记录',
      flush: '写入数据库',
      audit: '审计留痕',
      done: '完成',
      error: '失败'
    }
    return labels[importProgress.value?.stage || ''] || '导入进度'
  })
  const importProgressStatus = computed(() => {
    if (importProgressState.value === 'success') return 'success'
    if (importProgressState.value === 'exception') return 'exception'
    return undefined
  })
  const importProgressTagType = computed(() => {
    if (importProgressState.value === 'success') return 'success'
    if (importProgressState.value === 'exception') return 'danger'
    return committing.value ? 'warning' : 'info'
  })
  const importProgressDetail = computed(() => {
    const current = importProgress.value?.current
    const total = importProgress.value?.total
    if (typeof current === 'number' && typeof total === 'number' && total > 0) {
      return `进度 ${current}/${total}`
    }
    if (selectedFile.value) return selectedFile.value.name
    return '未选择文件'
  })
  function previewTemplateFieldGroups(template: ImportTemplate) {
    const groups = new Map<string, string[]>()
    template.columns.forEach((column) => {
      const section = column.section || '其他字段'
      if (!groups.has(section)) groups.set(section, [])
      groups.get(section)!.push(column.label)
    })
    const order = [
      '牛只身份',
      '系谱关系',
      '生产周期',
      '测量与性状',
      '事件业务',
      '样本与组学',
      '设备与传感器',
      '采集与追溯',
      '其他字段'
    ]
    return order
      .filter((section) => groups.has(section))
      .map((section) => {
        const labels = groups.get(section)!
        const visibleLabels = labels.slice(0, 4)
        return {
          section,
          labels:
            labels.length > visibleLabels.length
              ? [...visibleLabels, `等${labels.length}项`]
              : visibleLabels
        }
      })
  }
  const filteredImportConfigs = computed(() => {
    return importConfigs.value.filter((config) =>
      configMatchesTemplate(config, selectedTemplateCode.value)
    )
  })
  const eventGroups = computed(() =>
    Array.from(new Set(entryEventOptions.value.map((item) => item.group))).map((group) => ({
      group
    }))
  )
  const selectedEventGroup = computed(() => singleForm.eventGroup)
  const filteredEvents = computed(() =>
    entryEventOptions.value.filter((item) => item.group === singleForm.eventGroup)
  )
  const currentEvent = computed(() =>
    entryEventOptions.value.find((item) => item.code === singleForm.eventType)
  )
  const animalNumberLabel = computed(() => (singleForm.eventType === 'entry' ? '新牛号' : '牛号'))
  const animalNumberPlaceholder = computed(() =>
    singleForm.eventType === 'entry'
      ? '填写新牛号；也可输入耳号检查是否已存在'
      : '输入牛号、个体编号或耳号'
  )
  const entryRouteTitle = computed(() => {
    if (route.meta.eventType && currentEvent.value?.label) return `${currentEvent.value.label}录入`
    return entryTitleByGroup(singleForm.eventGroup)
  })
  const severityOptions = ref<SelectOption[]>([])
  const eventStatusOptions = ref<SelectOption[]>([])
  const calfSexOptions = ref<SelectOption[]>([])
  const milkShiftOptions = ref<SelectOption[]>([
    { label: '早班', value: '早班', name: '早班' },
    { label: '中班', value: '中班', name: '中班' },
    { label: '晚班', value: '晚班', name: '晚班' },
    { label: '夜班', value: '夜班', name: '夜班' },
    { label: '半夜班', value: '半夜班', name: '半夜班' },
    { label: '1', value: '1', name: '1' },
    { label: '2', value: '2', name: '2' },
    { label: '3', value: '3', name: '3' },
    { label: '4', value: '4', name: '4' }
  ])
  const activeEventFields = computed(() => eventFieldsFor(singleForm.eventType))
  const activeEventFieldKeys = computed(
    () => new Set(activeEventFields.value.map((field) => field.key))
  )
  const currentCowSuggestion = computed(() =>
    findCowSuggestion(singleForm.cowId || singleForm.animalNumber)
  )
  const isMovementEvent = computed(() =>
    ['entry', 'transfer', 'exit'].includes(singleForm.eventType)
  )
  const showSeverityField = computed(() => severityManagedEventTypes.has(singleForm.eventType))
  const movementCurrentPenText = computed(() => {
    if (singleForm.eventType === 'entry') return '无圈舍'
    return currentCowSuggestion.value?.currentPen || '未匹配当前圈舍'
  })
  const derivedParity = computed(() => deriveParityForEntry())
  const derivedParityText = computed(() => {
    if (!singleForm.animalNumber) return '选择牛号后自动推导'
    if (!singleForm.occurredAt) return '选择发生时间后自动推导'
    if (derivedParity.value?.parityNo) {
      return `${derivedParity.value.prefix || '第'} ${derivedParity.value.parityNo} 胎${derivedParity.value.note ? ` · ${derivedParity.value.note}` : ''}`
    }
    return '未进入产犊胎次周期'
  })
  const currentParityInseminationText = computed(() => {
    if (singleForm.eventType !== 'insemination') return ''
    const count = countInseminationsInCurrentParity()
    if (!singleForm.animalNumber) return '选择牛号后自动统计'
    if (!derivedParity.value?.parityNo) return '未进入胎次周期，暂不统计'
    return `本胎已记录 ${count} 次；本次提交后为 ${count + 1} 次`
  })
  const filteredRecentSingleRecords = computed(() => {
    const eventCode = textValue(singleForm.eventType)
    const eventGroup = textValue(singleForm.eventGroup)
    return recentSingleRecords.value.filter((row) => {
      const codeMatched = !eventCode || row.eventCode === eventCode
      const groupMatched = !eventGroup || !row.eventGroup || row.eventGroup === eventGroup
      return codeMatched && groupMatched
    })
  })
  const visibleRecentSingleRecords = computed(() =>
    filteredRecentSingleRecords.value.slice(0, recentSingleRenderCount.value)
  )
  const hasMoreRecentSingleRecords = computed(
    () => visibleRecentSingleRecords.value.length < filteredRecentSingleRecords.value.length
  )
  const previewColumns = computed(() =>
    Array.from(
      new Set((latestResult.value?.previewRows || []).flatMap((row) => Object.keys(row)))
    ).slice(0, 18)
  )
  const previewSourceRows = computed(() => latestResult.value?.previewRows || [])
  const {
    visibleItems: visiblePreviewRows,
    handleScroll: onPreviewScroll,
    handleWheel: onPreviewWheel
  } = useLazyRenderWindow(previewSourceRows, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })

  const severityManagedEventTypes = new Set([
    'diagnosis',
    'treatment',
    'medication',
    'vaccination',
    'deworming',
    'quarantine',
    'disinfection',
    'lab_test',
    'hoof_trim',
    'mastitis_check',
    'death',
    'sensor_alert'
  ])

  function operatorName() {
    const info: any = userStore.getUserInfo || {}
    return (
      textValue(
        info.realName || info.nickname || info.userName || info.username || info.name || info.userId
      ) || '当前用户'
    )
  }

  function operatorId() {
    const info: any = userStore.getUserInfo || {}
    return (
      textValue(
        info.userId ||
          info.id ||
          info.personId ||
          info.person_id ||
          info.userName ||
          info.username ||
          info.name
      ) || `current:${operatorName()}`
    )
  }

  function currentOperatorOption(): SelectOption {
    const name = operatorName()
    return { label: name, value: operatorId(), name }
  }

  function toOptions(values: string[]): SelectOption[] {
    return values.map((value) => ({ label: value, value, name: value }))
  }

  function entryTitleByGroup(group: string) {
    const map: Record<string, string> = {
      生产: '生产录入',
      繁殖: '繁殖录入',
      健康: '健康录入',
      转群: '转群录入',
      采样: '采样录入',
      设备: '设备录入',
      育种科研: '育种科研录入'
    }
    return map[group] || '信息录入'
  }

  const EVENT_FIELD_PRESETS = {
    get shift() {
      return milkShiftOptions.value.map((item) => item.value)
    },
    milkQuality: ['正常', '复核', '异常', '剔除'],
    feedType: ['全混合日粮', '青贮', '精料', '粗饲料', '补饲', '饮水'],
    feedReason: ['日常投喂', '配方调整', '采食下降', '产奶变化', '阶段转换'],
    breed: [...SUPPORTED_CATTLE_BREEDS],
    measureMethod: ['人工测定', '称重栏', '体尺尺', '影像测量', '传感器'],
    dryReason: ['预产期前停产', '产奶下降', '健康调整', '治疗需要'],
    heatIntensity: ['弱', '中', '强'],
    heatSign: ['爬跨', '黏液', '活动量升高', '外阴红肿', '食欲下降'],
    semenMethod: ['人工授精', '自然交配', '胚胎移植', '同期发情后输精'],
    pregnancyResult: ['阴性', '阳性'],
    pregnancyMethod: ['直肠检查', 'B超', '血检', '乳样孕检'],
    calvingResult: ['顺产', '助产', '难产', '死胎'],
    calfSex: ['公', '母', '双胎公母', '双胎公', '双胎母'],
    abortionReason: ['早期流产', '外伤', '疾病', '营养应激', '原因待查'],
    embryoStage: ['桑椹胚', '早期囊胚', '扩张囊胚', '孵化囊胚'],
    diagnosis: ['乳房炎', '蹄病', '消化道疾病', '呼吸道疾病', '产后疾病', '皮肤损伤', '其他'],
    treatmentPlan: ['观察', '局部处理', '抗感染治疗', '补液', '隔离治疗', '复诊'],
    doseUnit: ['mL', 'mg', 'g', 'IU', '头份'],
    route: ['肌肉注射', '皮下注射', '静脉注射', '口服', '乳房灌注', '外用'],
    vaccine: ['口蹄疫疫苗', '布病疫苗', '巴氏杆菌疫苗', '梭菌疫苗', '其他疫苗'],
    labTest: ['血常规', '生化', '病原检测', '药敏', '乳样检测', '粪检'],
    targetStage: ['犊牛', '育成', '育肥', '公牛', '泌乳', '干奶', '待产', '隔离', '淘汰'],
    sampleType: ['血液', '乳样', '毛囊', '组织', '粪样'],
    sampleStatus: ['已入库', '待检测', '检测中', '已检测', '已废弃'],
    tissue: ['颈静脉血', '乳汁', '尾根毛囊', '耳组织', '粪便'],
    deviceType: ['奶厅', '项圈', '耳标', '称重栏', '环境传感器'],
    alertLevel: ['提示', '关注', '严重', '已恢复'],
    deviceAction: ['绑定', '解绑', '维修', '校准', '更换电池', '停用'],
    omicsType: ['SNP', 'WGS', 'RNA-seq', '代谢组', '蛋白组', '微生物组'],
    markerType: ['SNP', 'Indel', 'SV', 'gene', 'metabolite', 'protein', 'pathway'],
    researchStage: ['采样', '建库', '测序', '质控', '分析', '结果复核', '归档']
  }

  function field(
    key: string,
    label: string,
    type: EventFieldType,
    input: Partial<EventField> = {}
  ): EventField {
    return { key, label, type, ...input }
  }

  function commonProductionFields(type: string): EventField[] {
    if (['milking', 'milking_session'].includes(type)) {
      const traitFields = traitFieldsForEvent(type)
      if (traitFields.length) {
        return [
          field('session_code', '采奶班次', 'select', { options: EVENT_FIELD_PRESETS.shift }),
          ...traitFields,
          field('quality_flag', '质量标记', 'select', { options: EVENT_FIELD_PRESETS.milkQuality })
        ]
      }
      return [
        field('session_code', '采奶班次', 'select', { options: EVENT_FIELD_PRESETS.shift }),
        field('milk_yield', '产奶量 kg', 'number', { min: 0, step: 0.1 }),
        field('quality_flag', '质量标记', 'select', { options: EVENT_FIELD_PRESETS.milkQuality })
      ]
    }
    if (['milk_quality', 'dhi_test'].includes(type)) {
      const traitFields = traitFieldsForEvent(type)
      if (traitFields.length) {
        return [
          ...traitFields,
          field('quality_flag', '质量标记', 'select', { options: EVENT_FIELD_PRESETS.milkQuality })
        ]
      }
      return [
        field('fat_percent', '乳脂率 %', 'number', { min: 0, step: 0.1 }),
        field('protein_percent', '乳蛋白率 %', 'number', { min: 0, step: 0.1 }),
        field('somatic_cell_count', '体细胞数', 'number', { min: 0, step: 1000 }),
        field('quality_flag', '质量标记', 'select', { options: EVENT_FIELD_PRESETS.milkQuality })
      ]
    }
    if (['feeding', 'feed_delivery', 'feed_adjustment'].includes(type)) {
      return [
        field('feed_type', '饲喂类型', 'select', { options: EVENT_FIELD_PRESETS.feedType }),
        field('feed_amount', '投料量 kg', 'number', { min: 0, step: 0.5 }),
        field('feed_reason', '调整原因', 'select', { options: EVENT_FIELD_PRESETS.feedReason })
      ]
    }
    if (type === 'weighing') {
      const traitFields = traitFieldsForEvent(type)
      return [
        ...(traitFields.length
          ? traitFields
          : [field('body_weight', '体重 kg', 'number', { min: 0, step: 1 })]),
        field('measure_method', '测定方式', 'select', {
          options: EVENT_FIELD_PRESETS.measureMethod
        })
      ]
    }
    if (type === 'body_measurement') {
      return [
        ...bodyMeasurementEventFields(),
        field('measure_method', '测定方式', 'select', {
          options: EVENT_FIELD_PRESETS.measureMethod
        })
      ]
    }
    if (type === 'dry_off')
      return [
        field('dry_off_date', '停产日期', 'date'),
        field('dry_reason', '停产原因', 'select', { options: EVENT_FIELD_PRESETS.dryReason }),
        field('target_stage', '目标阶段', 'select', { options: ['干奶', '待产', '淘汰'] })
      ]
    return []
  }

  function traitFieldsForEvent(type: string): EventField[] {
    const rows = phenotypeTraits.value.filter((trait) => {
      if (trait.status !== '启用' || trait.dataType !== '数值') return false
      const category = textValue(trait.category)
      const source = textValue(trait.source)
      const name = textValue(trait.name)
      const code = textValue(trait.code)
      if (['milking', 'milking_session', 'milk_quality', 'dhi_test'].includes(type)) {
        return (
          category.includes('泌乳') ||
          source === '奶厅导入' ||
          /milk|乳|奶|体细胞|DHI/i.test(`${code} ${name}`)
        )
      }
      if (type === 'weighing')
        return category.includes('体重') || /weight|体重/i.test(`${code} ${name}`)
      if (type === 'body_measurement') return isBodyMeasurementTrait(trait)
      return false
    })
    return rows.map((trait) => {
      const unit = textValue(trait.unit)
      return field(
        traitFieldKey(trait.code),
        unit ? `${trait.name} ${unit}` : trait.name,
        'number',
        {
          min: 0,
          step: unit === 'kg' ? 1 : 0.5,
          traitCode: trait.code,
          traitName: trait.name,
          unit
        }
      )
    })
  }

  function bodyMeasurementEventFields(): EventField[] {
    const rows = bodyMeasurementTraits.value.length
      ? bodyMeasurementTraits.value
      : phenotypeTraits.value.filter(
          (trait) => isBodyMeasurementTrait(trait) && trait.status === '启用'
        )
    const finalRows = rows.length ? rows : BODY_MEASUREMENT_TRAITS
    return finalRows
      .filter((trait) => trait.status === '启用')
      .map((trait) => {
        const unit = textValue(trait.unit)
        return field(
          traitFieldKey(trait.code),
          unit ? `${trait.name} ${unit}` : trait.name,
          'number',
          {
            min: 0,
            step: unit === 'kg' ? 1 : 0.5,
            traitCode: trait.code,
            traitName: trait.name,
            unit
          }
        )
      })
  }

  function reproductionFields(type: string): EventField[] {
    if (type === 'heat')
      return [
        field('heat_intensity', '发情强度', 'select', {
          options: EVENT_FIELD_PRESETS.heatIntensity
        }),
        field('observed_sign', '观察表现', 'select', { options: EVENT_FIELD_PRESETS.heatSign })
      ]
    if (type === 'insemination') {
      return [
        field('bull_number', '公牛号', 'select', {
          optionSource: 'cow',
          allowCreate: true,
          required: true
        }),
        field('semen_batch', '精液批号', 'select', {
          options: ['冻精批次 A', '冻精批次 B', '冻精批次 C'],
          allowCreate: true
        }),
        field('insemination_method', '配种方式', 'select', {
          options: EVENT_FIELD_PRESETS.semenMethod,
          required: true
        })
      ]
    }
    if (type === 'pregnancy_check')
      return [
        field('pregnancy_result', '妊检结果', 'select', {
          options: EVENT_FIELD_PRESETS.pregnancyResult,
          required: true
        }),
        field('check_method', '妊检方式', 'select', {
          options: EVENT_FIELD_PRESETS.pregnancyMethod,
          required: true
        })
      ]
    if (type === 'calving') {
      return [
        field('calving_result', '产犊结果', 'select', {
          options: EVENT_FIELD_PRESETS.calvingResult,
          required: true
        }),
        field('calf_count', '犊牛数', 'number', { min: 1, step: 1, required: true }),
        field('father_number', '父号/公牛号', 'select', {
          optionSource: 'cow',
          allowCreate: true,
          placeholder: '可留空，系统优先按最近输精记录推导'
        })
      ]
    }
    if (type === 'abortion')
      return [
        field('abortion_reason', '流产原因', 'select', {
          options: EVENT_FIELD_PRESETS.abortionReason
        })
      ]
    if (type === 'postpartum_check')
      return [
        field('check_result', '检查结果', 'select', {
          options: ['正常', '需复查', '感染风险', '产后恢复差']
        })
      ]
    if (type === 'embryo_transfer')
      return [
        field('embryo_stage', '胚胎阶段', 'select', { options: EVENT_FIELD_PRESETS.embryoStage }),
        field('donor_number', '供体牛号', 'select', { optionSource: 'cow' })
      ]
    return []
  }

  function healthFields(type: string): EventField[] {
    if (type === 'diagnosis')
      return [
        field('diagnosis_name', '诊断', 'select', { optionSource: 'disease' }),
        field('treatment_plan', '处置方案', 'select', {
          options: EVENT_FIELD_PRESETS.treatmentPlan
        })
      ]
    if (['treatment', 'medication'].includes(type)) {
      return [
        field('diagnosis_name', '诊断', 'select', { optionSource: 'disease' }),
        field('medicine_code', '药品', 'select', { optionSource: 'medicine' }),
        field('medicine_batch_no', '药品批号', 'select', { optionSource: 'medicineBatch' }),
        field('dose', '剂量', 'number', { min: 0, step: 0.5 }),
        field('dose_unit', '剂量单位', 'select', { optionSource: 'medicineUnit' }),
        field('route', '给药方式', 'select', { options: EVENT_FIELD_PRESETS.route }),
        field('withdrawal_days', '休药天数', 'number', { min: 0, step: 1 })
      ]
    }
    if (type === 'vaccination')
      return [
        field('vaccine_name', '疫苗', 'select', { optionSource: 'vaccine' }),
        field('medicine_batch_no', '批号', 'select', { optionSource: 'medicineBatch' }),
        field('dose', '剂量', 'number', { min: 0, step: 0.5 }),
        field('route', '接种方式', 'select', { options: EVENT_FIELD_PRESETS.route })
      ]
    if (type === 'deworming')
      return [
        field('medicine_code', '驱虫药', 'select', { optionSource: 'medicine' }),
        field('dose', '剂量', 'number', { min: 0, step: 0.5 }),
        field('dose_unit', '剂量单位', 'select', { optionSource: 'medicineUnit' })
      ]
    if (['quarantine', 'disinfection'].includes(type))
      return [
        field('target_unit_code', '目标区域', 'select', { optionSource: 'pen' }),
        field('treatment_plan', '处置方式', 'select', {
          options: EVENT_FIELD_PRESETS.treatmentPlan
        })
      ]
    if (type === 'lab_test')
      return [
        field('lab_test_type', '检测项目', 'select', { options: EVENT_FIELD_PRESETS.labTest }),
        field('check_result', '检测结果', 'select', {
          options: ['正常', '异常', '阳性', '阴性', '待复核']
        })
      ]
    if (type === 'hoof_trim')
      return [
        field('check_result', '修蹄结果', 'select', {
          options: ['正常修蹄', '发现蹄病', '复查', '隔离处理']
        })
      ]
    if (type === 'mastitis_check')
      return [
        field('check_result', '乳房炎检查', 'select', { options: ['阴性', '疑似', '阳性', '复查'] })
      ]
    if (type === 'death')
      return [
        field('death_reason', '死亡原因', 'select', {
          options: ['疾病', '难产', '意外', '淘汰处置', '原因待查']
        })
      ]
    return []
  }

  function movementFields(type: string): EventField[] {
    if (type === 'entry') {
      return [
        field('ear_tag_number', '耳号', 'text'),
        field('sex', '性别', 'select', { options: ['母', '公'] }),
        field('breed', '品种', 'select', { optionSource: 'breed' }),
        field('birth_date', '出生日期', 'date'),
        field('father_number', '父号', 'select', {
          optionSource: 'cow',
          allowCreate: true,
          placeholder: '可选择本场牛，也可填写外部父号'
        }),
        field('mother_number', '母号', 'select', {
          optionSource: 'cow',
          allowCreate: true,
          placeholder: '可选择本场牛，也可填写外部母号'
        }),
        field('to_unit_code', '目标圈舍', 'select', { optionSource: 'pen', required: true }),
        field('movement_reason', '入群原因', 'select', {
          optionSource: 'transferReason',
          required: true
        }),
        field('target_stage', '进入阶段', 'select', { options: EVENT_FIELD_PRESETS.targetStage })
      ]
    }
    if (type === 'transfer')
      return [
        field('to_unit_code', '目标圈舍', 'select', { optionSource: 'pen', required: true }),
        field('movement_reason', '转群原因', 'select', {
          optionSource: 'transferReason',
          required: true
        })
      ]
    if (type === 'exit')
      return [
        field('movement_reason', '离群原因', 'select', {
          optionSource: 'transferReason',
          required: true
        }),
        field('target_stage', '离群去向', 'select', {
          options: ['淘汰', '出售', '死亡', '转场', '其他']
        })
      ]
    return []
  }

  function defaultEventFieldsFor(type: string): EventField[] {
    if (
      [
        'milking',
        'milking_session',
        'milk_quality',
        'dhi_test',
        'feeding',
        'feed_delivery',
        'feed_adjustment',
        'weighing',
        'body_measurement',
        'dry_off'
      ].includes(type)
    )
      return commonProductionFields(type)
    if (
      [
        'heat',
        'insemination',
        'pregnancy_check',
        'calving',
        'abortion',
        'postpartum_check',
        'embryo_transfer'
      ].includes(type)
    )
      return reproductionFields(type)
    if (
      [
        'diagnosis',
        'treatment',
        'medication',
        'vaccination',
        'deworming',
        'quarantine',
        'disinfection',
        'lab_test',
        'hoof_trim',
        'mastitis_check',
        'death'
      ].includes(type)
    )
      return healthFields(type)
    if (['entry', 'transfer', 'exit'].includes(type)) return movementFields(type)
    if (type === 'sample_collection')
      return [
        field('sample_type', '样本类型', 'select', { options: EVENT_FIELD_PRESETS.sampleType }),
        field('sample_status', '样本状态', 'select', { options: EVENT_FIELD_PRESETS.sampleStatus }),
        field('source_tissue', '样本来源', 'select', { options: EVENT_FIELD_PRESETS.tissue })
      ]
    if (
      ['sensor_alert', 'device_maintenance', 'device_assignment', 'device_unassignment'].includes(
        type
      )
    )
      return [
        field('device_type', '设备类型', 'select', { options: EVENT_FIELD_PRESETS.deviceType }),
        field('alert_level', '告警级别', 'select', { options: EVENT_FIELD_PRESETS.alertLevel }),
        field('device_action', '设备动作', 'select', { options: EVENT_FIELD_PRESETS.deviceAction })
      ]
    if (
      [
        'mating_plan',
        'semen_check',
        'genotyping',
        'sequencing',
        'omics_assay',
        'breeding_value_run',
        'selection_index_update'
      ].includes(type)
    )
      return [
        field('omics_type', '组学类型', 'select', { options: EVENT_FIELD_PRESETS.omicsType }),
        field('marker_type', '标记类型', 'select', { options: EVENT_FIELD_PRESETS.markerType }),
        field('research_stage', '科研阶段', 'select', {
          options: EVENT_FIELD_PRESETS.researchStage
        })
      ]
    return []
  }

  function eventFieldsFor(type: string): EventField[] {
    const scope = entryFieldScope(type)
    const scopedRows = entryFieldRows.value.filter((row) => row.scope === scope)
    const dictionaryFields = scopedRows
      .filter((row: any) => row.isActive !== false)
      .sort((left, right) => (left.sortOrder || 0) - (right.sortOrder || 0))
      .map((row) => customFieldToEventField(row))
      .filter((fieldConfig) => !isSystemControlledField(fieldConfig))
    const defaultFields = defaultEventFieldsFor(type)

    if (type === 'body_measurement') {
      const bodyTraitFields = bodyMeasurementEventFields()
      const nonTraitFields = scopedRows.length
        ? mergeEventFields(
            defaultFields.filter((item) => !item.traitCode),
            dictionaryFields.filter((item) => !item.traitCode)
          )
        : defaultFields.filter((item) => !item.traitCode)
      return mergeEventFields(bodyTraitFields, nonTraitFields)
    }

    return scopedRows.length ? mergeEventFields(defaultFields, dictionaryFields) : defaultFields
  }

  function mergeEventFields(baseFields: EventField[], dictionaryFields: EventField[]) {
    const merged: EventField[] = []
    const indexByKey = new Map<string, number>()
    const indexByLabel = new Map<string, number>()
    const remember = (fieldConfig: EventField, index: number) => {
      indexByKey.set(fieldIdentity(fieldConfig.key), index)
      indexByLabel.set(fieldIdentity(fieldConfig.label), index)
    }

    baseFields.forEach((fieldConfig) => {
      if (isSystemControlledField(fieldConfig)) return
      const index = merged.length
      merged.push(fieldConfig)
      remember(fieldConfig, index)
    })

    dictionaryFields.forEach((fieldConfig) => {
      if (isSystemControlledField(fieldConfig)) return
      const matchIndex =
        indexByKey.get(fieldIdentity(fieldConfig.key)) ??
        indexByLabel.get(fieldIdentity(fieldConfig.label))
      if (matchIndex !== undefined) {
        merged[matchIndex] = mergeEventFieldConfig(merged[matchIndex], fieldConfig)
        remember(merged[matchIndex], matchIndex)
        return
      }
      const index = merged.length
      merged.push(fieldConfig)
      remember(fieldConfig, index)
    })

    return merged
  }

  function mergeEventFieldConfig(baseField: EventField, dictionaryField: EventField): EventField {
    return {
      ...baseField,
      label: dictionaryField.label || baseField.label,
      placeholder: dictionaryField.placeholder || baseField.placeholder,
      required: dictionaryField.required ?? baseField.required,
      sortOrder: dictionaryField.sortOrder ?? baseField.sortOrder,
      options: dictionaryField.options?.length ? dictionaryField.options : baseField.options,
      optionSource: dictionaryField.optionSource || baseField.optionSource,
      allowCreate: dictionaryField.allowCreate ?? baseField.allowCreate,
      min: dictionaryField.min ?? baseField.min,
      step: dictionaryField.step ?? baseField.step,
      traitCode: baseField.traitCode || dictionaryField.traitCode,
      traitName: baseField.traitName || dictionaryField.traitName,
      unit: baseField.unit || dictionaryField.unit
    }
  }

  function fieldIdentity(value: unknown) {
    return textValue(value).toLowerCase().replace(/\s+/g, '')
  }

  function isSystemControlledField(fieldConfig: EventField) {
    const key = textValue(fieldConfig.key)
    const label = textValue(fieldConfig.label)
    return SYSTEM_CONTROLLED_FIELD_KEYS.has(key) || SYSTEM_CONTROLLED_FIELD_KEYS.has(label)
  }

  function customFieldToEventField(row: CustomField): EventField {
    const rawType = textValue(row.type)
    const type =
      rawType === 'datetime'
        ? 'datetime'
        : rawType === 'date'
          ? 'date'
          : rawType === 'number'
            ? 'number'
            : ['select', 'boolean'].includes(rawType)
              ? 'select'
              : 'text'
    return field(row.fieldName, row.label, type as EventFieldType, {
      options: row.type === 'boolean' ? ['是', '否'] : normalizeFieldOptions(row),
      optionSource: row.optionSource as EventOptionSource,
      min: row.min,
      step: row.step,
      placeholder: row.placeholder,
      allowCreate: row.allowCreate,
      required: row.required,
      sortOrder: row.sortOrder,
      traitCode: row.traitCode,
      traitName: row.traitName,
      unit: row.unit
    })
  }

  function normalizeFieldOptions(row: CustomField) {
    if (Array.isArray(row.options)) return row.options.map(textValue).filter(Boolean)
    return textValue(row.optionsText)
      .split(/[，,;；]/)
      .map(textValue)
      .filter(Boolean)
  }

  function syncDynamicFormWithActiveFields() {
    const keys = activeEventFieldKeys.value
    Object.keys(eventDynamicForm).forEach((key) => {
      if (!keys.has(key)) delete eventDynamicForm[key]
    })
    activeEventFields.value.forEach((fieldConfig) => {
      if (eventDynamicForm[fieldConfig.key] !== undefined) return
      if (singleForm.eventType === 'dry_off' && fieldConfig.key === 'dry_off_date') {
        eventDynamicForm[fieldConfig.key] = textValue(singleForm.occurredAt).slice(0, 10)
        return
      }
      if (singleForm.eventType === 'dry_off' && fieldConfig.key === 'target_stage') {
        eventDynamicForm[fieldConfig.key] = '干奶'
        return
      }
      if (fieldConfig.options?.length) eventDynamicForm[fieldConfig.key] = fieldConfig.options[0]
    })
  }

  function fieldSelectOptions(fieldConfig: EventField): SelectOption[] {
    if (fieldConfig.optionSource === 'cow') {
      return cowOptionsForField(fieldConfig.key).map((cow) => ({
        label: [cow.cowNumber, cow.earTagNumber, cow.currentStage].filter(Boolean).join(' / '),
        value: cow.cowNumber,
        name: cow.cowNumber
      }))
    }
    if (fieldConfig.optionSource === 'pen') return penOptions.value
    if (fieldConfig.optionSource === 'breed') return breedOptions.value
    if (fieldConfig.optionSource === 'medicine') return medicineOptions.value
    if (fieldConfig.optionSource === 'medicineBatch') return medicineBatchOptions.value
    if (fieldConfig.optionSource === 'medicineUnit') return medicineUnitOptions.value
    if (fieldConfig.optionSource === 'vaccine') return vaccineOptions.value
    if (fieldConfig.optionSource === 'operator') return operatorOptions.value
    if (fieldConfig.optionSource === 'transferReason')
      return transferReasonOptionsForEvent(singleForm.eventType)
    if (fieldConfig.optionSource === 'disease') return diseaseOptions.value
    if (fieldConfig.optionSource === 'trait') {
      return bodyMeasurementTraits.value.map((trait) => ({
        label: `${trait.name}${trait.unit ? ` / ${trait.unit}` : ''}`,
        value: trait.code,
        name: trait.name
      }))
    }
    return toOptions(fieldConfig.options || [])
  }

  function cowOptionsForField(fieldKey: string) {
    const key = textValue(fieldKey)
    const sexMatcher =
      key.includes('bull') ||
      key.includes('father') ||
      key.includes('sire') ||
      key.includes('donor')
        ? (cow: CowSuggestion) => isMaleCow(cow)
        : key.includes('mother') || key.includes('dam') || key.includes('donor')
          ? (cow: CowSuggestion) => isFemaleCow(cow)
          : null
    if (!sexMatcher) return cowOptions.value
    const matched = cowOptions.value.filter(sexMatcher)
    return matched.length ? matched : cowOptions.value
  }

  function isMaleCow(cow: CowSuggestion) {
    const text = `${cow.currentStage} ${cow.searchText}`.toLowerCase()
    return /公|bull|male|种公/.test(text) && !/母|female/.test(text)
  }

  function isFemaleCow(cow: CowSuggestion) {
    const text = `${cow.currentStage} ${cow.searchText}`.toLowerCase()
    return /母|cow|female/.test(text) && !/公|bull|male/.test(text)
  }

  function transferReasonOptionsForEvent(eventType: string) {
    const activeOptions = transferReasonOptions.value.filter((item) => item.meta?.status !== '停用')
    const matched = activeOptions.filter((item) => transferReasonAppliesToEvent(item, eventType))
    if (['entry', 'transfer', 'exit'].includes(eventType)) {
      return matched
    }
    return matched.length ? matched : activeOptions
  }

  function transferReasonAppliesToEvent(option: SelectOption, eventType: string) {
    const name = textValue(option.name || option.value || option.label)
    const category = textValue(option.meta?.category)
    const text = `${name} ${category}`
    if (eventType === 'entry') {
      return !/出生|初生|产犊/.test(text) && /入群|购入|转入|新购|引种|胚胎/.test(text)
    }
    if (eventType === 'exit') {
      return /离群|淘汰|出售|死亡|转出|出场|退群/.test(text)
    }
    if (eventType === 'transfer') {
      return !/入群|出生|购入|转入|新购|引种|初生|离群|淘汰|出售|死亡|转出|出场|退群/.test(text)
    }
    return true
  }

  function traitFieldKey(code: string) {
    return `trait__${textValue(code).replace(/[^a-zA-Z0-9_]+/g, '_')}`
  }

  async function ensureInformationEntryFieldDictionary(customFieldRows: any[]) {
    const rows = (customFieldRows || []) as CustomField[]
    const existingKeys = new Set(rows.map((row) => `${row.scope}:${row.fieldName}`))
    const seedRows: CustomField[] = []
    EVENT_OPTIONS.forEach((event, eventIndex) => {
      defaultEventFieldsFor(event.code)
        .filter((fieldConfig) => !fieldConfig.traitCode)
        .forEach((fieldConfig, fieldIndex) => {
          const scope = entryFieldScope(event.code)
          const key = `${scope}:${fieldConfig.key}`
          if (existingKeys.has(key)) return
          seedRows.push({
            id: `entry-field-${event.code}-${fieldConfig.key}`,
            fieldName: fieldConfig.key,
            label: fieldConfig.label,
            scope,
            eventCode: event.code,
            eventGroup: event.group,
            type: fieldConfig.type as CustomField['type'],
            options: fieldConfig.options,
            optionSource: fieldConfig.optionSource,
            min: fieldConfig.min,
            step: fieldConfig.step,
            placeholder: fieldConfig.placeholder,
            allowCreate: fieldConfig.allowCreate || false,
            traitCode: fieldConfig.traitCode,
            traitName: fieldConfig.traitName,
            unit: fieldConfig.unit,
            required: false,
            isActive: true,
            sortOrder: eventIndex * 100 + fieldIndex + 1,
            description: '信息录入字段字典初始化项，可在平台管理中调整。',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          })
        })
    })
    if (seedRows.length) {
      await databaseService.addTableDataAsync('custom-fields', seedRows)
      return databaseService
        .getTableDataAsync('custom-fields', { silent: true })
        .catch(() => [...rows, ...seedRows])
    }
    return rows
  }

  function isBodyMeasurementTrait(row: Record<string, any>) {
    const code = textValue(row.code || row.traitCode || row.trait_code)
    const category = textValue(row.category || row.categoryName || row.category_name)
    return BODY_MEASUREMENT_TRAITS.some((trait) => trait.code === code) || category.includes('体尺')
  }

  function normalizeTraitDefinition(row: Record<string, any>): PhenotypeTraitDefinition {
    const code = textValue(row.code || row.traitCode || row.trait_code)
    const fallback = DEFAULT_PHENOTYPE_TRAITS.find((trait) => trait.code === code)
    return {
      id: textValue(row.id) || fallback?.id || `trait-${code || Date.now()}`,
      code,
      name: textValue(row.name || row.traitName || row.trait_name) || fallback?.name || code,
      category:
        textValue(row.category || row.categoryName || row.category_name) ||
        fallback?.category ||
        '体尺性状',
      unit: textValue(row.unit) || fallback?.unit || 'cm',
      dataType:
        (textValue(row.dataType || row.data_type) as PhenotypeTraitDefinition['dataType']) ||
        fallback?.dataType ||
        '数值',
      source:
        (textValue(row.source) as PhenotypeTraitDefinition['source']) ||
        fallback?.source ||
        '人工采集',
      sourceTable:
        textValue(row.sourceTable || row.source_table) ||
        fallback?.sourceTable ||
        'trait_observation',
      sourceAnimalField:
        textValue(row.sourceAnimalField || row.source_animal_field) ||
        fallback?.sourceAnimalField ||
        'animalId',
      sourceTraitField:
        textValue(row.sourceTraitField || row.source_trait_field) ||
        fallback?.sourceTraitField ||
        'traitCode',
      sourceValueField:
        textValue(row.sourceValueField || row.source_value_field) ||
        fallback?.sourceValueField ||
        'value',
      sourceDateField:
        textValue(row.sourceDateField || row.source_date_field) ||
        fallback?.sourceDateField ||
        'collectionDate',
      sourceParityField:
        textValue(row.sourceParityField || row.source_parity_field) ||
        fallback?.sourceParityField ||
        'parity',
      sourceDimField:
        textValue(row.sourceDimField || row.source_dim_field) ||
        fallback?.sourceDimField ||
        'daysInMilk',
      requiredFields:
        textValue(row.requiredFields || row.required_fields) ||
        fallback?.requiredFields ||
        '牛号、采集日期、采集人、测量值',
      linkedDomains:
        textValue(row.linkedDomains || row.linked_domains) ||
        fallback?.linkedDomains ||
        '个体档案、系谱、组学样本',
      status:
        (textValue(row.status) as PhenotypeTraitDefinition['status']) || fallback?.status || '启用',
      description: textValue(row.description) || fallback?.description || ''
    }
  }

  async function ensureBodyMeasurementTraitDictionary(storedRows: any[], v2Rows: any[]) {
    const storedCodes = new Set(
      (storedRows || [])
        .map((row) => textValue(row.code || row.traitCode || row.trait_code))
        .filter(Boolean)
    )
    const missing = BODY_MEASUREMENT_TRAITS.filter((trait) => !storedCodes.has(trait.code)).map(
      (trait) => ({
        ...trait,
        sourceTable: trait.sourceTable || 'trait_observation',
        sourceAnimalField: trait.sourceAnimalField || 'animalId',
        sourceTraitField: trait.sourceTraitField || 'traitCode',
        sourceValueField: trait.sourceValueField || 'value',
        sourceDateField: trait.sourceDateField || 'collectionDate',
        sourceParityField: trait.sourceParityField || 'parity',
        sourceDimField: trait.sourceDimField || 'daysInMilk',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
    )

    let rows = storedRows || []
    if (missing.length) {
      await databaseService.addTableDataAsync('phenotype-trait-definitions', missing)
      rows = await databaseService
        .getTableDataAsync('phenotype-trait-definitions', { silent: true })
        .catch(() => rows)
    }

    const order = new Map(BODY_MEASUREMENT_TRAITS.map((trait, index) => [trait.code, index]))
    const map = new Map<string, PhenotypeTraitDefinition>()
    ;[...rows, ...(v2Rows || [])]
      .map((row) => normalizeTraitDefinition(row))
      .filter((trait) => trait.code && trait.status === '启用' && isBodyMeasurementTrait(trait))
      .forEach((trait) => {
        if (!map.has(trait.code)) map.set(trait.code, trait)
      })
    return Array.from(map.values()).sort(
      (left, right) =>
        (order.get(left.code) ?? 999) - (order.get(right.code) ?? 999) ||
        left.name.localeCompare(right.name, 'zh-CN')
    )
  }

  function buildPhenotypeTraitList(storedRows: any[], v2Rows: any[]) {
    const map = new Map<string, PhenotypeTraitDefinition>()
    ;[...DEFAULT_PHENOTYPE_TRAITS, ...(storedRows || []), ...(v2Rows || [])]
      .map((row) => normalizeTraitDefinition(row))
      .filter((trait) => trait.code && trait.status === '启用')
      .forEach((trait) => {
        if (!map.has(trait.code)) map.set(trait.code, trait)
      })
    return Array.from(map.values()).sort(
      (left, right) =>
        left.category.localeCompare(right.category, 'zh-CN') ||
        left.name.localeCompare(right.name, 'zh-CN')
    )
  }

  function findCowSuggestion(value: string) {
    const key = textValue(value)
    if (!key) return null
    return (
      cowOptions.value.find(
        (item) =>
          item.cowId === key ||
          item.cowNumber === key ||
          item.earTagNumber === key ||
          item.aliases.includes(key)
      ) || null
    )
  }

  function cowKeySet(cow: CowSuggestion | null) {
    return new Set(
      [cow?.cowId, cow?.cowNumber, cow?.earTagNumber, ...(cow?.aliases || [])]
        .map((item) => textValue(item))
        .filter(Boolean)
    )
  }

  function rowMatchesCurrentCow(
    row: Record<string, any>,
    keys = cowKeySet(currentCowSuggestion.value)
  ) {
    if (!keys.size) return false
    return [
      row.id,
      row.cowId,
      row.cow_id,
      row.animalId,
      row.animal_id,
      row.cowNumber,
      row.cow_number,
      row.animalNumber,
      row.animal_number,
      row.earTagNumber,
      row.ear_tag_number
    ].some((value) => keys.has(textValue(value)))
  }

  function deriveParityForEntry() {
    const cow = currentCowSuggestion.value
    if (!cow || !singleForm.occurredAt) return null
    const eventTime = parseTimeValue(singleForm.occurredAt)
    if (!Number.isFinite(eventTime)) return null
    const keys = cowKeySet(cow)
    const windows = parityEpisodeRows.value
      .filter((row) => rowMatchesCurrentCow(row, keys))
      .map((row) => {
        const startTime = parseTimeValue(row.startDate || row.start_date)
        const endValue = textValue(row.endDate || row.end_date)
        return {
          parityNo: numericValue(row.parityNo ?? row.parity_no),
          startTime,
          startDate: formatDateKeyFromTime(startTime),
          endTime: endValue ? endOfDay(parseTimeValue(endValue)) : Number.POSITIVE_INFINITY
        }
      })
      .filter((row) => row.parityNo > 0 && Number.isFinite(row.startTime))
      .sort((left, right) => left.startTime - right.startTime)

    if (singleForm.eventType === 'calving') {
      const existing = windows.find((row) => sameDay(row.startTime, eventTime))
      if (existing) {
        return { parityNo: existing.parityNo, startDate: existing.startDate, note: '按产犊周期' }
      }
      const beforeCount = windows.filter((row) => row.startTime < startOfDay(eventTime)).length
      const fallbackCount = calvingEventsForCurrentCow(keys).filter(
        (row) => row.time < startOfDay(eventTime)
      ).length
      return {
        parityNo: Math.max(beforeCount, fallbackCount) + 1,
        startDate: formatDateKeyFromTime(eventTime),
        prefix: '将形成第',
        note: '本次产犊'
      }
    }

    const matched = windows.find((row) => eventTime >= row.startTime && eventTime <= row.endTime)
    if (matched) {
      return { parityNo: matched.parityNo, startDate: matched.startDate, note: '按产犊周期' }
    }

    const calvings = calvingEventsForCurrentCow(keys)
    const previousIndex = calvings.findLastIndex((row) => row.time <= eventTime)
    if (previousIndex === -1) return null
    const next = calvings[previousIndex + 1]
    if (next && eventTime >= next.time) return null
    return {
      parityNo: previousIndex + 1,
      startDate: formatDateKeyFromTime(calvings[previousIndex].time),
      note: '按产犊事件推导'
    }
  }

  function parityWindowForCurrentEntry() {
    const cow = currentCowSuggestion.value
    if (!cow || !singleForm.occurredAt || !derivedParity.value?.parityNo) return null
    const eventTime = parseTimeValue(singleForm.occurredAt)
    if (!Number.isFinite(eventTime)) return null
    const keys = cowKeySet(cow)
    const parityNo = derivedParity.value.parityNo
    const factWindow = parityEpisodeRows.value
      .filter((row) => rowMatchesCurrentCow(row, keys))
      .map((row) => {
        const startTime = parseTimeValue(row.startDate || row.start_date)
        const endValue = textValue(row.endDate || row.end_date)
        return {
          parityNo: numericValue(row.parityNo ?? row.parity_no),
          startTime,
          endTime: endValue ? endOfDay(parseTimeValue(endValue)) : Number.POSITIVE_INFINITY
        }
      })
      .find((row) => row.parityNo === parityNo && Number.isFinite(row.startTime))
    if (factWindow) return factWindow

    const calvings = calvingEventsForCurrentCow(keys)
    const start = calvings[parityNo - 1]
    if (!start) return null
    return {
      parityNo,
      startTime: startOfDay(start.time),
      endTime: calvings[parityNo]
        ? startOfDay(calvings[parityNo].time) - 1
        : Number.POSITIVE_INFINITY
    }
  }

  function countInseminationsInCurrentParity() {
    const cow = currentCowSuggestion.value
    const window = parityWindowForCurrentEntry()
    if (!cow || !window) return 0
    const eventTime = parseTimeValue(singleForm.occurredAt)
    const keys = cowKeySet(cow)
    return parityEventRows.value.filter((row) => {
      if (!rowMatchesCurrentCow(row, keys)) return false
      const rowTime = parseTimeValue(
        row.occurredAt ||
          row.occurred_at ||
          row.eventTime ||
          row.event_time ||
          row.eventDate ||
          row.event_date ||
          row.createdAt ||
          row.created_at
      )
      if (
        !Number.isFinite(rowTime) ||
        rowTime < window.startTime ||
        rowTime > window.endTime ||
        rowTime >= eventTime
      )
        return false
      const details = parseObject(row.details || row.customValues || row.custom_values)
      const type = textValue(
        row.eventType ||
          row.event_type ||
          row.eventCode ||
          row.event_code ||
          row.eventName ||
          row.event_name ||
          details.eventType ||
          details.event_type ||
          details.event_name
      )
      return ['insemination', 'breeding', '配种', '人工授精', '输精/配种'].includes(type)
    }).length
  }

  function calvingEventsForCurrentCow(keys = cowKeySet(currentCowSuggestion.value)) {
    return parityEventRows.value
      .filter((row) => rowMatchesCurrentCow(row, keys))
      .map((row) => {
        const details = parseObject(row.details || row.customValues || row.custom_values)
        const type = textValue(
          row.eventType ||
            row.event_type ||
            row.eventCode ||
            row.event_code ||
            row.eventName ||
            row.event_name ||
            details.eventType ||
            details.event_name
        )
        const time = parseTimeValue(
          row.occurredAt ||
            row.occurred_at ||
            row.eventTime ||
            row.event_time ||
            row.eventDate ||
            row.event_date ||
            row.createdAt ||
            row.created_at
        )
        return { type, time }
      })
      .filter(
        (row) => Number.isFinite(row.time) && ['calving', '产犊', 'delivery'].includes(row.type)
      )
      .sort((left, right) => left.time - right.time)
  }

  function parseObject(value: unknown) {
    if (!value) return {}
    if (typeof value === 'object') return value as Record<string, any>
    try {
      return JSON.parse(String(value))
    } catch {
      return {}
    }
  }

  function parseTimeValue(value: unknown) {
    const raw = textValue(value)
    if (!raw) return Number.NaN
    const date = new Date(raw)
    return date.getTime()
  }

  function startOfDay(time: number) {
    const date = new Date(time)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }

  function endOfDay(time: number) {
    const date = new Date(time)
    date.setHours(23, 59, 59, 999)
    return date.getTime()
  }

  function sameDay(left: number, right: number) {
    return startOfDay(left) === startOfDay(right)
  }

  function formatDateKeyFromTime(time: number) {
    if (!Number.isFinite(time)) return ''
    const date = new Date(startOfDay(time))
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  }

  function numericValue(value: unknown) {
    const numberValue = Number(value)
    return Number.isFinite(numberValue) ? numberValue : 0
  }

  function syncEventByGroup() {
    const first = filteredEvents.value[0]
    if (first) {
      singleForm.eventType = first.code
      singleForm.eventName = first.label
    }
  }

  function selectEntryEvent(event: InformationEntryEventOption) {
    singleForm.eventGroup = event.group
    singleForm.eventType = event.code
    singleForm.eventName = event.label
  }

  function syncEventNameByType() {
    const option = entryEventOptions.value.find((item) => item.code === singleForm.eventType)
    if (option) singleForm.eventName = option.label
  }

  function normalizeActiveTabForRoute() {
    if (isInformationEntryRoute.value && activeTab.value !== 'single') {
      activeTab.value = 'single'
    }
  }

  function applyRouteEventPreset() {
    const metaGroup = String(route.meta.eventGroup || '')
    const metaType = String(route.meta.eventType || '')
    const queryGroup = String(route.query.eventGroup || '')
    const queryType = String(route.query.eventType || '')
    const group = isInformationEntryRoute.value ? metaGroup : queryGroup || metaGroup
    const eventType = isInformationEntryRoute.value ? metaType : queryType || metaType

    if (group && entryEventOptions.value.some((item) => item.group === group)) {
      singleForm.eventGroup = group
      activeTab.value = 'single'
    }

    if (
      eventType &&
      entryEventOptions.value.some(
        (item) => item.code === eventType && (!group || item.group === group)
      )
    ) {
      singleForm.eventType = eventType
      syncEventNameByType()
    } else if (group) {
      syncEventByGroup()
    }
    normalizeActiveTabForRoute()
  }

  function selectCowSuggestion(item: Record<string, any>) {
    if (singleForm.eventType === 'entry') return
    const suggestion = item as CowSuggestion
    singleForm.animalNumber = suggestion.cowNumber
    singleForm.cowId = suggestion.cowId
  }

  function syncOperatorName() {
    const selectedOperator = operatorOptions.value.find(
      (item) => item.value === singleForm.operatorId
    )
    singleForm.operatorName = selectedOperator?.name || selectedOperator?.label || operatorName()
  }

  function isPlaceholderOperator(value: unknown) {
    return /导入操作员|批量导入|batch_import|import_operator/i.test(textValue(value))
  }

  function displayOperatorName(value: unknown, fallback = '') {
    const normalized = textValue(value)
    if (!normalized || isPlaceholderOperator(normalized)) return fallback || '未记录'
    return normalized
  }

  function singleOperatorName(selectedOperator?: SelectOption) {
    const candidate = textValue(
      selectedOperator?.name || selectedOperator?.label || singleForm.operatorName
    )
    return candidate && !isPlaceholderOperator(candidate) ? candidate : operatorName()
  }

  function ensureSingleOperatorSelection() {
    const currentOption = currentOperatorOption()
    if (!operatorOptions.value.some((item) => item.value === currentOption.value)) {
      operatorOptions.value = uniqueOptions([currentOption, ...operatorOptions.value])
    }
    const selectedStillExists = operatorOptions.value.some(
      (item) => item.value === singleForm.operatorId
    )
    const shouldUseCurrent =
      !singleForm.operatorId ||
      !selectedStillExists ||
      isPlaceholderOperator(singleForm.operatorName) ||
      isPlaceholderOperator(singleForm.operatorId)
    if (shouldUseCurrent) {
      singleForm.operatorId = currentOption.value
    }
    syncOperatorName()
  }

  function singleRow() {
    const option = entryEventOptions.value.find((item) => item.code === singleForm.eventType)
    const selectedOperator = operatorOptions.value.find(
      (item) => item.value === singleForm.operatorId
    )
    const operator = singleOperatorName(selectedOperator)
    const targetUnitCode = textValue(eventDynamicForm.to_unit_code)
    const movementReason = textValue(eventDynamicForm.movement_reason)
    const targetPen = penOptions.value.find((item) => item.value === targetUnitCode)
    const currentPen = currentCowSuggestion.value?.currentPen || ''
    const currentPenName = currentCowSuggestion.value?.currentPenName || ''
    const eventCodeForPayload = singleForm.eventType
    const deathMovementPayload =
      singleForm.eventType === 'death'
        ? {
            from_unit_code: currentPen,
            fromUnitCode: currentPen,
            from_unit_id: currentPen,
            fromUnitId: currentPen,
            current_pen_snapshot: currentPen,
            currentPenSnapshot: currentPen,
            to_unit_code: '',
            toUnitCode: '',
            to_unit_id: '',
            toUnitId: '',
            unit_id: '',
            unitId: '',
            unit_code: '',
            unitCode: '',
            movement_reason: '死亡离群',
            movementReason: '死亡离群',
            exitReason: '死亡离群',
            exit_reason: '死亡离群',
            movementDirection: 'current_to_none',
            movement_direction: 'current_to_none',
            target_stage: '死亡',
            targetStage: '死亡'
          }
        : {}
    const parityNo = derivedParity.value?.parityNo || ''
    const currentParityStartDate = textValue(derivedParity.value?.startDate)
    const dryOffDate =
      singleForm.eventType === 'dry_off'
        ? textValue(eventDynamicForm.dry_off_date || singleForm.occurredAt).slice(0, 10)
        : ''
    const dryOffPayload =
      singleForm.eventType === 'dry_off'
        ? {
            ...(currentParityStartDate
              ? {
                  parity_calving_date: currentParityStartDate,
                  parityCalvingDate: currentParityStartDate,
                  lactation_start_date: currentParityStartDate,
                  lactationStartDate: currentParityStartDate,
                  开产时间: currentParityStartDate
                }
              : {}),
            dry_off_date: dryOffDate,
            dryOffDate: dryOffDate,
            lactation_end_date: dryOffDate,
            lactationEndDate: dryOffDate,
            停产日期: dryOffDate
          }
        : {}
    const movementPayload = isMovementEvent.value
      ? {
          from_unit_code: singleForm.eventType === 'entry' ? '' : currentPen,
          fromUnitCode: singleForm.eventType === 'entry' ? '' : currentPen,
          from_unit_id: singleForm.eventType === 'entry' ? '' : currentPen,
          fromUnitId: singleForm.eventType === 'entry' ? '' : currentPen,
          原圈舍: singleForm.eventType === 'entry' ? '无圈舍' : currentPenName || currentPen,
          to_unit_code: singleForm.eventType === 'exit' ? '' : targetUnitCode,
          toUnitCode: singleForm.eventType === 'exit' ? '' : targetUnitCode,
          to_unit_id: singleForm.eventType === 'exit' ? '' : targetUnitCode,
          toUnitId: singleForm.eventType === 'exit' ? '' : targetUnitCode,
          目标圈舍: singleForm.eventType === 'exit' ? '无圈舍' : targetUnitCode,
          unitCode: singleForm.eventType === 'exit' ? '' : targetUnitCode,
          unit_code: singleForm.eventType === 'exit' ? '' : targetUnitCode,
          unitId: singleForm.eventType === 'exit' ? '' : targetUnitCode,
          unit_id: singleForm.eventType === 'exit' ? '' : targetUnitCode,
          current_pen_snapshot: currentPen,
          currentPenSnapshot: currentPen,
          unitName:
            singleForm.eventType === 'exit' ? '' : targetPen?.name || targetPen?.label || '',
          unit_name:
            singleForm.eventType === 'exit' ? '' : targetPen?.name || targetPen?.label || '',
          movement_reason: movementReason,
          movementReason,
          转群原因: movementReason,
          ...(singleForm.eventType === 'entry'
            ? {
                entryReason: movementReason,
                entry_reason: movementReason,
                入群原因: movementReason
              }
            : {}),
          ...(singleForm.eventType === 'transfer'
            ? { transferReason: movementReason, transfer_reason: movementReason }
            : {}),
          ...(singleForm.eventType === 'exit'
            ? { exitReason: movementReason, exit_reason: movementReason, 离群原因: movementReason }
            : {}),
          movementDirection:
            singleForm.eventType === 'entry'
              ? 'none_to_target'
              : singleForm.eventType === 'transfer'
                ? 'current_to_target'
                : 'current_to_none',
          movement_direction:
            singleForm.eventType === 'entry'
              ? 'none_to_target'
              : singleForm.eventType === 'transfer'
                ? 'current_to_target'
                : 'current_to_none'
        }
      : {}
    const dynamicPayload = activeEventFields.value.reduce(
      (payload, fieldConfig) => {
        const value = eventDynamicForm[fieldConfig.key]
        if (value === undefined || value === null || value === '') return payload
        payload[fieldConfig.key] = value
        payload[fieldConfig.label] = value
        return payload
      },
      {} as Record<string, unknown>
    )
    const traitObservations =
      singleForm.eventType === 'body_measurement'
        ? activeEventFields.value
            .filter((fieldConfig) => fieldConfig.traitCode)
            .map((fieldConfig) => {
              const value = eventDynamicForm[fieldConfig.key]
              if (value === undefined || value === null || value === '') return null
              return {
                traitCode: fieldConfig.traitCode,
                trait_code: fieldConfig.traitCode,
                traitName: fieldConfig.traitName || fieldConfig.label,
                trait_name: fieldConfig.traitName || fieldConfig.label,
                value,
                numericValue: value,
                numeric_value: value,
                unit: fieldConfig.unit || '',
                observedAt: singleForm.occurredAt,
                observed_at: singleForm.occurredAt,
                collectionDate: singleForm.occurredAt,
                collection_date: singleForm.occurredAt,
                measureMethod: eventDynamicForm.measure_method || '',
                measure_method: eventDynamicForm.measure_method || '',
                parityNo,
                parity_no: parityNo
              }
            })
            .filter(Boolean)
        : []
    const calvingPayload =
      singleForm.eventType === 'calving'
        ? {
            calves: calfRows.map((row, index) => ({
              index: index + 1,
              cowNumber: textValue(row.cowNumber),
              cow_number: textValue(row.cowNumber),
              animalNumber: textValue(row.cowNumber),
              animal_number: textValue(row.cowNumber),
              sex: textValue(row.sex),
              gender: textValue(row.sex),
              earTagNumber: textValue(row.earTagNumber),
              ear_tag_number: textValue(row.earTagNumber),
              remark: textValue(row.remark),
              notes: textValue(row.remark)
            })),
            calfRows: calfRows.map((row, index) => ({
              index: index + 1,
              cowNumber: textValue(row.cowNumber),
              sex: textValue(row.sex),
              earTagNumber: textValue(row.earTagNumber),
              remark: textValue(row.remark)
            }))
          }
        : {}
    return {
      牛号: singleForm.animalNumber,
      牛只ID: singleForm.eventType === 'entry' ? '' : singleForm.cowId,
      事件类型编码: eventCodeForPayload,
      event_type: eventCodeForPayload,
      eventType: eventCodeForPayload,
      事件名称: singleForm.eventName || option?.label || singleForm.eventType,
      发生时间: singleForm.occurredAt,
      ...(parityNo ? { 胎次: parityNo, parity_no: parityNo, parityNo } : {}),
      级别: singleForm.severity,
      severity: singleForm.severity,
      事件状态: singleForm.eventStatus,
      event_status: singleForm.eventStatus,
      记录人: operator,
      operatorId: singleForm.operatorId,
      operator_id: singleForm.operatorId,
      operatorName: operator,
      operator_name: operator,
      importMode: 'single',
      import_mode: 'single',
      sourceType: 'single_entry',
      source_type: 'single_entry',
      ...(traitObservations.length
        ? { trait_observations: traitObservations, traitValues: traitObservations }
        : {}),
      ...dynamicPayload,
      ...dryOffPayload,
      ...calvingPayload,
      ...deathMovementPayload,
      ...movementPayload,
      备注: singleForm.notes
    }
  }

  async function dryRunSingle() {
    const businessError = validateSingleEntryBusiness()
    if (businessError) {
      ElMessage.error(businessError)
      return
    }
    checking.value = true
    try {
      latestResult.value = await dryRunImportRows({
        mode: 'single',
        templateCode: 'animal-event',
        configId: selectedImportConfigId.value,
        rows: [singleRow()],
        operatorId: singleForm.operatorId,
        operatorName: singleOperatorName()
      })
      ElMessage.success('预检完成')
    } catch (error) {
      ElMessage.error(`预检失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      checking.value = false
      if (!isInformationEntryRoute.value) {
        await loadAudits()
      }
    }
  }

  async function commitSingle() {
    const businessError = validateSingleEntryBusiness()
    if (businessError) {
      ElMessage.error(businessError)
      return
    }
    committing.value = true
    try {
      const row = singleRow()
      latestResult.value = await commitImportRows({
        mode: 'single',
        templateCode: 'animal-event',
        configId: selectedImportConfigId.value,
        rows: [row],
        operatorId: singleForm.operatorId,
        operatorName: singleOperatorName()
      })
      ElMessage.success(`提交完成，写入 ${latestResult.value.committedRows} 行`)
      prependRecentSingleEntryRecord(row, latestResult.value.targetRecordIds[0])
      void refreshSingleEntryRuntimeContext().catch(() => undefined)
    } catch (error) {
      ElMessage.error(`提交失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      committing.value = false
      if (isInformationEntryRoute.value) {
        void loadAudits().catch(() => undefined)
      } else {
        await loadAudits()
      }
    }
  }

  function singleMilkYieldValue(row: Record<string, any>) {
    const direct = firstNonEmpty(
      row.milk_yield,
      row.milkYield,
      row.volume,
      row.milkVolume,
      row['产奶量 kg'],
      row['产奶量'],
      row['单次产奶量'],
      row['单次产奶量 kg'],
      eventDynamicForm.milk_yield,
      eventDynamicForm.trait__milk_yield
    )
    if (direct !== '') return direct

    const configuredMilkField = activeEventFields.value.find((fieldConfig) => {
      const traitCode = textValue(fieldConfig.traitCode)
      const key = textValue(fieldConfig.key)
      const label = textValue(fieldConfig.label)
      return (
        traitCode === 'milk_yield' ||
        key === 'milk_yield' ||
        key === 'trait__milk_yield' ||
        /产奶量|单次产奶/.test(label)
      )
    })
    if (!configuredMilkField) return ''
    return firstNonEmpty(
      row[configuredMilkField.key],
      row[configuredMilkField.label],
      eventDynamicForm[configuredMilkField.key]
    )
  }

  function firstNonEmpty(...values: unknown[]) {
    return (
      values.find((value) => value !== undefined && value !== null && textValue(value) !== '') ?? ''
    )
  }

  function validateSingleEntryBusiness() {
    const cow = currentCowSuggestion.value
    const targetUnitCode = textValue(eventDynamicForm.to_unit_code)
    const currentPen = textValue(cow?.currentPen)
    if (!textValue(singleForm.animalNumber))
      return singleForm.eventType === 'entry' ? '入群需要填写新牛号' : '请先选择牛号'
    if (!isMovementEvent.value && !cow)
      return '该事件需要选择已匹配的牛号；新牛进入系统请使用入群录入'
    if (singleForm.eventType === 'entry') {
      if (!targetUnitCode) return '入群需要选择目标圈舍'
      const duplicated = cowOptions.value.find(
        (item) =>
          item.cowNumber === textValue(singleForm.animalNumber) ||
          item.earTagNumber === textValue(singleForm.animalNumber) ||
          item.aliases.includes(textValue(singleForm.animalNumber))
      )
      if (duplicated) return '入群是新牛建档，当前牛号/耳号已存在；已在群牛只请使用转群或离群'
      return ''
    }
    if (singleForm.eventType === 'transfer') {
      if (!cow) return '转群需要先选择已匹配的牛号'
      if (!currentPen) return '转群需要先有当前圈舍'
      if (!targetUnitCode) return '转群需要选择目标圈舍'
      if (targetUnitCode === currentPen) return '目标圈舍不能与当前圈舍相同'
    }
    if (singleForm.eventType === 'exit') {
      if (!cow) return '离群需要先选择已匹配的牛号'
      if (!currentPen) return '离群需要先有当前圈舍'
    }
    if (singleForm.eventType === 'death') {
      if (!cow) return '死亡记录需要先选择已匹配的牛号'
      if (!currentPen) return '死亡离群需要先有当前圈舍'
    }
    const missingRequiredField = requiredEventFieldError()
    if (missingRequiredField) return missingRequiredField
    if (singleForm.eventType === 'calving') {
      const count = normalizedCalfCount()
      if (!count) return '产犊需要填写犊牛数'
      const missingIndex = calfRows.findIndex((row) => !textValue(row.cowNumber))
      if (missingIndex >= 0) return `第 ${missingIndex + 1} 头犊牛需要填写牛号`
      const duplicated = calfRows
        .map((row) => textValue(row.cowNumber))
        .filter(Boolean)
        .find((value, index, array) => array.indexOf(value) !== index)
      if (duplicated) return `犊牛号重复：${duplicated}`
      const exists = calfRows
        .map((row) => textValue(row.cowNumber))
        .find((value) =>
          cowOptions.value.some(
            (item) =>
              item.cowNumber === value || item.earTagNumber === value || item.cowId === value
          )
        )
      if (exists) return `犊牛号已存在：${exists}`
    }
    return ''
  }

  function requiredEventFieldError() {
    const missing = activeEventFields.value.find(
      (fieldConfig) => fieldConfig.required && !textValue(eventDynamicForm[fieldConfig.key])
    )
    return missing ? `${missing.label}不能为空` : ''
  }

  function normalizedCalfCount() {
    const value = Number(eventDynamicForm.calf_count || eventDynamicForm.calfCount || 0)
    return Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : 0
  }

  function defaultCalfSex() {
    return calfSexOptions.value[0]?.value || '母'
  }

  function ensureCalfRows(count: number) {
    const target = Math.max(1, Math.floor(count || 1))
    while (calfRows.length < target)
      calfRows.push({ cowNumber: '', sex: defaultCalfSex(), earTagNumber: '', remark: '' })
    while (calfRows.length > target) calfRows.pop()
  }

  function addCalfRow() {
    calfRows.push({ cowNumber: '', sex: defaultCalfSex(), earTagNumber: '', remark: '' })
    eventDynamicForm.calf_count = calfRows.length
  }

  function removeCalfRow(index: number) {
    calfRows.splice(index, 1)
    if (!calfRows.length)
      calfRows.push({ cowNumber: '', sex: defaultCalfSex(), earTagNumber: '', remark: '' })
    eventDynamicForm.calf_count = calfRows.length
  }

  function handleFileSelect(file: any) {
    selectedFile.value = file.raw || file
    importProgress.value = null
    importProgressState.value = 'idle'
  }

  function startImportProgress(message: string) {
    importProgressState.value = 'active'
    importProgress.value = {
      stage: 'prepare',
      message,
      percent: 1
    }
  }

  function updateImportProgress(event: ImportProgressEvent) {
    importProgressState.value = event.stage === 'error' ? 'exception' : 'active'
    importProgress.value = {
      ...event,
      percent: Math.max(0, Math.min(100, Math.round(Number(event.percent || 0))))
    }
  }

  function finishImportProgress(message: string) {
    importProgressState.value = 'success'
    importProgress.value = {
      ...(importProgress.value || { stage: 'done' as const }),
      stage: 'done',
      message,
      percent: 100
    }
  }

  function failImportProgress(message: string) {
    importProgressState.value = 'exception'
    importProgress.value = {
      ...(importProgress.value || { stage: 'error' as const }),
      stage: 'error',
      message,
      percent: 100
    }
  }

  async function dryRunBatch() {
    if (!selectedFile.value) return
    checking.value = true
    startImportProgress('开始预检表格')
    try {
      latestResult.value = await dryRunImportFile(
        selectedFile.value,
        selectedTemplateCode.value,
        operatorName(),
        selectedImportConfigId.value,
        updateImportProgress
      )
      finishImportProgress(
        `预检完成：${latestResult.value.validRows}/${latestResult.value.totalRows} 行有效`
      )
      ElMessage.success('表格预检完成')
    } catch (error) {
      failImportProgress(error instanceof Error ? error.message : String(error))
      ElMessage.error(`表格预检失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      checking.value = false
      await loadAuditsSafely()
    }
  }

  async function commitBatch() {
    if (!selectedFile.value) return
    committing.value = true
    startImportProgress('开始提交入库')
    try {
      latestResult.value = await commitImportFile(
        selectedFile.value,
        selectedTemplateCode.value,
        operatorName(),
        selectedImportConfigId.value,
        updateImportProgress
      )
      finishImportProgress(
        `提交完成：写入 ${latestResult.value.committedRows} 行，跳过 ${latestResult.value.skippedRows} 行`
      )
      ElMessage.success(
        `提交完成，写入 ${latestResult.value.committedRows} 行，跳过 ${latestResult.value.skippedRows} 行`
      )
    } catch (error) {
      failImportProgress(error instanceof Error ? error.message : String(error))
      ElMessage.error(`提交失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      committing.value = false
      await loadAuditsSafely()
    }
  }

  async function downloadTemplate(template: ImportTemplate) {
    await downloadImportTemplateWithDictionaries(template)
  }

  async function downloadSelectedTemplate() {
    await downloadImportTemplateWithDictionaries(selectedTemplate.value)
  }

  function downloadErrors() {
    const errors = latestResult.value?.errors || []
    if (!errors.length) {
      ElMessage.info('当前没有错误行')
      return
    }
    downloadImportErrorReport(errors)
  }

  async function loadAudits() {
    auditRows.value = await getImportAudits()
  }

  async function loadAuditsSafely() {
    try {
      await loadAudits()
    } catch (error) {
      console.warn('导入审计刷新失败，已保留当前导入结果:', error)
    }
  }

  async function loadImportConfigs() {
    const scopes = ['animal', 'event', 'breeding', 'phenotype', 'milk', 'omics', 'device', 'cow']
    const rows = await Promise.all(
      scopes.map((scope) => flexibleExport.getImportConfigs(scope).catch(() => []))
    )
    importConfigs.value = rows.flat()
    ensureSelectedConfigMatchesTemplate()
  }

  async function loadSingleEntryOptions() {
    if (isInformationEntryRoute.value) {
      await loadSingleEntryCoreOptions()
      window.setTimeout(() => {
        void loadSingleEntryDeferredOptions().catch(() => undefined)
      }, 120)
      return
    }
    await loadSingleEntryFullOptions()
  }

  async function loadSingleEntryFullOptions() {
    const [
      cowRows,
      animalRows,
      identifierRows,
      personRows,
      penRows,
      farmUnits,
      medicines,
      medicineRows,
      medicineBatches,
      breedRows,
      transferReasons,
      diseases,
      traitDefinitions,
      v2TraitDefinitions,
      baseInfoCategories,
      customFields,
      parityEpisodes,
      unifiedEvents
    ] = await Promise.all([
      databaseService.getTableDataAsync('cows', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('animal', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('animal_identifier', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('persons', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('pens', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('farm_unit', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('medicines', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('medicine', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('medicine_batch', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('breed-types', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('transfer-reasons', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('diseases', { silent: true }).catch(() => []),
      databaseService
        .getTableDataAsync('phenotype-trait-definitions', { silent: true })
        .catch(() => []),
      databaseService.getTableDataAsync('trait_definition', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('base-info-categories', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('custom-fields', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('parity_episode', { silent: true }).catch(() => []),
      databaseService.getUnifiedCowEventRowsAsync().catch(() => [])
    ])

    const optionCategoryRows = await ensureInformationEntryOptionDictionaries(
      baseInfoCategories || []
    )
    const ensuredTransferReasons = await ensureTransferReasonDictionary(transferReasons || [])
    const ensuredBreedRows = await ensureBreedDictionary(breedRows || [])
    milkShiftOptions.value = await getMilkShiftOptions()

    cowOptions.value = buildCowOptions(
      buildCowReferenceContext([...cowRows, ...animalRows], identifierRows),
      identifierRows
    )
    const ensuredTraits = await ensureBodyMeasurementTraitDictionary(
      traitDefinitions || [],
      v2TraitDefinitions || []
    )
    phenotypeTraits.value = buildPhenotypeTraitList(
      traitDefinitions || [],
      v2TraitDefinitions || []
    )
    bodyMeasurementTraits.value = ensuredTraits
    entryEventOptions.value = await ensureInformationEntryEventDictionary(optionCategoryRows || [])
    entryFieldRows.value = await ensureInformationEntryFieldDictionary(customFields || [])
    syncDynamicFormWithActiveFields()
    severityOptions.value = baseInfoOptions(optionCategoryRows, 'information-entry:severity')
    eventStatusOptions.value = baseInfoOptions(optionCategoryRows, 'information-entry:event-status')
    calfSexOptions.value = baseInfoOptions(optionCategoryRows, 'information-entry:calf-sex')
    if (
      severityOptions.value.length &&
      !severityOptions.value.some((item) => item.value === singleForm.severity)
    ) {
      singleForm.severity = severityOptions.value[0].value
    }
    if (
      eventStatusOptions.value.length &&
      !eventStatusOptions.value.some((item) => item.value === singleForm.eventStatus)
    ) {
      singleForm.eventStatus = eventStatusOptions.value[0].value
    }
    calfRows.forEach((row) => {
      if (
        calfSexOptions.value.length &&
        !calfSexOptions.value.some((item) => item.value === row.sex)
      ) {
        row.sex = calfSexOptions.value[0].value
      }
    })
    parityEpisodeRows.value = parityEpisodes || []
    parityEventRows.value = unifiedEvents || []
    updateRecentSingleEntryRecords(unifiedEvents || [])
    operatorOptions.value = uniqueOptions([
      currentOperatorOption(),
      ...personRows.map((row: any) => {
        const status = textValue(row.status)
        if (status && !isEnabledStatus(status)) return null
        const name = textValue(row.name || row.realName || row.nickname || row.username)
        const role = textValue(row.role || row.department)
        const id = textValue(row.id || row.personId || row.person_id || name)
        return name ? { label: role ? `${name} / ${role}` : name, value: id, name } : null
      })
    ])
    ensureSingleOperatorSelection()
    penOptions.value = buildAssignablePenOptions(penRows || [], farmUnits || [])
    const penNameByValue = buildPenNameByValue(penOptions.value)
    cowOptions.value = cowOptions.value.map((cow) => ({
      ...cow,
      currentPenName: penNameByValue.get(cow.currentPen) || cow.currentPenName || cow.currentPen,
      searchText: [
        cow.cowNumber,
        cow.cowId,
        cow.cowName,
        cow.earTagNumber,
        cow.currentPen,
        penNameByValue.get(cow.currentPen) || cow.currentPenName,
        cow.currentStage,
        ...cow.aliases
      ]
        .map((item) => item.toLowerCase())
        .join(' ')
    }))
    breedOptions.value = buildBreedOptions(ensuredBreedRows || [])
    transferReasonOptions.value = uniqueOptions(
      (ensuredTransferReasons || []).map((row: any) => normalizeTransferReasonOption(row))
    )
    diseaseOptions.value = uniqueOptions(
      (diseases || []).map((row: any) => {
        const status = textValue(row.status)
        if (status && !isEnabledStatus(status)) return null
        const name = textValue(row.name || row.diseaseName || row.disease_name || row.diagnosis)
        const category = textValue(
          row.category || row.categoryName || row.type || row.diseaseType || row.disease_type
        )
        return name ? { label: category ? `${name} / ${category}` : name, value: name, name } : null
      })
    )
    medicineOptions.value = uniqueOptions(
      [...medicines, ...medicineRows].map((row: any) => {
        const status = textValue(row.status)
        if (status && !isEnabledStatus(status)) return null
        const value = textValue(
          row.code || row.medicineCode || row.medicine_code || row.name || row.id
        )
        const name = textValue(
          row.name || row.medicineName || row.medicine_name || row.code || row.id
        )
        const category = textValue(
          row.category || row.categoryName || row.type || row.medicineType || row.medicine_type
        )
        return value ? { label: category ? `${name} / ${category}` : name, value, name } : null
      })
    )
    medicineBatchOptions.value = uniqueOptions(
      medicineBatches.map((row: any) => {
        const value = textValue(
          row.batchNo || row.batch_no || row.batchCode || row.batch_code || row.code || row.id
        )
        const name = textValue(row.name || row.batchName || row.batch_name || value)
        const medicine = textValue(
          row.medicineName || row.medicine_name || row.medicineCode || row.medicine_code
        )
        return value ? { label: medicine ? `${name} / ${medicine}` : name, value, name } : null
      })
    )
    medicineUnitOptions.value = uniqueOptions(
      [...medicines, ...medicineRows].map((row: any) => {
        const status = textValue(row.status)
        if (status && !isEnabledStatus(status)) return null
        const value = textValue(row.unit || row.doseUnit || row.dose_unit)
        return value ? { label: value, value, name: value } : null
      })
    )
    vaccineOptions.value = uniqueOptions(
      [...medicines, ...medicineRows].map((row: any) => {
        const status = textValue(row.status)
        if (status && !isEnabledStatus(status)) return null
        const category = textValue(
          row.category || row.categoryName || row.type || row.medicineType || row.medicine_type
        )
        if (category && !category.includes('疫苗')) return null
        const value = textValue(
          row.code || row.medicineCode || row.medicine_code || row.name || row.id
        )
        const name = textValue(
          row.name || row.medicineName || row.medicine_name || row.code || row.id
        )
        return value ? { label: category ? `${name} / ${category}` : name, value, name } : null
      })
    )
  }

  async function loadSingleEntryCoreOptions() {
    const [
      cowRows,
      animalRows,
      identifierRows,
      personRows,
      penRows,
      farmUnits,
      breedRows,
      transferReasons,
      baseInfoCategories,
      customFields,
      parityEpisodes
    ] = await Promise.all([
      databaseService.getTableDataAsync('cows', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('animal', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('animal_identifier', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('persons', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('pens', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('farm_unit', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('breed-types', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('transfer-reasons', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('base-info-categories', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('custom-fields', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('parity_episode', { silent: true }).catch(() => [])
    ])

    const optionCategoryRows = await ensureInformationEntryOptionDictionaries(
      baseInfoCategories || []
    )
    const [ensuredTransferReasons, ensuredBreedRows] = await Promise.all([
      ensureTransferReasonDictionary(transferReasons || []),
      ensureBreedDictionary(breedRows || [])
    ])

    entryEventOptions.value = await ensureInformationEntryEventDictionary(optionCategoryRows || [])
    entryFieldRows.value = await ensureInformationEntryFieldDictionary(customFields || [])
    severityOptions.value = baseInfoOptions(optionCategoryRows, 'information-entry:severity')
    eventStatusOptions.value = baseInfoOptions(optionCategoryRows, 'information-entry:event-status')
    calfSexOptions.value = baseInfoOptions(optionCategoryRows, 'information-entry:calf-sex')
    syncEntryStatusDefaults()

    cowOptions.value = buildCowOptions(
      buildCowReferenceContext([...(cowRows || []), ...(animalRows || [])], identifierRows || []),
      identifierRows || []
    )
    operatorOptions.value = buildOperatorOptions(personRows || [])
    ensureSingleOperatorSelection()
    penOptions.value = buildAssignablePenOptions(penRows || [], farmUnits || [])
    applyPenNamesToCowOptions()
    breedOptions.value = buildBreedOptions(ensuredBreedRows || [])
    transferReasonOptions.value = buildTransferReasonOptions(ensuredTransferReasons || [])
    parityEpisodeRows.value = parityEpisodes || []
    syncDynamicFormWithActiveFields()
  }

  const singleEntryDeferredOptionsLoaded = ref(false)
  const singleEntryDeferredOptionsLoading = ref(false)

  async function loadSingleEntryDeferredOptions() {
    if (singleEntryDeferredOptionsLoaded.value || singleEntryDeferredOptionsLoading.value) return
    singleEntryDeferredOptionsLoading.value = true
    try {
      const [
        medicines,
        medicineRows,
        medicineBatches,
        diseases,
        traitDefinitions,
        v2TraitDefinitions,
        unifiedEvents
      ] = await Promise.all([
        databaseService.getTableDataAsync('medicines', { silent: true }).catch(() => []),
        databaseService.getTableDataAsync('medicine', { silent: true }).catch(() => []),
        databaseService.getTableDataAsync('medicine_batch', { silent: true }).catch(() => []),
        databaseService.getTableDataAsync('diseases', { silent: true }).catch(() => []),
        databaseService
          .getTableDataAsync('phenotype-trait-definitions', { silent: true })
          .catch(() => []),
        databaseService.getTableDataAsync('trait_definition', { silent: true }).catch(() => []),
        databaseService.getUnifiedCowEventRowsAsync().catch(() => [])
      ])
      const ensuredTraits = await ensureBodyMeasurementTraitDictionary(
        traitDefinitions || [],
        v2TraitDefinitions || []
      )
      phenotypeTraits.value = buildPhenotypeTraitList(
        traitDefinitions || [],
        v2TraitDefinitions || []
      )
      bodyMeasurementTraits.value = ensuredTraits
      diseaseOptions.value = buildDiseaseOptions(diseases || [])
      applyMedicineOptions(medicines || [], medicineRows || [], medicineBatches || [])
      parityEventRows.value = unifiedEvents || []
      updateRecentSingleEntryRecords(unifiedEvents || [])
      syncDynamicFormWithActiveFields()
      singleEntryDeferredOptionsLoaded.value = true
    } finally {
      singleEntryDeferredOptionsLoading.value = false
    }
  }

  function syncEntryStatusDefaults() {
    if (
      severityOptions.value.length &&
      !severityOptions.value.some((item) => item.value === singleForm.severity)
    ) {
      singleForm.severity = severityOptions.value[0].value
    }
    if (
      eventStatusOptions.value.length &&
      !eventStatusOptions.value.some((item) => item.value === singleForm.eventStatus)
    ) {
      singleForm.eventStatus = eventStatusOptions.value[0].value
    }
    calfRows.forEach((row) => {
      if (
        calfSexOptions.value.length &&
        !calfSexOptions.value.some((item) => item.value === row.sex)
      ) {
        row.sex = calfSexOptions.value[0].value
      }
    })
  }

  function buildOperatorOptions(personRows: any[]) {
    return uniqueOptions([
      currentOperatorOption(),
      ...(personRows || []).map((row: any) => {
        const status = textValue(row.status)
        if (status && !isEnabledStatus(status)) return null
        const name = textValue(row.name || row.realName || row.nickname || row.username)
        const role = textValue(row.role || row.department)
        const id = textValue(row.id || row.personId || row.person_id || name)
        return name ? { label: role ? `${name} / ${role}` : name, value: id, name } : null
      })
    ])
  }

  function applyPenNamesToCowOptions() {
    const penNameByValue = buildPenNameByValue(penOptions.value)
    cowOptions.value = cowOptions.value.map((cow) => ({
      ...cow,
      currentPenName: penNameByValue.get(cow.currentPen) || cow.currentPenName || cow.currentPen,
      searchText: [
        cow.cowNumber,
        cow.cowId,
        cow.cowName,
        cow.earTagNumber,
        cow.currentPen,
        penNameByValue.get(cow.currentPen) || cow.currentPenName,
        cow.currentStage,
        ...cow.aliases
      ]
        .map((item) => item.toLowerCase())
        .join(' ')
    }))
  }

  function buildBreedOptions(rows: any[]) {
    return uniqueOptions(
      (rows || []).map((row: any) => {
        const status = textValue(row.status)
        if (status && !isEnabledStatus(status)) return null
        const value = normalizeCattleBreed(
          row.name || row.breedName || row.breed_name || row.code || row.value
        )
        const category = textValue(row.category || row.origin)
        return value
          ? { label: category ? `${value} / ${category}` : value, value, name: value }
          : null
      })
    )
  }

  function buildTransferReasonOptions(rows: any[]) {
    return uniqueOptions((rows || []).map((row: any) => normalizeTransferReasonOption(row)))
  }

  function buildDiseaseOptions(rows: any[]) {
    return uniqueOptions(
      (rows || []).map((row: any) => {
        const status = textValue(row.status)
        if (status && !isEnabledStatus(status)) return null
        const name = textValue(row.name || row.diseaseName || row.disease_name || row.diagnosis)
        const category = textValue(
          row.category || row.categoryName || row.type || row.diseaseType || row.disease_type
        )
        return name ? { label: category ? `${name} / ${category}` : name, value: name, name } : null
      })
    )
  }

  function applyMedicineOptions(medicines: any[], medicineRows: any[], medicineBatches: any[]) {
    const medicineSourceRows = [...(medicines || []), ...(medicineRows || [])]
    medicineOptions.value = uniqueOptions(
      medicineSourceRows.map((row: any) => {
        const status = textValue(row.status)
        if (status && !isEnabledStatus(status)) return null
        const value = textValue(
          row.code || row.medicineCode || row.medicine_code || row.name || row.id
        )
        const name = textValue(
          row.name || row.medicineName || row.medicine_name || row.code || row.id
        )
        const category = textValue(
          row.category || row.categoryName || row.type || row.medicineType || row.medicine_type
        )
        return value ? { label: category ? `${name} / ${category}` : name, value, name } : null
      })
    )
    medicineBatchOptions.value = uniqueOptions(
      (medicineBatches || []).map((row: any) => {
        const value = textValue(
          row.batchNo || row.batch_no || row.batchCode || row.batch_code || row.code || row.id
        )
        const name = textValue(row.name || row.batchName || row.batch_name || value)
        const medicine = textValue(
          row.medicineName || row.medicine_name || row.medicineCode || row.medicine_code
        )
        return value ? { label: medicine ? `${name} / ${medicine}` : name, value, name } : null
      })
    )
    medicineUnitOptions.value = uniqueOptions(
      medicineSourceRows.map((row: any) => {
        const status = textValue(row.status)
        if (status && !isEnabledStatus(status)) return null
        const value = textValue(row.unit || row.doseUnit || row.dose_unit)
        return value ? { label: value, value, name: value } : null
      })
    )
    vaccineOptions.value = uniqueOptions(
      medicineSourceRows.map((row: any) => {
        const status = textValue(row.status)
        if (status && !isEnabledStatus(status)) return null
        const category = textValue(
          row.category || row.categoryName || row.type || row.medicineType || row.medicine_type
        )
        if (category && !category.includes('疫苗')) return null
        const value = textValue(
          row.code || row.medicineCode || row.medicine_code || row.name || row.id
        )
        const name = textValue(
          row.name || row.medicineName || row.medicine_name || row.code || row.id
        )
        return value ? { label: category ? `${name} / ${category}` : name, value, name } : null
      })
    )
  }

  async function _loadRecentSingleEntryRecords() {
    const events = await databaseService.getUnifiedCowEventRowsAsync().catch(() => [])
    updateRecentSingleEntryRecords(events || [])
  }

  function updateRecentSingleEntryRecords(events: any[]) {
    const byId = new Map<string, RecentSingleEntryRecord>()
    ;(events || [])
      .map((row) => normalizeRecentSingleRecord(row, row.sourceTable || row.source_table))
      .forEach((record) => {
        if (!record) return
        if (!byId.has(record.id) || record.sourceTable === 'animal_event') {
          byId.set(record.id, record)
        }
      })
    recentSingleRecords.value = Array.from(byId.values()).sort(
      (left, right) => right.sortTime - left.sortTime
    )
  }

  function prependRecentSingleEntryRecord(row: Record<string, any>, targetRecordId = '') {
    const occurredAt = textValue(
      row.发生时间 || row.occurredAt || row.occurred_at || todayInput()
    ).slice(0, 10)
    const eventCode = eventCodeOf(row, row)
    const option = entryEventOptions.value.find((item) => item.code === eventCode)
    const record: RecentSingleEntryRecord = {
      id:
        textValue(targetRecordId) ||
        `single-entry:${eventCode}:${occurredAt}:${textValue(row.牛号 || row.animal_number || row.cow_number)}`,
      cowNumber: textValue(row.牛号 || row.cowNumber || row.cow_number || row.animal_number),
      eventCode,
      eventGroup: textValue(
        row.eventGroup || row.event_group || option?.group || singleForm.eventGroup
      ),
      eventName: textValue(
        row.事件名称 || row.eventName || row.event_name || option?.label || eventCode
      ),
      occurredAt,
      operatorName: displayOperatorName(
        row.记录人 || row.operatorName || row.operator_name || singleForm.operatorName,
        operatorName()
      ),
      sortTime: parseTimeValue(occurredAt) || Date.now(),
      sourceTable: 'animal_event'
    }
    const next = [record, ...recentSingleRecords.value.filter((item) => item.id !== record.id)]
    recentSingleRecords.value = next
      .sort((left, right) => right.sortTime - left.sortTime)
      .slice(0, 200)
  }

  async function refreshSingleEntryRuntimeContext() {
    const [cowRows, animalRows, identifierRows, parityEpisodes, unifiedEvents] = await Promise.all([
      databaseService.getTableDataAsync('cows', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('animal', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('animal_identifier', { silent: true }).catch(() => []),
      databaseService.getTableDataAsync('parity_episode', { silent: true }).catch(() => []),
      databaseService.getUnifiedCowEventRowsAsync().catch(() => [])
    ])
    cowOptions.value = buildCowOptions(
      buildCowReferenceContext([...(cowRows || []), ...(animalRows || [])], identifierRows || []),
      identifierRows || []
    )
    parityEpisodeRows.value = parityEpisodes || []
    parityEventRows.value = unifiedEvents || []
  }

  function normalizeRecentSingleRecord(
    row: Record<string, any>,
    sourceTable: string
  ): RecentSingleEntryRecord | null {
    const details = parseRecordDetails(row.details || row.customValues || row.custom_values)
    const sourceType = textValue(
      row.sourceType || row.source_type || details.sourceType || details.source_type
    )
    const importMode = textValue(
      details.importMode || details.import_mode || row.importMode || row.import_mode
    )
    if (sourceType !== 'single_entry' && importMode !== 'single') return null
    const eventCode = eventCodeOf(row, details)
    if (!eventCode) return null
    const option = entryEventOptions.value.find((item) => item.code === eventCode)
    const occurredAt = textValue(
      row.occurredAt ||
        row.occurred_at ||
        row.eventTime ||
        row.event_time ||
        details.occurred_at ||
        details.eventTime ||
        row.createdAt ||
        row.created_at
    )
    const createdAt = textValue(
      row.createdAt || row.created_at || row.updatedAt || row.updated_at || occurredAt
    )
    const sortTime = parseTimeValue(createdAt) || parseTimeValue(occurredAt) || 0
    return {
      id: textValue(
        row.id ||
          row.eventId ||
          row.event_id ||
          `${sourceTable}:${eventCode}:${occurredAt}:${row.cowNumber || row.cow_number}`
      ),
      cowNumber: textValue(
        row.cowNumber ||
          row.cow_number ||
          row.animalNumber ||
          row.animal_number ||
          details.cowNumber ||
          details.animal_number
      ),
      eventCode,
      eventGroup: textValue(
        row.eventGroup ||
          row.event_group ||
          details.eventGroup ||
          details.event_group ||
          option?.group
      ),
      eventName: textValue(
        row.eventName ||
          row.event_name ||
          details.eventName ||
          details.event_name ||
          option?.label ||
          eventCode
      ),
      occurredAt,
      operatorName: displayOperatorName(
        row.operatorName ||
          row.operator_name ||
          row.operator ||
          details.operatorName ||
          details.operator_name ||
          details['记录人'],
        operatorName()
      ),
      sortTime,
      sourceTable
    }
  }

  function eventCodeOf(row: Record<string, any>, details: Record<string, any>) {
    const raw = textValue(
      row.eventCode ||
        row.event_code ||
        row.eventType ||
        row.event_type ||
        details.eventCode ||
        details.event_code ||
        details.eventType ||
        details.event_type ||
        details.reproduction_action ||
        details.eventName ||
        details.event_name
    )
    const matched = entryEventOptions.value.find((item) => item.code === raw || item.label === raw)
    return matched?.code || raw
  }

  function parseRecordDetails(value: unknown): Record<string, any> {
    if (!value) return {}
    if (typeof value === 'object') return value as Record<string, any>
    try {
      return JSON.parse(String(value))
    } catch {
      return {}
    }
  }

  function handleRecentSingleScroll(event: Event) {
    const target = event.currentTarget as HTMLElement
    if (!target || !hasMoreRecentSingleRecords.value) return
    if (target.scrollTop + target.clientHeight >= target.scrollHeight - 12) {
      recentSingleRenderCount.value += RECENT_SINGLE_ENTRY_PAGE_SIZE
    }
  }

  function buildCowOptions(context: CowReferenceContext, identifiers: any[] = []): CowSuggestion[] {
    const rows = [
      ...Array.from(context.byId.values()),
      ...Array.from(context.byNumber.values()),
      ...Array.from(context.byEarTag.values()),
      ...Array.from(context.byIdentifier.values())
    ]
    const aliasMap = new Map<string, Set<string>>()
    identifiers.forEach((identifier) => {
      const value = textValue(
        identifier.identifierValue ||
          identifier.identifier_value ||
          identifier.value ||
          identifier.number
      )
      if (!value) return
      const cow = context.byIdentifier.get(value)
      const key =
        cowOptionKey(cow) ||
        textValue(
          identifier.animalId || identifier.animal_id || identifier.cowId || identifier.cow_id
        )
      if (!key) return
      if (!aliasMap.has(key)) aliasMap.set(key, new Set())
      aliasMap.get(key)?.add(value)
    })
    const map = new Map<string, CowSuggestion>()
    rows.forEach((row) => {
      const cowNumber = textValue(
        row.cowNumber || row.cow_number || row.animalNumber || row.animal_number || row.number
      )
      if (!cowNumber) return
      const cowId = textValue(row.cowId || row.cow_id || row.animalId || row.animal_id || row.id)
      const cowName = textValue(row.cowName || row.name || row.nameCn)
      const earTagNumber = textValue(
        row.earTagNumber || row.ear_tag_number || row.earTag || row.ear_tag
      )
      const currentPen = textValue(
        row.currentPen ||
          row.current_pen ||
          row.currentPenId ||
          row.current_pen_id ||
          row.currentPenCode ||
          row.current_pen_code ||
          row.currentUnitId ||
          row.current_unit_id ||
          row.currentUnitCode ||
          row.current_unit_code ||
          row.unitId ||
          row.unit_id ||
          row.pen ||
          row.penName
      )
      const currentPenName = textValue(
        row.currentPenName || row.current_pen_name || row.penName || row.pen_name
      )
      const sex = textValue(row.sex || row.gender)
      const currentStage = textValue(
        row.currentStageCode ||
          row.current_stage_code ||
          row.type ||
          row.productionStage ||
          row.status ||
          sex
      )
      const key = cowId || cowNumber
      const aliases = Array.from(aliasMap.get(key) || [])
      if (map.has(key)) {
        const existing = map.get(key)
        if (existing) {
          existing.aliases = Array.from(new Set([...existing.aliases, ...aliases]))
          if (!existing.currentPen && currentPen) existing.currentPen = currentPen
          if (!existing.currentPenName && currentPenName) existing.currentPenName = currentPenName
          existing.searchText = [
            existing.cowNumber,
            existing.cowId,
            existing.cowName,
            existing.earTagNumber,
            existing.currentPen,
            existing.currentPenName,
            existing.currentStage,
            sex,
            ...existing.aliases
          ]
            .map((item) => item.toLowerCase())
            .join(' ')
        }
        return
      }
      map.set(key, {
        value: cowNumber,
        cowId,
        cowNumber,
        cowName,
        earTagNumber,
        currentPen,
        currentPenName,
        currentStage,
        aliases,
        searchText: [
          cowNumber,
          cowId,
          cowName,
          earTagNumber,
          currentPen,
          currentPenName,
          currentStage,
          sex,
          ...aliases
        ]
          .map((item) => item.toLowerCase())
          .join(' ')
      })
    })
    return Array.from(map.values()).sort((a, b) => a.cowNumber.localeCompare(b.cowNumber, 'zh-CN'))
  }

  function buildPenNameByValue(options: SelectOption[]) {
    const map = new Map<string, string>()
    options.forEach((item) => {
      const value = textValue(item.value)
      const name = textValue(item.name || item.label || value)
      if (value && !map.has(value)) map.set(value, name)
      if (name && !map.has(name)) map.set(name, name)
    })
    return map
  }

  function buildAssignablePenOptions(penRows: any[], farmUnits: any[]) {
    const penLookup = new Map<string, any>()
    ;(penRows || []).forEach((row: any) => {
      penIdentityKeys(row).forEach((key) => {
        if (key && !penLookup.has(key)) penLookup.set(key, row)
      })
    })

    const unitOptions = (farmUnits || []).map((row: any) => {
      const status = textValue(row.status)
      if (status && !isEnabledStatus(status)) return null
      const value = canonicalFarmUnitValue(row)
      if (!value) return null
      const matchedPen = penIdentityKeys(row)
        .map((key) => penLookup.get(key))
        .find(Boolean)
      const name = textValue(
        row.name ||
          row.unitName ||
          row.unit_name ||
          matchedPen?.name ||
          matchedPen?.penName ||
          matchedPen?.pen_name ||
          row.code ||
          value
      )
      const category = normalizePenCategory(
        row.category ||
          row.categoryName ||
          row.type ||
          row.unitType ||
          row.unit_type ||
          matchedPen?.category ||
          matchedPen?.categoryName ||
          matchedPen?.type,
        name
      )
      return {
        label: category ? `${name} / ${category}` : name,
        value,
        name,
        meta: { category, sourceTable: 'farm_unit' }
      }
    })

    const unitKeys = new Set((farmUnits || []).flatMap((row: any) => penIdentityKeys(row)))
    const missingPenOptions = (penRows || []).map((row: any) => {
      const status = textValue(row.status)
      if (status && !isEnabledStatus(status)) return null
      if (penIdentityKeys(row).some((key) => unitKeys.has(key))) return null
      const value = canonicalFarmUnitValue(row)
      if (!value) return null
      const name = textValue(row.name || row.penName || row.pen_name || row.code || value)
      const category = normalizePenCategory(
        row.category || row.categoryName || row.type || row.unitType || row.unit_type,
        name
      )
      return {
        label: category ? `${name} / ${category}` : name,
        value,
        name,
        meta: { category, sourceTable: 'pens', mirroredToFarmUnit: true }
      }
    })

    return uniqueOptions([...unitOptions, ...missingPenOptions])
  }

  function canonicalFarmUnitValue(row: Record<string, any>) {
    return textValue(
      row.id ||
        row.unitId ||
        row.unit_id ||
        row.code ||
        row.unitCode ||
        row.unit_code ||
        row.penCode ||
        row.pen_code ||
        row.name ||
        row.penName ||
        row.pen_name
    )
  }

  function penIdentityKeys(row: Record<string, any> | undefined) {
    if (!row) return []
    return [
      row.id,
      row.unitId,
      row.unit_id,
      row.code,
      row.unitCode,
      row.unit_code,
      row.penCode,
      row.pen_code,
      row.name,
      row.penName,
      row.pen_name,
      row.unitName,
      row.unit_name
    ]
      .map(textValue)
      .filter(Boolean)
  }

  function cowOptionKey(row: Record<string, any> | undefined) {
    if (!row) return ''
    return (
      textValue(row.cowId || row.cow_id || row.animalId || row.animal_id || row.id) ||
      textValue(
        row.cowNumber || row.cow_number || row.animalNumber || row.animal_number || row.number
      )
    )
  }

  function textValue(value: unknown) {
    return String(value ?? '').trim()
  }

  function configMatchesTemplate(config: ImportConfig, templateCode: string) {
    const scope = templateScopeOf(templateCode)
    const configTemplate = String(config.templateCode || '')
    if (configTemplate && configTemplate !== templateCode) return false
    return (
      config.scope === scope ||
      (scope === 'event' && config.scope === 'breeding') ||
      (scope === 'animal' && config.scope === 'cow')
    )
  }

  function ensureSelectedConfigMatchesTemplate() {
    if (!selectedImportConfigId.value) return
    const selected = importConfigs.value.find(
      (config) => config.id === selectedImportConfigId.value
    )
    if (!selected || !configMatchesTemplate(selected, selectedTemplateCode.value)) {
      selectedImportConfigId.value = ''
    }
  }

  function templateScopeOf(templateCode: string) {
    const map: Record<string, string> = {
      'animal-profile': 'animal',
      pedigree: 'animal',
      'animal-event': 'event',
      'reproduction-event': 'event',
      'health-medicine': 'event',
      'trait-observation': 'phenotype',
      'milk-measurement': 'milk',
      'omics-sample': 'omics',
      'omics-dataset': 'omics',
      'device-sensor': 'device'
    }
    return map[templateCode] || 'event'
  }

  function conflictText(value: string) {
    const map: Record<string, string> = {
      skip: '发现重复时跳过',
      update: '发现重复时更新',
      reject: '发现重复时报错'
    }
    return map[value] || value
  }

  function formatDateTime(value: unknown) {
    return formatDateOnly(value, '-')
  }

  const ResultPanel = defineComponent({
    props: {
      result: { type: Object as PropType<ImportDryRunResult | null>, default: null }
    },
    emits: ['download-errors'],
    setup(props, { emit }) {
      const errorRows = computed(() => props.result?.errors || [])
      const feedbackState = computed(() => {
        if (!props.result) {
          return {
            className: 'is-pending',
            emblem: '待检',
            title: '等待预检或入库',
            subtitle: '提交反馈',
            detail: '等待数据。'
          }
        }
        if (props.result.errorRows) {
          return {
            className: 'has-errors',
            emblem: '异常',
            title: `${props.result.errorRows} 行需修正`,
            subtitle: '待处理',
            detail: '修正后重试。'
          }
        }
        if (props.result.committedRows) {
          return {
            className: 'is-committed',
            emblem: '完成',
            title: `已写入 ${props.result.committedRows} 行`,
            subtitle: '提交成功',
            detail: '已入库留痕。'
          }
        }
        return {
          className: 'is-ok',
          emblem: '通过',
          title: `${props.result.validRows} 行可入库`,
          subtitle: '预检通过',
          detail: '可提交入库。'
        }
      })
      const {
        visibleItems: visibleErrorRows,
        hasMore: hasMoreErrorRows,
        loadMore: loadMoreErrorRows,
        handleWheel: onErrorRowsWheel,
        handleScroll: onErrorRowsScroll
      } = useLazyRenderWindow(errorRows, {
        initialCount: 10,
        batchSize: 10,
        mode: 'fixed-window'
      })
      return () =>
        h('div', { class: 'result-panel' }, [
          props.result
            ? h('div', { class: ['result-summary-card', feedbackState.value.className] }, [
                h('div', { class: 'result-summary-head' }, [
                  h('div', { class: 'result-summary-title' }, [
                    h('b', { class: 'result-summary-emblem' }, feedbackState.value.emblem),
                    h('div', null, [
                      h('span', feedbackState.value.subtitle),
                      h('strong', feedbackState.value.title)
                    ])
                  ]),
                  h(
                    ElButton,
                    {
                      size: 'small',
                      plain: true,
                      disabled: !props.result.errors?.length,
                      onClick: () => emit('download-errors')
                    },
                    () => '错误报告'
                  )
                ]),
                h('div', { class: 'result-status-line' }, [
                  h('span', `目标 ${props.result.target || '-'}`),
                  h('span', `批次 ${props.result.jobId || '-'}`)
                ]),
                h('p', { class: 'result-feedback-detail' }, feedbackState.value.detail),
                h('div', { class: 'result-grid' }, [
                  resultItem('总行数', props.result.totalRows),
                  resultItem('有效行', props.result.validRows),
                  resultItem('错误行', props.result.errorRows),
                  resultItem('重复行', props.result.duplicateRows),
                  resultItem('写入行', props.result.committedRows),
                  resultItem('跳过行', props.result.skippedRows)
                ])
              ])
            : h('div', { class: ['result-empty-card', feedbackState.value.className] }, [
                h('div', { class: 'result-empty-icon' }, feedbackState.value.emblem),
                h('div', null, [
                  h('span', feedbackState.value.subtitle),
                  h('strong', feedbackState.value.title),
                  h('p', feedbackState.value.detail)
                ])
              ]),
          props.result?.errors?.length
            ? h(
                'div',
                {
                  class: 'result-error-table',
                  onWheel: onErrorRowsWheel,
                  onScroll: onErrorRowsScroll
                },
                [
                  h('div', { class: 'result-error-summary' }, [
                    h(
                      'span',
                      `错误明细 ${visibleErrorRows.value.length}/${errorRows.value.length} 行`
                    ),
                    hasMoreErrorRows.value
                      ? h(
                          ElButton,
                          { size: 'small', link: true, onClick: () => loadMoreErrorRows() },
                          () => '继续加载'
                        )
                      : null
                  ]),
                  h(ElTable, { data: visibleErrorRows.value, height: 250 }, () => [
                    h(ElTableColumn, { prop: 'rowIndex', label: '行号', width: 80 }),
                    h(ElTableColumn, { prop: 'column', label: '列', width: 120 }),
                    h(ElTableColumn, { prop: 'message', label: '错误说明', 'min-width': 180 }),
                    h(ElTableColumn, { prop: 'suggestion', label: '建议', 'min-width': 160 })
                  ])
                ]
              )
            : null
        ])
    }
  })

  function resultItem(label: string, value: unknown) {
    return h('article', { class: 'mini-result' }, [
      h('span', label),
      h('strong', String(value ?? 0))
    ])
  }

  onMounted(async () => {
    const queryTemplate = String(route.query.template || '')
    const queryTab = String(route.query.tab || '')
    const queryConfigId = String(route.query.configId || '')
    applyRouteEventPreset()
    if (
      !isInformationEntryRoute.value &&
      queryTemplate &&
      templates.some((template) => template.code === queryTemplate)
    ) {
      selectedTemplateCode.value = queryTemplate
      activeTab.value = 'batch'
    }
    if (queryConfigId) selectedImportConfigId.value = queryConfigId
    if (
      !isInformationEntryRoute.value &&
      ['single', 'batch', 'templates', 'audit'].includes(queryTab)
    ) {
      activeTab.value = queryTab
    }
    normalizeActiveTabForRoute()
    await loadSingleEntryOptions()
    if (isInformationEntryRoute.value) {
      void loadImportConfigs().catch(() => undefined)
      void loadAudits().catch(() => undefined)
      return
    }
    await loadImportConfigs()
    await loadAudits()
  })

  watch(selectedTemplateCode, () => {
    ensureSelectedConfigMatchesTemplate()
  })

  watch(
    () => [
      route.path,
      route.query.eventGroup,
      route.query.eventType,
      route.meta.eventGroup,
      route.meta.eventType
    ],
    () => {
      applyRouteEventPreset()
    }
  )

  watch(activeTab, () => {
    normalizeActiveTabForRoute()
  })

  watch(
    () => singleForm.animalNumber,
    (value) => {
      if (singleForm.eventType === 'entry') {
        singleForm.cowId = ''
        return
      }
      const exact = cowOptions.value.find(
        (item) =>
          item.cowNumber === value ||
          item.earTagNumber === value ||
          item.cowId === value ||
          item.aliases.includes(value)
      )
      singleForm.cowId = exact?.cowId || ''
    }
  )

  watch(
    () => singleForm.eventType,
    () => {
      if (singleForm.eventType === 'entry') {
        singleForm.cowId = ''
      } else {
        const exact = findCowSuggestion(singleForm.animalNumber)
        singleForm.cowId = exact?.cowId || ''
      }
      syncEventNameByType()
      syncDynamicFormWithActiveFields()
      if (singleForm.eventType === 'calving') {
        if (!normalizedCalfCount()) eventDynamicForm.calf_count = 1
        ensureCalfRows(normalizedCalfCount() || 1)
      }
    }
  )

  watch(
    () => [singleForm.eventGroup, singleForm.eventType],
    () => {
      recentSingleRenderCount.value = RECENT_SINGLE_ENTRY_PAGE_SIZE
    }
  )

  watch(activeEventFields, () => {
    syncDynamicFormWithActiveFields()
  })

  watch(
    () => eventDynamicForm.calf_count,
    () => {
      if (singleForm.eventType === 'calving') ensureCalfRows(normalizedCalfCount() || 1)
    }
  )

  defineOptions({ name: 'InformationImport' })
</script>

<style scoped lang="scss">
  .information-import-page {
    min-height: 100%;
    padding: 16px;
    color: var(--fluent-text);
  }

  .template-card:hover {
    border-color: rgb(var(--fluent-primary-rgb) / 22%);
  }

  .calf-editor {
    min-width: 0;
    max-width: 100%;
    padding: 12px;
    margin: 8px 0 14px 104px;
    background: rgb(248 250 252 / 76%);
    border: 1px solid rgb(15 23 42 / 8%);
    border-radius: 8px;
  }

  .calf-editor-head {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .calf-editor-head span {
    display: block;
    font-size: 12px;
    color: #64748b;
  }

  .calf-editor-head strong {
    font-size: 14px;
    font-weight: 650;
  }

  .calf-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(136px, 1fr));
    gap: 10px 12px;
    min-width: 0;
  }

  .calf-row + .calf-row {
    padding-top: 12px;
    margin-top: 12px;
    border-top: 1px dashed rgb(15 23 42 / 10%);
  }

  .calf-row :deep(.el-form-item) {
    display: block;
    min-width: 0;
    margin-bottom: 0;
  }

  .calf-row :deep(.el-form-item__label) {
    justify-content: flex-start;
    width: auto !important;
    height: auto;
    margin-bottom: 6px;
    line-height: 18px;
  }

  .calf-row :deep(.el-form-item__content) {
    width: 100%;
    min-width: 0;
    margin-left: 0 !important;
    line-height: 32px;
  }

  .calf-row :deep(.el-input),
  .calf-row :deep(.el-select),
  .calf-row :deep(.el-input-number) {
    width: 100%;
    min-width: 0;
  }

  .calf-remark-row {
    display: flex;
    gap: 8px;
    width: 100%;
  }

  .calf-remark-row :deep(.el-input) {
    flex: 1;
    min-width: 0;
  }

  .page-head {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    justify-content: space-between;
    padding: 16px 18px;
  }

  .page-head.is-entry-head {
    align-items: center;
    background: var(--fluent-surface);
  }

  .entry-head-summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
    gap: 8px;
    min-width: min(520px, 48vw);
    padding: 8px;
    background: rgb(248 250 252);
    border: 1px solid rgb(148 163 184 / 18%);
    border-radius: 8px;
    box-shadow: none;
  }

  .entry-head-summary div {
    min-width: 0;
    padding: 8px 10px;
    background: rgb(255 255 255 / 72%);
    border: 1px solid rgb(148 163 184 / 14%);
    border-radius: 8px;
  }

  .entry-head-summary span,
  .entry-current-bar span,
  .entry-side-section-head span {
    display: block;
    color: #64748b;
    font-size: 12px;
    font-weight: 650;
  }

  .entry-head-summary strong,
  .entry-current-bar strong {
    display: block;
    min-width: 0;
    margin-top: 4px;
    overflow: hidden;
    color: #0f172a;
    font-size: 14px;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .surface-card {
    background: #fff;
    border: 1px solid rgb(15 23 42 / 9%);
    border-radius: 8px;
    box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
    transition: border-color 0.18s ease;
  }

  .section-title span,
  .metric-card span,
  .template-card span {
    font-size: 12px;
    color: #64748b;
  }

  h1,
  h2,
  h3,
  p {
    margin: 0;
  }

  h1 {
    margin-top: 4px;
    font-size: 24px;
  }

  .page-head p,
  .template-card p {
    margin-top: 8px;
    line-height: 1.65;
    color: #64748b;
  }

  .head-actions,
  .action-row,
  .template-meta,
  .tag-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .import-progress-card {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 12px;
    margin-top: 12px;
    background: rgb(248 250 252 / 82%);
    border: 1px solid rgb(15 23 42 / 8%);
    border-radius: 8px;
  }

  .import-progress-head,
  .import-progress-detail {
    display: flex;
    gap: 10px;
    align-items: center;
    justify-content: space-between;
    min-width: 0;
  }

  .import-progress-head div {
    min-width: 0;
  }

  .import-progress-head span,
  .import-progress-detail {
    color: #64748b;
    font-size: 12px;
    font-weight: 650;
  }

  .import-progress-head strong {
    display: block;
    min-width: 0;
    margin-top: 4px;
    overflow: hidden;
    color: #0f172a;
    font-size: 14px;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .import-progress-detail span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 10px;
    margin: 12px 0;
  }

  .metric-card {
    padding: 12px;
  }

  .metric-card strong {
    display: block;
    margin-top: 6px;
    font-size: 21px;
  }

  .metric-card p {
    margin-top: 6px;
    color: #64748b;
  }

  .import-tabs {
    margin-top: 8px;
  }

  .entry-flow-strip {
    display: grid;
    grid-template-columns: auto 1fr auto 1fr auto 1fr auto;
    gap: 8px;
    align-items: center;
    padding: 8px;
    margin: 12px 0;
    background: #fff;
    border: 1px solid rgb(15 23 42 / 8%);
    border-radius: 8px;
    box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
  }

  .entry-flow-step {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 2px 8px;
    align-items: center;
    min-width: 0;
    padding: 7px 9px;
    border-radius: 8px;
  }

  .entry-flow-step span {
    display: grid;
    grid-row: span 2;
    place-items: center;
    width: 28px;
    height: 28px;
    color: rgb(var(--fluent-primary-rgb));
    background: rgb(var(--fluent-primary-rgb) / 10%);
    border-radius: 50%;
    font-size: 12px;
    font-weight: 760;
  }

  .entry-flow-step strong,
  .entry-flow-step small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entry-flow-step strong {
    color: #0f172a;
    font-size: 13px;
    font-weight: 760;
  }

  .entry-flow-step small {
    color: #64748b;
    font-size: 12px;
  }

  .entry-flow-step.is-active {
    background: rgb(var(--fluent-primary-rgb) / 9%);
  }

  .entry-flow-line {
    height: 1px;
    min-width: 24px;
    background: rgb(148 163 184 / 26%);
  }

  .information-entry-mode {
    :deep(.el-tabs__header) {
      display: none;
    }

    :deep(.el-tabs__content) {
      padding-top: 0;
    }
  }

  .content-grid {
    display: grid;
    grid-template-columns: minmax(240px, 0.82fr) minmax(280px, 1.18fr);
    gap: 14px;
  }

  .single-entry-workbench {
    display: grid;
    grid-template-columns: minmax(150px, 188px) minmax(296px, 1fr) minmax(220px, 260px);
    gap: 10px;
    align-items: start;
  }

  .entry-directory,
  .entry-side-panel {
    position: sticky;
    top: 14px;
  }

  .entry-directory {
    min-width: 0;
    padding: 12px;
  }

  .entry-directory-head {
    display: grid;
    gap: 4px;
    padding: 4px 2px 12px;
    border-bottom: 1px solid rgb(148 163 184 / 18%);
  }

  .entry-directory-head span {
    color: #64748b;
    font-size: 12px;
    font-weight: 650;
  }

  .entry-directory-head strong {
    color: #0f172a;
    font-size: 18px;
    font-weight: 760;
  }

  .entry-directory-head small {
    color: #94a3b8;
    font-size: 12px;
  }

  .entry-event-list {
    display: grid;
    gap: 6px;
    max-height: calc(100vh - 260px);
    min-height: 180px;
    padding-top: 12px;
    overflow: auto;
  }

  .entry-event-button {
    display: grid;
    gap: 4px;
    width: 100%;
    min-height: 50px;
    padding: 9px 10px;
    text-align: left;
    cursor: pointer;
    background: rgb(248 250 252 / 76%);
    border: 1px solid rgb(148 163 184 / 18%);
    border-radius: 8px;
    transition:
      border-color 0.16s ease,
      background-color 0.16s ease;
  }

  .entry-event-button:hover,
  .entry-event-button.active {
    background: rgb(var(--fluent-primary-rgb) / 10%);
    border-color: rgb(var(--fluent-primary-rgb) / 34%);
  }

  .entry-event-button span,
  .entry-event-button small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entry-event-button span {
    color: #0f172a;
    font-size: 14px;
    font-weight: 720;
  }

  .entry-event-button small {
    color: #64748b;
    font-size: 11px;
    font-weight: 650;
  }

  .entry-form-stack {
    min-width: 0;
  }

  .entry-current-bar {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
    gap: 7px;
    padding: 8px;
    margin-bottom: 10px;
    background: rgb(248 250 252 / 86%);
    border: 1px solid rgb(148 163 184 / 18%);
    border-radius: 8px;
  }

  .entry-current-bar div {
    min-width: 0;
    padding: 7px 9px;
    background: rgb(255 255 255 / 68%);
    border: 1px solid rgb(148 163 184 / 14%);
    border-radius: 8px;
  }

  .form-card,
  .result-card,
  .preview-card {
    padding: 14px;
  }

  .entry-action-row {
    position: sticky;
    bottom: 0;
    z-index: 4;
    justify-content: flex-end;
    padding: 10px 0 2px;
    background: #fff;
  }

  .section-title {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 10px;
  }

  .section-title h2 {
    margin-top: 4px;
    font-size: 18px;
  }

  .compact-form {
    :deep(.el-form-item) {
      min-width: 0;
      margin-bottom: 0;
    }

    :deep(.el-form-item__label) {
      justify-content: flex-start;
      height: auto;
      min-height: 30px;
      padding-right: 8px;
      color: #475569;
      font-size: 13px;
      font-weight: 650;
      line-height: 1.45;
    }

    :deep(.el-form-item__content) {
      min-width: 0;
      line-height: 30px;
    }

    :deep(.el-input__wrapper),
    :deep(.el-select__wrapper),
    :deep(.el-textarea__inner),
    :deep(.el-input-number .el-input__wrapper) {
      min-height: 32px;
      box-shadow: 0 0 0 1px rgb(148 163 184 / 24%) inset;
    }
  }

  .form-section {
    padding: 12px;
    margin-bottom: 10px;
    background: rgb(248 250 252 / 58%);
    border: 1px solid rgb(148 163 184 / 16%);
    border-radius: 8px;
  }

  .form-section h3 {
    margin-bottom: 10px;
    color: #0f172a;
    font-size: 15px;
    font-weight: 760;
  }

  .form-section.is-compact {
    background: rgb(var(--fluent-primary-rgb) / 6%);
  }

  .form-field-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 10px 14px;
  }

  .form-field-grid :deep(.el-form-item) {
    display: grid;
    grid-template-columns: 104px minmax(0, 1fr);
    align-items: start;
  }

  .system-section {
    background: rgb(248 250 252 / 88%);
  }

  .system-fact-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 8px;
  }

  .system-fact {
    min-width: 0;
    padding: 9px 10px;
    background: rgb(255 255 255 / 72%);
    border: 1px solid rgb(148 163 184 / 18%);
    border-radius: 8px;
  }

  .system-fact span,
  .system-fact strong {
    display: block;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .system-fact span {
    color: #64748b;
    font-size: 12px;
    font-weight: 650;
  }

  .system-fact strong {
    margin-top: 6px;
    color: #0f172a;
    font-size: 13px;
    font-weight: 720;
    line-height: 1.45;
  }

  .w-full {
    width: 100%;
  }

  .cow-suggestion {
    display: flex;
    gap: 10px;
    align-items: center;
    justify-content: space-between;
  }

  .cow-suggestion strong {
    color: #0f172a;
  }

  .cow-suggestion span {
    overflow: hidden;
    color: #64748b;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .upload-box {
    display: grid;
    gap: 8px;
    justify-items: center;
    padding: 18px;
    color: #64748b;
  }

  .upload-box .el-icon {
    font-size: clamp(24px, 2vw, 30px);
  }

  .upload-box strong {
    color: #0f172a;
  }

  .preview-card {
    margin-top: 14px;
  }

  .template-grid-scroll {
    max-height: min(68vh, 720px);
    overflow-y: auto;
    padding-right: 4px;
  }

  .template-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(232px, 1fr));
    gap: 12px;
  }

  .template-card {
    display: grid;
    gap: 10px;
    align-content: space-between;
    min-height: 238px;
    padding: 13px;
    cursor: pointer;
  }

  .template-card.active {
    border-color: rgb(var(--fluent-primary-rgb) / 42%);
    box-shadow: inset 0 0 0 1px rgb(var(--fluent-primary-rgb) / 20%);
  }

  .template-field-groups {
    display: grid;
    gap: 6px;
    max-height: 192px;
    padding-right: 2px;
    overflow: auto;
  }

  .template-field-group {
    display: grid;
    gap: 3px;
    padding: 8px 10px;
    background: rgb(248 250 252 / 64%);
    border: 1px solid rgb(148 163 184 / 18%);
    border-radius: 8px;
  }

  .template-field-group strong {
    font-size: 12px;
    color: #0f172a;
  }

  .template-field-group span {
    overflow: hidden;
    font-size: 12px;
    color: #64748b;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .result-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .recent-entry-panel {
    padding-top: 12px;
    margin-top: 12px;
    border-top: 1px solid rgb(148 163 184 / 20%);
  }

  .entry-side-panel {
    display: grid;
    gap: 10px;
    max-height: calc(100vh - 160px);
    overflow: auto;
    align-content: start;
  }

  .entry-side-section {
    min-width: 0;
  }

  .entry-side-section-head {
    margin-bottom: 8px;
  }

  .entry-side-section-head span {
    color: #64748b;
    font-size: 12px;
    font-weight: 680;
  }

  .entry-side-section-head h2 {
    margin-top: 4px;
    color: #0f172a;
    font-size: 15px;
    font-weight: 760;
  }

  .result-panel {
    display: grid;
    gap: 10px;
    min-width: 0;
  }

  .result-summary-card,
  .result-empty-card {
    min-width: 0;
    padding: 15px;
    background: linear-gradient(135deg, rgb(255 255 255 / 88%), rgb(248 250 252 / 78%));
    border: 1px solid rgb(148 163 184 / 16%);
    border-left: 4px solid rgb(var(--fluent-primary-rgb) / 38%);
    border-radius: 12px;
    box-shadow:
      var(--fluent-inset-highlight),
      0 12px 28px rgb(15 23 42 / 6%);
    backdrop-filter: saturate(1.2) blur(10px);
    transition:
      transform 0.16s ease,
      border-color 0.16s ease,
      box-shadow 0.16s ease;
  }

  .result-summary-card:hover,
  .result-empty-card:hover {
    box-shadow:
      var(--fluent-inset-highlight),
      0 18px 36px rgb(15 23 42 / 8%);
    transform: var(--fluent-card-hover-transform);
  }

  .result-summary-card.has-errors {
    background: linear-gradient(135deg, rgb(254 242 242 / 92%), rgb(255 255 255 / 78%));
    border-color: rgb(220 38 38 / 22%);
    border-left-color: rgb(220 38 38 / 72%);
  }

  .result-summary-card.is-ok,
  .result-summary-card.is-committed {
    background: linear-gradient(135deg, rgb(240 253 244 / 92%), rgb(255 255 255 / 80%));
    border-color: rgb(22 163 74 / 24%);
    border-left-color: rgb(22 163 74 / 72%);
  }

  .result-summary-card.is-committed .result-summary-emblem {
    color: #047857;
    background: rgb(209 250 229 / 86%);
    border-color: rgb(5 150 105 / 26%);
  }

  .result-summary-head {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    justify-content: space-between;
    min-width: 0;
    margin-bottom: 10px;
  }

  .result-summary-title {
    display: grid;
    grid-template-columns: 46px minmax(0, 1fr);
    gap: 10px;
    align-items: center;
    min-width: 0;
  }

  .result-summary-emblem,
  .result-empty-icon {
    display: inline-grid;
    place-items: center;
    width: 46px;
    height: 46px;
    color: #047857;
    font-size: 12px;
    font-weight: 820;
    letter-spacing: 0;
    background: rgb(220 252 231 / 82%);
    border: 1px solid rgb(22 163 74 / 22%);
    border-radius: 12px;
  }

  .result-summary-card.has-errors .result-summary-emblem {
    color: #b91c1c;
    background: rgb(254 226 226 / 84%);
    border-color: rgb(220 38 38 / 24%);
  }

  .result-status-line {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-width: 0;
    margin: -2px 0 10px;
  }

  .result-status-line span {
    min-width: 0;
    overflow: hidden;
    color: #64748b;
    font-size: 12px;
    line-height: 1.35;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
    padding: 4px 7px;
    background: rgb(255 255 255 / 58%);
    border: 1px solid rgb(148 163 184 / 16%);
    border-radius: 999px;
  }

  .result-summary-head span,
  .result-empty-card span {
    display: block;
    color: #64748b;
    font-size: 12px;
    font-weight: 680;
  }

  .result-summary-head strong,
  .result-empty-card strong {
    display: block;
    min-width: 0;
    margin-top: 4px;
    color: #0f172a;
    font-size: 15px;
    font-weight: 780;
    line-height: 1.3;
    overflow: hidden;
    overflow-wrap: anywhere;
    text-overflow: ellipsis;
  }

  .result-feedback-detail {
    display: -webkit-box;
    margin: -2px 0 10px;
    overflow: hidden;
    color: #64748b;
    font-size: 12px;
    line-height: 1.45;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .result-empty-card {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr);
    gap: 10px;
    align-items: center;
    border-left-color: rgb(var(--fluent-primary-rgb) / 42%);
  }

  .result-empty-icon {
    width: 50px;
    height: 50px;
    color: rgb(var(--fluent-primary-rgb));
    font-size: 12px;
    background: rgb(var(--fluent-primary-rgb) / 8%);
    border-color: rgb(var(--fluent-primary-rgb) / 18%);
  }

  .result-empty-card p {
    margin: 0;
    color: #64748b;
    font-size: 12px;
    line-height: 1.5;
  }

  .recent-entry-head {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .recent-entry-head span {
    font-size: 12px;
    color: #64748b;
  }

  .recent-entry-head h2 {
    margin-top: 4px;
    font-size: 16px;
  }

  .recent-entry-list {
    display: grid;
    gap: 6px;
    max-height: 320px;
    padding-right: 4px;
    overflow-y: auto;
  }

  .recent-entry-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 6px 10px;
    align-items: center;
    min-width: 0;
    padding: 10px 11px;
    background: rgb(255 255 255 / 78%);
    border: 1px solid rgb(148 163 184 / 20%);
    border-radius: 8px;
    box-shadow:
      var(--fluent-inset-highlight),
      0 8px 22px rgb(15 23 42 / 5%);
    backdrop-filter: saturate(1.18) blur(10px);
    transition:
      transform 0.16s ease,
      border-color 0.16s ease,
      box-shadow 0.16s ease,
      background-color 0.16s ease;
  }

  .recent-entry-item:hover {
    background: rgb(255 255 255 / 92%);
    border-color: rgb(var(--fluent-primary-rgb) / 26%);
    box-shadow:
      var(--fluent-inset-highlight),
      0 12px 28px rgb(15 23 42 / 7%);
    transform: var(--fluent-card-hover-transform);
  }

  .recent-entry-main,
  .recent-entry-meta {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .recent-entry-meta {
    justify-items: end;
    text-align: right;
  }

  .recent-entry-main strong,
  .recent-entry-main span,
  .recent-entry-meta span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .recent-entry-main strong {
    font-size: 14px;
    color: #0f172a;
  }

  .recent-entry-main span {
    font-size: 13px;
    color: #334155;
  }

  .recent-entry-meta {
    font-size: 12px;
    color: #64748b;
  }

  .recent-entry-more {
    margin: 2px 0 0;
    font-size: 12px;
    color: #64748b;
    text-align: center;
  }

  .mini-result {
    min-width: 0;
    min-height: 70px;
    padding: 10px;
    background: rgb(255 255 255 / 68%);
    border: 1px solid rgb(148 163 184 / 22%);
    border-radius: 8px;
  }

  .mini-result span {
    font-size: 12px;
    color: #64748b;
  }

  .mini-result strong {
    display: block;
    margin-top: 4px;
    color: #0f172a;
    font-size: 16px;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }

  .result-error-table {
    max-height: 292px;
    overflow: auto;
    border: 1px solid rgb(148 163 184 / 18%);
    border-radius: 8px;
  }

  .result-error-summary {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    font-size: 12px;
    color: #64748b;
    background: rgb(248 250 252 / 94%);
    border-bottom: 1px solid rgb(148 163 184 / 18%);
  }

  .preview-table-scroll {
    max-width: 100%;
    max-height: 380px;
    overflow: auto;
  }

  .lazy-table-toolbar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 10px;
  }

  .load-more-row {
    display: flex;
    justify-content: center;
    padding-top: 12px;
  }

  .empty-text,
  .muted {
    color: #64748b;
  }

  @media (width <= 1180px) {
    .single-entry-workbench {
      grid-template-columns: minmax(170px, 210px) minmax(0, 1fr);
    }

    .entry-side-panel {
      position: static;
      grid-column: 1 / -1;
      max-height: none;
    }

    .content-grid {
      grid-template-columns: 1fr;
    }

    .calf-row {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (width <= 720px) {
    .information-import-page {
      padding: 12px;
    }

    .page-head {
      display: block;
    }

    .entry-head-summary {
      grid-template-columns: 1fr;
      min-width: 0;
      margin-top: 14px;
    }

    .head-actions {
      margin-top: 14px;
    }

    .metric-grid,
    .result-grid {
      grid-template-columns: 1fr;
    }

    .single-entry-workbench {
      grid-template-columns: 1fr;
    }

    .entry-flow-strip {
      grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
      overflow-x: auto;
    }

    .entry-flow-line {
      display: none;
    }

    .entry-directory {
      position: static;
    }

    .entry-event-list {
      grid-auto-flow: column;
      grid-auto-columns: minmax(132px, 1fr);
      max-height: none;
      min-height: 0;
      overflow-x: auto;
      overflow-y: hidden;
    }

    .entry-event-button {
      min-height: 54px;
    }

    .entry-current-bar {
      grid-template-columns: 1fr;
    }

    .form-field-grid {
      grid-template-columns: 1fr;
    }

    .form-field-grid :deep(.el-form-item) {
      display: block;
    }

    .form-field-grid :deep(.el-form-item__label) {
      width: auto !important;
      margin-bottom: 6px;
    }

    .form-field-grid :deep(.el-form-item__content) {
      margin-left: 0 !important;
    }

    .calf-editor {
      margin-left: 0;
    }

    .calf-row {
      grid-template-columns: 1fr;
    }
  }
</style>
