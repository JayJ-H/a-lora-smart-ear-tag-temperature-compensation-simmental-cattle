<template>
  <FcPageShell
    title="组学分析"
    status-label="分析平台状态"
    :status-value="statusText"
    primary-action-label="运行当前流程"
    primary-action-icon="ri:play-circle-line"
    secondary-action-label="刷新本地仓库"
    secondary-action-icon="ri:refresh-line"
    @primary-action="runCurrentWorkflow"
    @secondary-action="loadData"
  >
    <template #metrics>
      <section class="fc-metric-grid">
        <FcMetricTile
          label="本地数据仓库"
          :value="repositoryCards.length"
          note="直接调用系统内表型、系谱、奶厅和组学数据"
          icon="ri:database-2-line"
        />
        <FcMetricTile
          label="分析模块"
          :value="analysisModules.length"
          note="覆盖预处理、降维、差异、机器学习、通路与可视化"
          icon="ri:function-line"
          tone="teal"
        />
        <FcMetricTile
          label="模块结果"
          :value="moduleResults.length"
          note="PCA、随机森林、通路富集等结果可直接复核"
          icon="ri:bar-chart-box-line"
          tone="info"
        />
        <FcMetricTile
          label="工作流模板"
          :value="workflowTemplates.length"
          note="面向泌乳性能、繁殖效率和综合育种值"
          icon="ri:flow-chart"
          tone="warning"
        />
      </section>
    </template>

    <section class="workbench-nav" aria-label="组学分析工作台导航">
      <button
        v-for="section in sections"
        :key="section.key"
        class="section-button"
        :class="{ active: activeSection === section.key }"
        type="button"
        @click="activeSection = section.key"
      >
        <ArtSvgIcon :icon="section.icon" />
        <span>{{ section.label }}</span>
      </button>
    </section>

    <section class="overview-grid">
      <FcPanel title="本地数据调用">
        <div class="local-chain">
          <article
            v-for="item in localDataChain"
            :key="item.label"
            class="chain-card"
            :class="item.tone"
          >
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
            <p>{{ item.note }}</p>
          </article>
        </div>
      </FcPanel>

      <FcPanel title="目标性状覆盖">
        <div class="trait-radar">
          <div id="omics-trait-radar" class="chart-box"></div>
        </div>
      </FcPanel>
    </section>

    <section v-if="activeSection === 'repositories'" class="section-stack">
      <FcPanel title="本地数据仓库">
        <div class="repository-ingest-note">
          <div>
            <span>数据接入边界</span>
            <strong>不提供外部上传入口</strong>
          </div>
          <p> 组学模块读取系统内已归档数据。 </p>
        </div>
        <div class="repository-grid">
          <article
            v-for="repo in repositoryCards"
            :key="repo.id"
            class="repository-card"
            :class="repo.tone"
          >
            <div class="card-head">
              <div class="icon-box">
                <ArtSvgIcon :icon="repo.icon" />
              </div>
              <ElTag :type="repo.tagType">{{ repo.status }}</ElTag>
            </div>
            <h3>{{ repo.title }}</h3>
            <div class="repo-stats">
              <div>
                <span>记录数</span>
                <strong>{{ repo.count }}</strong>
              </div>
              <div>
                <span>关联键</span>
                <strong>{{ repo.linkKey }}</strong>
              </div>
              <div>
                <span>刷新</span>
                <strong>{{ repo.refreshText }}</strong>
              </div>
            </div>
          </article>
        </div>
      </FcPanel>

      <section class="split-grid">
        <FcPanel title="仓库字段预览">
          <ElTable :data="repositoryPreviewRows" height="360">
            <ElTableColumn prop="source" label="数据源" width="150" />
            <ElTableColumn prop="entity" label="主实体" width="120" />
            <ElTableColumn prop="fields" label="关键字段" min-width="260" />
            <ElTableColumn prop="downstream" label="下游用途" min-width="220" />
          </ElTable>
        </FcPanel>

        <FcPanel title="可分析群体">
          <div
            ref="linkedCowCardContainerRef"
            class="cow-mini-list-viewport"
            @scroll.passive="onLinkedCowCardScroll"
            @wheel.passive="onLinkedCowCardWheel"
          >
            <div class="cow-mini-list">
              <article v-for="row in visibleLinkedCowCards" :key="row.id" class="cow-mini-card">
                <div>
                  <span>{{ row.pen }}</span>
                  <h3>牛号 {{ row.cowNumber }}</h3>
                  <p>父 {{ row.fatherNumber }} / 母 {{ row.motherNumber }}</p>
                </div>
                <div class="cow-mini-score">
                  <strong>{{ row.readyScore }}%</strong>
                  <small>分析就绪</small>
                </div>
              </article>
            </div>
            <div v-if="linkedCowCards.length > visibleLinkedCowCards.length" class="load-more-row">
              <ElButton size="small" plain @click="loadMoreLinkedCowCards()">
                继续加载 {{ visibleLinkedCowCards.length }}/{{ linkedCowCards.length }}
              </ElButton>
            </div>
          </div>
        </FcPanel>
      </section>
    </section>

    <section v-else-if="activeSection === 'modules'" class="section-stack">
      <FcPanel title="分析模块库">
        <div class="module-toolbar">
          <ElSegmented v-model="moduleCategory" :options="moduleCategories" />
          <ElInput
            v-model="moduleKeyword"
            clearable
            placeholder="搜索 PCA、KEGG、随机森林、差异分析..."
          />
        </div>
        <div
          ref="analysisModuleGridContainerRef"
          class="analysis-module-grid-scroll"
          @scroll.passive="onAnalysisModuleScroll"
          @wheel.passive="onAnalysisModuleWheel"
        >
          <div class="analysis-module-grid">
            <article
              v-for="module in visibleAnalysisModules"
              :key="module.id"
              class="analysis-module-card"
              :class="[module.tone, { active: selectedModule?.id === module.id }]"
              tabindex="0"
              @click="openModule(module)"
              @keyup.enter="openModule(module)"
            >
              <div class="module-card-head">
                <span>{{ module.category }}</span>
                <ElTag size="small" :type="module.tagType">{{ module.runtime }}</ElTag>
              </div>
              <h3>{{ module.name }}</h3>
              <div class="method-tags">
                <span v-for="tag in module.inputs" :key="tag">{{ tag }}</span>
              </div>
              <div class="module-footer">
                <ElButton size="small" text @click.stop="openModule(module)">配置运行</ElButton>
              </div>
            </article>
            <ElEmpty v-if="!filteredAnalysisModules.length" description="暂无匹配模块" />
          </div>
          <div v-if="filteredAnalysisModules.length" class="load-more-row">
            <span>
              当前窗口 {{ analysisModuleStartIndex + 1 }}-{{ analysisModuleEndIndex }} /
              {{ analysisModuleTotalCount }} 个模块
            </span>
          </div>
        </div>
      </FcPanel>

      <FcPanel v-if="selectedModule" title="模块操作台">
        <section class="module-operation-layout">
          <div class="module-operation-card" :class="selectedModule.tone">
            <div class="result-card-head">
              <div>
                <span>{{ selectedModule.category }}</span>
                <h3>{{ selectedModule.name }}</h3>
              </div>
              <ElTag :type="selectedModule.tagType">{{ selectedModule.runtime }}</ElTag>
            </div>
            <div class="method-tags">
              <span v-for="tag in selectedModule.inputs" :key="tag">{{ tag }}</span>
            </div>
            <div class="module-result-preview">
              <span>输出</span>
              <strong>{{ selectedModule.output }}</strong>
            </div>
          </div>

          <div class="module-parameter-panel">
            <div class="parameter-toolbar">
              <div>
                <span>参数总数</span>
                <strong>{{ moduleParameterControls.length }}</strong>
              </div>
              <div>
                <span>高级参数</span>
                <strong>{{ advancedParameterCount }}</strong>
              </div>
            </div>
            <div v-if="moduleParameterControls.length" class="parameter-schema-grid compact">
              <label
                v-for="control in moduleParameterControls"
                :key="control.key"
                :class="{ advanced: control.advanced, required: control.required }"
              >
                <span class="parameter-label">
                  {{ control.label }}
                  <ElTag v-if="control.required" size="small" type="danger">必填</ElTag>
                  <ElTag v-if="control.advanced" size="small" type="info">高级</ElTag>
                </span>
                <small>{{ parameterHelpText(control) }}</small>
                <ElSelect
                  v-if="control.key === 'repositoryId'"
                  v-model="moduleRunForm.repositoryId"
                >
                  <ElOption
                    v-for="repo in repositoryCards"
                    :key="repo.id"
                    :label="repo.title"
                    :value="repo.id"
                  />
                </ElSelect>
                <ElSelect v-else-if="control.key === 'trait'" v-model="moduleRunForm.trait">
                  <ElOption
                    v-for="trait in workflowTraits"
                    :key="trait"
                    :label="trait"
                    :value="trait"
                  />
                </ElSelect>
                <ElSelect
                  v-else-if="control.type === 'select'"
                  v-model="moduleRunForm[control.key]"
                >
                  <ElOption
                    v-for="option in control.options || []"
                    :key="option.value"
                    :label="option.label"
                    :value="option.value"
                  />
                </ElSelect>
                <ElSwitch
                  v-else-if="control.type === 'boolean'"
                  :model-value="getBooleanModuleParam(control.key)"
                  @update:model-value="setBooleanModuleParam(control.key, $event)"
                  active-text="开"
                  inactive-text="关"
                />
                <ElSlider
                  v-else-if="control.type === 'slider'"
                  :model-value="getNumericModuleParam(control.key)"
                  @update:model-value="setNumericModuleParam(control.key, $event)"
                  :min="control.min"
                  :max="control.max"
                  :step="control.step"
                />
                <ElInputNumber
                  v-else-if="control.type === 'number'"
                  :model-value="getNumericModuleParam(control.key)"
                  @update:model-value="setNumericModuleParam(control.key, $event)"
                  :min="control.min"
                  :max="control.max"
                  :step="control.step"
                  controls-position="right"
                />
                <ElInput
                  v-else
                  :model-value="getTextModuleParam(control.key)"
                  @update:model-value="setTextModuleParam(control.key, $event)"
                />
                <strong class="parameter-current"
                  >当前值：{{ formatParameterValue(moduleRunForm[control.key]) }}</strong
                >
              </label>
            </div>
            <div class="io-summary">
              <div>
                <span>Input</span>
                <strong>{{ selectedModule.inputs.join(' / ') }}</strong>
              </div>
              <div>
                <span>Output</span>
                <strong>{{ selectedModule.output }}</strong>
              </div>
            </div>
            <ElButton type="primary" :loading="runningModule" @click="runSelectedModule"
              >运行当前模块</ElButton
            >
          </div>
        </section>
      </FcPanel>
    </section>

    <section v-else-if="activeSection === 'moduleResults'" class="section-stack">
      <FcPanel title="模块结果">
        <div class="result-grid">
          <article
            v-for="result in visibleModuleResults"
            :key="result.id"
            class="result-card"
            :class="result.tone"
            role="button"
            tabindex="0"
            @click="openModuleResultDetail(result)"
            @keydown.enter.prevent="openModuleResultDetail(result)"
            @keydown.space.prevent="openModuleResultDetail(result)"
          >
            <div class="result-card-head">
              <div>
                <span>{{ result.module }}</span>
                <h3>{{ result.title }}</h3>
              </div>
              <ElTag :type="result.tagType">{{ result.status }}</ElTag>
            </div>
            <p>{{ result.summary }}</p>
            <div class="result-metrics">
              <div v-for="metric in result.metrics" :key="metric.label">
                <span>{{ metric.label }}</span>
                <strong>{{ metric.value }}</strong>
              </div>
            </div>
            <div class="method-tags">
              <span v-for="tag in result.tags" :key="tag">{{ tag }}</span>
            </div>
            <div v-if="result.parameters" class="workflow-trace">
              <span>运行参数</span>
              <strong>{{ result.parameters }}</strong>
            </div>
            <div v-if="parameterSnapshotRows(result).length" class="result-preview-block">
              <span>参数快照</span>
              <div class="parameter-snapshot-grid">
                <div v-for="row in parameterSnapshotRows(result)" :key="row.key">
                  <span>{{ row.label }}</span>
                  <strong>{{ row.value }}</strong>
                  <small>{{ row.group }}{{ row.algorithm ? ` / ${row.algorithm}` : '' }}</small>
                </div>
              </div>
            </div>
            <div class="result-io-grid">
              <div>
                <span>输入来源</span>
                <strong>{{ result.dataSource || 'local' }}</strong>
              </div>
              <div>
                <span>表格输出</span>
                <strong>{{ objectKeys(result.tables).join(' / ') || '无' }}</strong>
              </div>
              <div>
                <span>图表输出</span>
                <strong>{{ objectKeys(result.charts).join(' / ') || '无' }}</strong>
              </div>
            </div>
            <div v-if="result.methodNotes?.length" class="method-note-list">
              <span v-for="note in result.methodNotes" :key="note">{{ note }}</span>
            </div>
            <div class="run-meta-grid">
              <div
                ><span>操作人</span><strong>{{ result.operator || 'system' }}</strong></div
              >
              <div
                ><span>任务编号</span><strong>{{ result.runCode || '-' }}</strong></div
              >
              <div
                ><span>开始时间</span
                ><strong>{{ result.startedAt || result.executedAt || '-' }}</strong></div
              >
              <div
                ><span>结束时间</span
                ><strong>{{ result.finishedAt || result.executedAt || '-' }}</strong></div
              >
              <div
                ><span>运行耗时</span><strong>{{ formatDuration(result.durationMs) }}</strong></div
              >
            </div>
            <div v-if="result.inputSummary" class="workflow-trace">
              <span>输入快照</span>
              <strong>{{ formatJson(result.inputSummary) }}</strong>
            </div>
            <div v-if="objectKeys(result.charts).length" class="result-preview-block">
              <span>图表预览</span>
              <div v-for="key in objectKeys(result.charts)" :key="key" class="mini-chart-card">
                <strong>{{ key }}</strong>
                <div class="mini-chart-bars">
                  <i
                    v-for="(point, index) in chartPreviewPoints(result.charts?.[key]).slice(0, 12)"
                    :key="`${key}-${index}`"
                    :style="{ height: `${Math.max(10, Math.min(96, Number(point.value) || 18))}%` }"
                  />
                </div>
              </div>
            </div>
            <div v-if="objectKeys(result.tables).length" class="result-preview-block">
              <span>表格预览</span>
              <div v-for="key in objectKeys(result.tables)" :key="key" class="table-preview-card">
                <strong>{{ key }}</strong>
                <ElTable :data="tablePreviewRows(result.tables?.[key])" size="small" height="180">
                  <ElTableColumn
                    v-for="column in tablePreviewColumns(result.tables?.[key])"
                    :key="column"
                    :prop="column"
                    :label="column"
                    min-width="120"
                  />
                </ElTable>
              </div>
            </div>
            <div v-if="result.artifacts?.length" class="result-preview-block">
              <span>输出工件</span>
              <div class="artifact-list">
                <div
                  v-for="artifact in result.artifacts"
                  :key="`${artifact.type}-${artifact.name}`"
                >
                  <strong>{{ artifact.name }}</strong>
                  <small
                    >{{ artifact.type }} /
                    {{ artifact.rows ?? artifact.points ?? '结构化输出' }}</small
                  >
                </div>
              </div>
            </div>
            <div class="export-actions">
              <ElButton size="small" @click.stop="exportResult(result, 'json')">导出 JSON</ElButton>
              <ElButton size="small" @click.stop="exportResult(result, 'csv')"
                >导出表格 CSV</ElButton
              >
            </div>
          </article>
        </div>
        <div v-if="moduleResults.length > visibleModuleResults.length" class="load-more-row">
          <ElButton @click="() => loadMoreModuleResults()"
            >加载更多 {{ visibleModuleResults.length }}/{{ moduleResults.length }}</ElButton
          >
        </div>
      </FcPanel>

      <section class="split-grid">
        <FcPanel title="PCA 与分组趋势">
          <div id="omics-pca-chart" class="chart-box"></div>
        </FcPanel>
        <FcPanel title="候选标记与性状关联">
          <div id="omics-marker-chart" class="chart-box"></div>
        </FcPanel>
      </section>
    </section>

    <section v-else-if="activeSection === 'workflow'" class="section-stack">
      <FcPanel title="工作流编排">
        <section class="workflow-layout">
          <aside class="workflow-sidebar">
            <h3>工作流</h3>
            <div class="workflow-create-box">
              <ElInput v-model="newWorkflowName" placeholder="输入新工作流名称" />
              <ElButton type="primary" plain @click="createWorkflow">创建工作流</ElButton>
            </div>

            <h3>本地数据源</h3>
            <ElCheckboxGroup v-model="selectedRepositoryIds" class="source-option-group">
              <label v-for="repo in repositoryCards" :key="repo.id" class="source-option">
                <ElCheckbox :label="repo.id">{{ repo.title }}</ElCheckbox>
                <span>{{ repo.count }} 条</span>
              </label>
            </ElCheckboxGroup>

            <h3>模板</h3>
            <button
              v-for="template in workflowTemplates"
              :key="template.id"
              class="template-button"
              :class="{ active: activeWorkflowTemplateId === template.id }"
              type="button"
              @click="activeWorkflowTemplateId = template.id"
            >
              <span>{{ template.name }}</span>
              <small>{{ template.target }}</small>
            </button>
          </aside>

          <div class="workflow-canvas">
            <div class="workflow-title-row">
              <div>
                <span>Workflow Canvas</span>
                <h3>{{ activeWorkflowTemplate.name }}</h3>
              </div>
              <ElTag type="success">调用本地数据</ElTag>
            </div>

            <div class="workflow-steps">
              <article
                v-for="(step, index) in activeWorkflowSteps"
                :key="step.id"
                class="workflow-step-card"
                role="button"
                tabindex="0"
                @click="openWorkflowStepDetail(step, index)"
                @keydown.enter.prevent="openWorkflowStepDetail(step, index)"
                @keydown.space.prevent="openWorkflowStepDetail(step, index)"
              >
                <div class="step-index">{{ index + 1 }}</div>
                <div>
                  <span>{{ step.category }}</span>
                  <h3>{{ step.name }}</h3>
                  <div class="workflow-step-actions">
                    <ElButton size="small" text @click.stop="toggleWorkflowStepParams(step.id)">
                      {{ expandedWorkflowStepId === step.id ? '收起参数' : '配置参数' }}
                    </ElButton>
                    <ElButton
                      size="small"
                      text
                      :disabled="index === 0"
                      @click.stop="moveWorkflowStep(index, -1)"
                      >上移</ElButton
                    >
                    <ElButton
                      size="small"
                      text
                      :disabled="index === activeWorkflowSteps.length - 1"
                      @click.stop="moveWorkflowStep(index, 1)"
                      >下移</ElButton
                    >
                    <ElButton
                      size="small"
                      text
                      type="danger"
                      @click.stop="removeWorkflowStep(step.id)"
                      >移除</ElButton
                    >
                  </div>
                  <div v-if="expandedWorkflowStepId === step.id" class="workflow-step-params">
                    <label
                      v-for="control in getModuleParameterControls(step.id)"
                      :key="`${step.id}-${control.key}`"
                      :class="{ advanced: control.advanced, required: control.required }"
                    >
                      <span class="parameter-label">
                        {{ control.label }}
                        <ElTag v-if="control.required" size="small" type="danger">必填</ElTag>
                        <ElTag v-if="control.advanced" size="small" type="info">高级</ElTag>
                      </span>
                      <small>{{ parameterHelpText(control) }}</small>
                      <ElSelect
                        v-if="control.key === 'repositoryId'"
                        :model-value="getWorkflowStepText(step.id, control)"
                        @update:model-value="setWorkflowStepValue(step.id, control.key, $event)"
                      >
                        <ElOption
                          v-for="repo in repositoryCards"
                          :key="repo.id"
                          :label="repo.title"
                          :value="repo.id"
                        />
                      </ElSelect>
                      <ElSelect
                        v-else-if="control.key === 'trait'"
                        :model-value="getWorkflowStepText(step.id, control)"
                        @update:model-value="setWorkflowStepValue(step.id, control.key, $event)"
                      >
                        <ElOption
                          v-for="trait in workflowTraits"
                          :key="trait"
                          :label="trait"
                          :value="trait"
                        />
                      </ElSelect>
                      <ElSelect
                        v-else-if="control.type === 'select'"
                        :model-value="getWorkflowStepText(step.id, control)"
                        @update:model-value="setWorkflowStepValue(step.id, control.key, $event)"
                      >
                        <ElOption
                          v-for="option in control.options || []"
                          :key="option.value"
                          :label="option.label"
                          :value="option.value"
                        />
                      </ElSelect>
                      <ElSwitch
                        v-else-if="control.type === 'boolean'"
                        :model-value="getWorkflowStepBoolean(step.id, control)"
                        @update:model-value="setWorkflowStepValue(step.id, control.key, $event)"
                        active-text="开"
                        inactive-text="关"
                      />
                      <ElSlider
                        v-else-if="control.type === 'slider'"
                        :model-value="getWorkflowStepNumber(step.id, control)"
                        @update:model-value="setWorkflowStepValue(step.id, control.key, $event)"
                        :min="control.min"
                        :max="control.max"
                        :step="control.step"
                      />
                      <ElInputNumber
                        v-else-if="control.type === 'number'"
                        :model-value="getWorkflowStepNumber(step.id, control)"
                        @update:model-value="setWorkflowStepValue(step.id, control.key, $event)"
                        :min="control.min"
                        :max="control.max"
                        :step="control.step"
                        controls-position="right"
                      />
                      <ElInput
                        v-else
                        :model-value="getWorkflowStepText(step.id, control)"
                        @update:model-value="setWorkflowStepValue(step.id, control.key, $event)"
                      />
                      <strong class="parameter-current">
                        当前值：{{
                          formatParameterValue(getWorkflowStepValue(step.id, control.key, control))
                        }}
                      </strong>
                    </label>
                  </div>
                </div>
              </article>
            </div>

            <div class="workflow-module-picker">
              <div class="workflow-picker-head">
                <span>添加步骤</span>
                <ElSelect v-model="workflowModuleCategory" size="small">
                  <ElOption label="全部模块" value="全部" />
                  <ElOption
                    v-for="category in moduleCategories.filter((item) => item !== '全部')"
                    :key="category"
                    :label="category"
                    :value="category"
                  />
                </ElSelect>
              </div>
              <div
                ref="workflowModuleContainerRef"
                class="workflow-picker-scroll"
                @scroll.passive="onWorkflowModuleScroll"
                @wheel.passive="onWorkflowModuleWheel"
              >
                <div class="workflow-picker-grid">
                  <button
                    v-for="module in visibleWorkflowAvailableModules"
                    :key="module.id"
                    class="workflow-module-chip"
                    type="button"
                    @click="addModuleToWorkflow(module.id)"
                  >
                    <span>{{ module.category }}</span>
                    <strong>{{ module.name }}</strong>
                  </button>
                </div>
                <div v-if="workflowAvailableModules.length" class="load-more-row">
                  <span>
                    当前窗口 {{ workflowModuleStartIndex + 1 }}-{{ workflowModuleEndIndex }} /
                    {{ workflowModuleTotalCount }} 个模块
                  </span>
                </div>
              </div>
            </div>
          </div>

          <aside class="parameter-panel">
            <h3>Parameters</h3>
            <label>
              <span>目标性状</span>
              <ElSelect v-model="workflowParams.trait">
                <ElOption
                  v-for="trait in workflowTraits"
                  :key="trait"
                  :label="trait"
                  :value="trait"
                />
              </ElSelect>
            </label>
            <label>
              <span>分组方式</span>
              <ElSelect v-model="workflowParams.groupBy">
                <ElOption label="高低表型组" value="phenotype_group" />
                <ElOption label="胎次分组" value="parity_group" />
                <ElOption label="系谱家系" value="pedigree_family" />
                <ElOption label="泌乳阶段" value="lactation_stage" />
              </ElSelect>
            </label>
            <label>
              <span>缺失值阈值</span>
              <ElSlider v-model="workflowParams.missingRate" :min="0" :max="40" :step="5" />
            </label>
            <label>
              <span>交叉验证折数</span>
              <ElInputNumber v-model="workflowParams.cvFold" :min="3" :max="10" />
            </label>
            <label>
              <span>操作人</span>
              <ElInput v-model="workflowParams.operator" placeholder="记录工作流运行人员" />
            </label>
            <label>
              <span>任务编号</span>
              <ElInput v-model="workflowParams.runCode" placeholder="自动生成，可按项目编号修改" />
            </label>
            <label>
              <span>元数据说明</span>
              <ElInput
                v-model="workflowParams.metadataNote"
                placeholder="批次、样本来源或筛选说明"
              />
            </label>
            <div class="parameter-summary">
              <span>已选仓库 {{ selectedRepositoryIds.length }} 个</span>
              <strong>{{ activeWorkflowSteps.length }} 个模块将运行</strong>
            </div>
          </aside>
        </section>
      </FcPanel>

      <FcPanel title="工作流运行记录">
        <div class="run-record-grid">
          <article
            v-for="record in visibleWorkflowRunRecords"
            :key="record.id"
            class="run-record-card"
            :class="record.tone"
          >
            <div class="result-card-head">
              <div>
                <span>{{ record.executedAt }}</span>
                <h3>{{ record.title }}</h3>
              </div>
              <ElTag :type="record.statusType">{{ record.status }}</ElTag>
            </div>
            <p>{{ record.summary }}</p>
            <div class="record-line">
              <span>输入仓库</span>
              <strong>{{ record.repositoryTitles.join(' / ') }}</strong>
            </div>
            <div class="record-line">
              <span>模块链路</span>
              <strong>{{ record.moduleNames.join(' -> ') }}</strong>
            </div>
            <div class="record-line">
              <span>参数快照</span>
              <strong>{{ record.parameterSnapshot }}</strong>
            </div>
          </article>
        </div>
        <div
          v-if="recentWorkflowRunRecords.length > visibleWorkflowRunRecords.length"
          class="load-more-row"
        >
          <ElButton @click="() => loadMoreWorkflowRunRecords()">
            加载更多 {{ visibleWorkflowRunRecords.length }}/{{ recentWorkflowRunRecords.length }}
          </ElButton>
        </div>
      </FcPanel>
    </section>

    <section v-else-if="activeSection === 'workflowResults'" class="section-stack">
      <FcPanel title="工作流结果">
        <div class="workflow-result-grid">
          <article
            v-for="result in visibleWorkflowResults"
            :key="result.id"
            class="workflow-result-card"
            :class="result.tone"
            role="button"
            tabindex="0"
            @click="openWorkflowResultDetail(result)"
            @keydown.enter.prevent="openWorkflowResultDetail(result)"
            @keydown.space.prevent="openWorkflowResultDetail(result)"
          >
            <div class="result-card-head">
              <div>
                <span>{{ result.template }}</span>
                <h3>{{ result.title }}</h3>
              </div>
              <strong>{{ result.score }}</strong>
            </div>
            <div v-if="result.executedAt" class="result-source">
              <ElTag size="small" :type="result.statusType">{{ result.status }}</ElTag>
              <span>{{ result.executedAt }}</span>
            </div>
            <p>{{ result.summary }}</p>
            <div class="result-metrics">
              <div v-for="metric in result.metrics" :key="metric.label">
                <span>{{ metric.label }}</span>
                <strong>{{ metric.value }}</strong>
              </div>
            </div>
            <div v-if="result.moduleNames?.length" class="workflow-trace">
              <span>模块链路</span>
              <strong>{{ result.moduleNames.join(' -> ') }}</strong>
            </div>
            <div class="run-meta-grid">
              <div
                ><span>操作人</span><strong>{{ result.operator || 'system' }}</strong></div
              >
              <div
                ><span>任务编号</span><strong>{{ result.runCode || '-' }}</strong></div
              >
              <div
                ><span>开始时间</span
                ><strong>{{ result.startedAt || result.executedAt || '-' }}</strong></div
              >
              <div
                ><span>结束时间</span
                ><strong>{{ result.finishedAt || result.executedAt || '-' }}</strong></div
              >
              <div
                ><span>运行耗时</span><strong>{{ formatDuration(result.durationMs) }}</strong></div
              >
            </div>
            <div v-if="result.parameterSnapshot || result.parameters" class="workflow-trace">
              <span>参数快照</span>
              <strong>{{ result.parameterSnapshot || formatJson(result.parameters) }}</strong>
            </div>
            <div v-if="workflowStepParameterRows(result).length" class="result-preview-block">
              <span>步骤参数</span>
              <div class="parameter-snapshot-grid">
                <div v-for="row in workflowStepParameterRows(result)" :key="row.key">
                  <span>{{ row.label }}</span>
                  <strong>{{ row.value }}</strong>
                  <small>{{ row.moduleName }}</small>
                </div>
              </div>
            </div>
            <div v-if="result.inputSummary" class="workflow-trace">
              <span>输入快照</span>
              <strong>{{ formatJson(result.inputSummary) }}</strong>
            </div>
            <div class="result-io-grid">
              <div>
                <span>输入来源</span>
                <strong>{{
                  result.repositoryTitles.join(' / ') || result.dataSource || 'local'
                }}</strong>
              </div>
              <div>
                <span>表格输出</span>
                <strong>{{ objectKeys(result.tables).join(' / ') || '无' }}</strong>
              </div>
              <div>
                <span>图表输出</span>
                <strong>{{ objectKeys(result.charts).join(' / ') || '无' }}</strong>
              </div>
            </div>
            <div v-if="objectKeys(result.tables).length" class="result-preview-block">
              <span>模块运行表</span>
              <div v-for="key in objectKeys(result.tables)" :key="key" class="table-preview-card">
                <strong>{{ key }}</strong>
                <ElTable :data="tablePreviewRows(result.tables?.[key])" size="small" height="180">
                  <ElTableColumn
                    v-for="column in tablePreviewColumns(result.tables?.[key])"
                    :key="column"
                    :prop="column"
                    :label="column"
                    min-width="120"
                  />
                </ElTable>
              </div>
            </div>
            <div v-if="result.artifacts?.length" class="result-preview-block">
              <span>输出工件</span>
              <div class="artifact-list">
                <div
                  v-for="artifact in result.artifacts"
                  :key="`${artifact.moduleRunId}-${artifact.type}-${artifact.name}`"
                >
                  <strong>{{ artifact.name }}</strong>
                  <small
                    >{{ artifact.moduleName || artifact.type }} /
                    {{ artifact.rows ?? artifact.points ?? '结构化输出' }}</small
                  >
                </div>
              </div>
            </div>
            <div v-if="result.methodNotes?.length" class="method-note-list">
              <span v-for="note in result.methodNotes.slice(0, 8)" :key="note">{{ note }}</span>
            </div>
            <div class="workflow-conclusion">{{ result.conclusion }}</div>
            <div class="export-actions">
              <ElButton size="small" @click.stop="exportWorkflowResult(result, 'json')"
                >导出 JSON</ElButton
              >
              <ElButton size="small" @click.stop="exportWorkflowResult(result, 'csv')"
                >导出表格 CSV</ElButton
              >
            </div>
          </article>
        </div>
        <div v-if="workflowResults.length > visibleWorkflowResults.length" class="load-more-row">
          <ElButton @click="() => loadMoreWorkflowResults()"
            >加载更多 {{ visibleWorkflowResults.length }}/{{ workflowResults.length }}</ElButton
          >
        </div>
      </FcPanel>

      <FcPanel title="候选个体输出">
        <ElTable
          :data="visibleWorkflowCandidateRows"
          height="360"
          @wheel.passive="onWorkflowCandidateWheel"
        >
          <ElTableColumn prop="rank" label="排名" width="80" />
          <ElTableColumn prop="cowNumber" label="牛号" width="120" />
          <ElTableColumn prop="trait" label="目标性状" width="140" />
          <ElTableColumn prop="phenotype" label="表型证据" min-width="170" />
          <ElTableColumn prop="genomic" label="组学证据" min-width="180" />
          <ElTableColumn prop="pedigree" label="系谱证据" min-width="150" />
          <ElTableColumn prop="decision" label="建议" min-width="220" />
        </ElTable>
        <div
          v-if="workflowCandidateRows.length > visibleWorkflowCandidateRows.length"
          class="load-more-row"
        >
          <ElButton @click="() => loadMoreWorkflowCandidateRows()">
            加载更多 {{ visibleWorkflowCandidateRows.length }}/{{ workflowCandidateRows.length }}
          </ElButton>
        </div>
      </FcPanel>
    </section>

    <section v-else class="section-stack">
      <FcPanel title="使用指南">
        <div class="guide-grid">
          <article v-for="item in guideItems" :key="item.title" class="guide-card">
            <div class="guide-index">{{ item.index }}</div>
            <div>
              <h3>{{ item.title }}</h3>
            </div>
          </article>
        </div>
      </FcPanel>
    </section>
    <ElDialog
      v-model="moduleDialogVisible"
      :title="selectedModule ? `${selectedModule.name} 参数配置` : '模块参数配置'"
      width="1040px"
      class="module-run-dialog"
    >
      <section v-if="selectedModule" class="module-dialog-grid">
        <div class="module-dialog-summary" :class="selectedModule.tone">
          <span>{{ selectedModule.category }}</span>
          <h3>{{ selectedModule.name }}</h3>
          <div class="method-tags">
            <span v-for="tag in selectedModule.inputs" :key="tag">{{ tag }}</span>
          </div>
          <div class="module-result-preview">
            <span>输出</span>
            <strong>{{ selectedModule.output }}</strong>
          </div>
        </div>
        <div class="module-dialog-form">
          <div class="run-context-grid">
            <label>
              <span>操作人</span>
              <ElInput v-model="moduleRunForm.operator" placeholder="记录本次运行人员" />
            </label>
            <label>
              <span>任务编号</span>
              <ElInput v-model="moduleRunForm.runCode" placeholder="自动生成，可按项目编号修改" />
            </label>
            <label>
              <span>元数据说明</span>
              <ElInput
                v-model="moduleRunForm.metadataNote"
                placeholder="批次、样本来源或筛选说明"
              />
            </label>
          </div>
          <div class="parameter-schema-grid">
            <label
              v-for="control in moduleParameterControls"
              :key="control.key"
              :class="{ advanced: control.advanced, required: control.required }"
            >
              <span class="parameter-label">
                {{ control.label }}
                <ElTag v-if="control.required" size="small" type="danger">必填</ElTag>
                <ElTag v-if="control.advanced" size="small" type="info">高级</ElTag>
              </span>
              <small>{{ parameterHelpText(control) }}</small>
              <ElSelect v-if="control.key === 'repositoryId'" v-model="moduleRunForm.repositoryId">
                <ElOption
                  v-for="repo in repositoryCards"
                  :key="repo.id"
                  :label="repo.title"
                  :value="repo.id"
                />
              </ElSelect>
              <ElSelect v-else-if="control.key === 'trait'" v-model="moduleRunForm.trait">
                <ElOption
                  v-for="trait in workflowTraits"
                  :key="trait"
                  :label="trait"
                  :value="trait"
                />
              </ElSelect>
              <ElSelect v-else-if="control.type === 'select'" v-model="moduleRunForm[control.key]">
                <ElOption
                  v-for="option in control.options || []"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </ElSelect>
              <ElSwitch
                v-else-if="control.type === 'boolean'"
                :model-value="getBooleanModuleParam(control.key)"
                @update:model-value="setBooleanModuleParam(control.key, $event)"
                active-text="开"
                inactive-text="关"
              />
              <ElSlider
                v-else-if="control.type === 'slider'"
                :model-value="getNumericModuleParam(control.key)"
                @update:model-value="setNumericModuleParam(control.key, $event)"
                :min="control.min"
                :max="control.max"
                :step="control.step"
              />
              <ElInputNumber
                v-else-if="control.type === 'number'"
                :model-value="getNumericModuleParam(control.key)"
                @update:model-value="setNumericModuleParam(control.key, $event)"
                :min="control.min"
                :max="control.max"
                :step="control.step"
                controls-position="right"
              />
              <ElInput
                v-else
                :model-value="getTextModuleParam(control.key)"
                @update:model-value="setTextModuleParam(control.key, $event)"
              />
              <strong class="parameter-current"
                >当前值：{{ formatParameterValue(moduleRunForm[control.key]) }}</strong
              >
            </label>
          </div>
          <div class="dialog-io-grid">
            <div
              ><span>Input</span><strong>{{ selectedModule.inputs.join(' / ') }}</strong></div
            >
            <div
              ><span>Output</span><strong>{{ selectedModule.output }}</strong></div
            >
            <div
              ><span>参数数量</span><strong>{{ moduleParameterControls.length }}</strong></div
            >
            <div
              ><span>操作人</span><strong>{{ moduleRunForm.operator || '未填写' }}</strong></div
            >
          </div>
        </div>
      </section>
      <template #footer>
        <ElButton @click="moduleDialogVisible = false">取消</ElButton>
        <ElButton type="primary" :loading="runningModule" @click="runSelectedModule"
          >运行当前模块</ElButton
        >
      </template>
    </ElDialog>

    <ElDialog
      v-model="resultDetailVisible"
      :title="resultDetail.title"
      width="1040px"
      class="module-run-dialog"
    >
      <section class="module-detail-dialog">
        <div class="module-dialog-summary" :class="resultDetail.tone">
          <span>{{ resultDetail.subtitle }}</span>
          <h3>{{ resultDetail.primary }}</h3>
          <p>{{ resultDetail.summary }}</p>
        </div>

        <div class="dialog-io-grid">
          <div v-for="row in resultDetail.rows" :key="row.label">
            <span>{{ row.label }}</span>
            <strong>{{ row.value }}</strong>
          </div>
        </div>

        <div v-if="resultDetail.parameters.length" class="result-preview-block">
          <span>参数快照</span>
          <div class="parameter-snapshot-grid">
            <div v-for="row in resultDetail.parameters" :key="row.key">
              <span>{{ row.label }}</span>
              <strong>{{ row.value }}</strong>
              <small>{{ row.group }}</small>
            </div>
          </div>
        </div>

        <div v-if="resultDetail.tables.length" class="result-preview-block">
          <span>表格输出</span>
          <div v-for="table in resultDetail.tables" :key="table.key" class="table-preview-card">
            <strong>{{ table.key }} · 显示 {{ table.rows.length }}/{{ table.total }} 行</strong>
            <ElTable :data="table.rows" size="small" height="180">
              <ElTableColumn
                v-for="column in table.columns"
                :key="column"
                :prop="column"
                :label="column"
                min-width="120"
              />
            </ElTable>
          </div>
        </div>

        <div v-if="resultDetail.charts.length" class="result-preview-block">
          <span>图表输出</span>
          <div v-for="chart in resultDetail.charts" :key="chart.key" class="chart-detail-card">
            <strong>{{ chart.key }}</strong>
            <div :id="chart.domId" class="detail-chart-box"></div>
          </div>
        </div>

        <div v-if="resultDetail.notes.length" class="method-note-list">
          <span v-for="note in resultDetail.notes" :key="note">{{ note }}</span>
        </div>
      </section>
      <template #footer>
        <ElButton @click="exportResultDetail('json')">导出 JSON</ElButton>
        <ElButton type="primary" @click="exportResultDetail('csv')">导出 CSV</ElButton>
      </template>
    </ElDialog>
  </FcPageShell>
</template>

<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import { ElMessage } from 'element-plus'
  import * as echarts from 'echarts'
  import type {
    BreedingAnalysis,
    MultiOmicsAssociation,
    OmicsDataset,
    OmicsMarker,
    OmicsSample
  } from '@/types'
  import type { CowBasic } from '@/types/cow'
  import FcPageShell from '@/components/business/fluent-console/FcPageShell.vue'
  import FcMetricTile from '@/components/business/fluent-console/FcMetricTile.vue'
  import FcPanel from '@/components/business/fluent-console/FcPanel.vue'
  import {
    getOmicsModuleResults,
    getOmicsModuleCatalog,
    getOmicsWorkflowResults,
    type OmicsCatalogModule,
    type OmicsParameterSchemaItem,
    runOmicsModule,
    runOmicsWorkflow
  } from '@/api/omics'
  import * as databaseService from '@/services/database'
  import {
    buildUnifiedDataContext,
    loadUnifiedMilkRecords,
    loadUnifiedReproductionEvents
  } from '@/services/unified-records'
  import {
    average,
    formatDateTime,
    getMilkStatsMap,
    getPedigreeCompleteness,
    toFiniteNumber,
    type PlatformSnapshot
  } from '@/views/breeding-platform/platform-data'
  import { useLazyGridRenderWindow, useLazyRenderWindow } from '@/hooks'

  defineOptions({ name: 'DataAnalysis' })

  type SectionKey =
    | 'repositories'
    | 'modules'
    | 'moduleResults'
    | 'workflow'
    | 'workflowResults'
    | 'guide'
  type Tone = 'primary' | 'teal' | 'info' | 'warning' | 'danger'
  type TagType = 'primary' | 'success' | 'info' | 'warning' | 'danger'
  type AnyRow = Record<string, any>

  interface RepositoryCard {
    id: string
    title: string
    description: string
    count: number
    linkKey: string
    refreshText: string
    status: string
    tagType: TagType
    tone: Tone
    icon: string
  }

  interface AnalysisModule {
    id: string
    name: string
    category: string
    description: string
    inputs: string[]
    output: string
    runtime: string
    tone: Tone
    tagType: TagType
    parameterSchema?: OmicsParameterSchemaItem[]
  }

  interface ModuleRunResult {
    id: string
    moduleId: string
    module: string
    title: string
    status: string
    tagType: TagType
    tone: Tone
    summary: string
    metrics: Array<{ label: string; value: string | number }>
    tags: string[]
    parameters?: string | Record<string, unknown>
    executedAt?: string
    dataSource?: string
    methodNotes?: string[]
    tables?: Record<string, unknown>
    charts?: Record<string, unknown>
    effectiveParameters?: Record<string, unknown>
    inputSummary?: Record<string, unknown>
    artifacts?: Array<Record<string, unknown>>
    operator?: string
    runCode?: string
    startedAt?: string
    finishedAt?: string
    durationMs?: number
  }

  type ModuleRunForm = {
    repositoryId: string
    trait: string
    groupBy: string
    fdr: number
    nComponents: number
    lowVariancePercent: number
    outlierPercentile: number
    testMethod: string
    nEstimators: number
    cvFold: number
    permutationRepeats: number
    correlationMethod: string
    topN: number
    heatmapFeatureCount: number
    operator?: string
    runCode?: string
    metadataNote?: string
    [key: string]: string | number | boolean | undefined
  }

  type ModuleParameterControl = OmicsParameterSchemaItem

  interface WorkflowTemplate {
    id: string
    name: string
    target: string
    description: string
    moduleIds: string[]
  }

  interface WorkflowRunRecord {
    id: string
    template: string
    title: string
    trait: string
    status: '已完成' | '运行中' | '失败'
    statusType: TagType
    executedAt: string
    dataSource?: string
    repositoryTitles: string[]
    moduleNames: string[]
    parameterSnapshot: string
    summary: string
    score: string
    tone: Tone
    metrics: Array<{ label: string; value: string | number }>
    conclusion: string
    parameters?: Record<string, unknown>
    tables?: Record<string, unknown>
    charts?: Record<string, unknown>
    effectiveParameters?: Record<string, unknown>
    inputSummary?: Record<string, unknown>
    artifacts?: Array<Record<string, unknown>>
    operator?: string
    runCode?: string
    startedAt?: string
    finishedAt?: string
    durationMs?: number
    steps?: Array<Record<string, unknown>>
    moduleRunIds?: string[]
    methodNotes?: string[]
  }

  const route = useRoute()
  const router = useRouter()
  const activeSection = ref<SectionKey>('repositories')
  const routeSyncing = ref(false)
  const loading = ref(false)
  const moduleCategory = ref('全部')
  const moduleKeyword = ref('')
  const selectedModule = ref<AnalysisModule | null>(null)
  const moduleDialogVisible = ref(false)
  const moduleRunResults = ref<ModuleRunResult[]>([])
  const remoteModuleResults = ref<ModuleRunResult[]>([])
  const remoteWorkflowResults = ref<WorkflowRunRecord[]>([])
  const remoteCatalogModules = ref<OmicsCatalogModule[]>([])
  const runningModule = ref(false)
  const runningWorkflow = ref(false)
  const resultDetailVisible = ref(false)
  const expandedWorkflowStepId = ref('')
  const workflowStepParameterValues = reactive<
    Record<string, Record<string, string | number | boolean>>
  >({})
  const moduleRunForm = reactive<ModuleRunForm>({
    repositoryId: 'omics-datasets',
    trait: '泌乳量',
    groupBy: 'phenotype_group',
    fdr: 5,
    nComponents: 2,
    lowVariancePercent: 10,
    outlierPercentile: 95,
    testMethod: 'auto',
    nEstimators: 160,
    cvFold: 5,
    permutationRepeats: 8,
    correlationMethod: 'pearson',
    topN: 20,
    heatmapFeatureCount: 24,
    operator: '育种分析员',
    runCode: `OMICS-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
    metadataNote: ''
  })
  const activeWorkflowTemplateId = ref('milk-yield-genomics')
  const newWorkflowName = ref('')
  const workflowModuleCategory = ref('全部')
  const selectedRepositoryIds = ref<string[]>([
    'phenotype',
    'milk',
    'pedigree',
    'omics-samples',
    'omics-datasets'
  ])
  const workflowParams = reactive({
    trait: '泌乳量',
    groupBy: 'phenotype_group',
    missingRate: 20,
    cvFold: 5,
    operator: '育种分析员',
    runCode: `WF-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
    metadataNote: ''
  })
  const workflowRunRecords = ref<WorkflowRunRecord[]>([])
  const resultDetail = reactive({
    title: '结果详情',
    subtitle: '',
    primary: '',
    summary: '',
    tone: 'primary' as Tone,
    rows: [] as Array<{ label: string; value: string }>,
    parameters: [] as Array<{ key: string; label: string; value: string; group: string }>,
    tables: [] as Array<{ key: string; rows: AnyRow[]; columns: string[]; total: number }>,
    charts: [] as Array<{
      key: string
      domId: string
      raw: unknown
      points: Array<{ label: string; value: number }>
    }>,
    notes: [] as string[],
    sourceType: '' as 'module' | 'workflow' | '',
    sourceRecord: null as ModuleRunResult | WorkflowRunRecord | null
  })

  const snapshot = ref<PlatformSnapshot>({
    cows: [],
    sensors: [],
    milkRecords: [],
    breedingRecords: [],
    alerts: [],
    healthScores: []
  })
  const samples = ref<OmicsSample[]>([])
  const datasets = ref<OmicsDataset[]>([])
  const markers = ref<OmicsMarker[]>([])
  const associations = ref<MultiOmicsAssociation[]>([])
  const breedingAnalyses = ref<BreedingAnalysis[]>([])
  const chartInstances = ref<Map<string, echarts.ECharts>>(new Map())

  const sections: Array<{ key: SectionKey; label: string; icon: string; path: string }> = [
    {
      key: 'repositories',
      label: '本地数据仓库',
      icon: 'ri:database-2-line',
      path: '/omics-analysis/data-repositories'
    },
    {
      key: 'modules',
      label: '分析模块库',
      icon: 'ri:function-line',
      path: '/omics-analysis/modules'
    },
    {
      key: 'moduleResults',
      label: '模块结果',
      icon: 'ri:bar-chart-box-line',
      path: '/omics-analysis/module-results'
    },
    {
      key: 'workflow',
      label: '工作流编排',
      icon: 'ri:flow-chart',
      path: '/omics-analysis/workflow'
    },
    {
      key: 'workflowResults',
      label: '工作流结果',
      icon: 'ri:stack-line',
      path: '/omics-analysis/workflow-results'
    },
    {
      key: 'guide',
      label: '使用指南',
      icon: 'ri:book-open-line',
      path: '/omics-analysis/user-guide'
    }
  ]

  const routeSectionMappings: Array<{ key: SectionKey; names: string[]; paths: string[] }> = [
    {
      key: 'repositories',
      names: ['LocalOmicsRepositories', 'SampleManagement', 'DatasetManagement', 'GenomicData'],
      paths: [
        '/omics-analysis/data-repositories',
        '/omics-analysis/sample-management',
        '/omics-analysis/dataset-management',
        '/omics-analysis/genomic-data',
        '/omics-analysis/transcriptomics-data',
        '/operation/automation-engine',
        '/operation/transcriptomics-data'
      ]
    },
    {
      key: 'modules',
      names: ['OmicsModules', 'SnpGenotyping'],
      paths: ['/omics-analysis/modules', '/omics-analysis/snp-genotyping']
    },
    {
      key: 'moduleResults',
      names: ['OmicsModuleResults', 'MultiOmicsAssociation'],
      paths: ['/omics-analysis/module-results', '/omics-analysis/multi-omics-association']
    },
    {
      key: 'workflow',
      names: ['OmicsWorkflow'],
      paths: ['/omics-analysis/workflow']
    },
    {
      key: 'workflowResults',
      names: ['OmicsWorkflowResults', 'BreedingAnalysis'],
      paths: ['/omics-analysis/workflow-results', '/omics-analysis/breeding-analysis']
    },
    {
      key: 'guide',
      names: ['OmicsUserGuide'],
      paths: ['/omics-analysis/user-guide']
    }
  ]

  const analysisModules: AnalysisModule[] = [
    {
      id: 'missing-normalize',
      name: 'Impute Missing Values and Normalize data',
      category: '预处理',
      description: '对基因型、转录组、代谢组和表型矩阵进行缺失值填补、标准化和批次校正。',
      inputs: ['组学矩阵', '表型矩阵', '批次信息'],
      output: '标准化矩阵与质控报告',
      runtime: 'R/Python',
      tone: 'primary',
      tagType: 'primary'
    },
    {
      id: 'cleaning-processing',
      name: 'Cleaning and Processing',
      category: '预处理',
      description: '过滤低质量样本、低丰度特征、异常牛只记录和奶厅传感器异常值。',
      inputs: ['样本信息', 'QC 指标', '奶厅记录'],
      output: '清洗后数据集',
      runtime: 'Local',
      tone: 'primary',
      tagType: 'primary'
    },
    {
      id: 'pca',
      name: 'PCA',
      category: '降维与分群',
      description: '快速观察牛只个体在多组学特征空间中的分群、批次效应和离群点。',
      inputs: ['组学矩阵', '分组标签'],
      output: 'PC 得分、载荷和散点图',
      runtime: '秒级',
      tone: 'teal',
      tagType: 'success'
    },
    {
      id: 'plsda',
      name: 'PLS-DA',
      category: '降维与分群',
      description: '按高低泌乳量、乳蛋白率或繁殖效率分组，筛选区分性较强的组学特征。',
      inputs: ['组学矩阵', '目标分组'],
      output: 'VIP 特征和模型评分',
      runtime: '分钟级',
      tone: 'teal',
      tagType: 'success'
    },
    {
      id: 'oplsda',
      name: 'OPLS-DA',
      category: '降维与分群',
      description: '分离目标性状相关变异与噪声变异，适合做高低表型组差异解释。',
      inputs: ['组学矩阵', '表型分组'],
      output: 'OPLS-DA 模型与置换检验',
      runtime: '分钟级',
      tone: 'teal',
      tagType: 'success'
    },
    {
      id: 'two-group-test',
      name: 'Univariate Analysis - Two Groups',
      category: '差异分析',
      description: '对高低泌乳、高低乳蛋白或妊娠阳性/阴性分组做单变量差异检验。',
      inputs: ['目标性状', '分组标签'],
      output: 'P 值、FDR、效应量',
      runtime: 'Local',
      tone: 'info',
      tagType: 'info'
    },
    {
      id: 'multi-group-test',
      name: 'Univariate Analysis - Multi Groups',
      category: '差异分析',
      description: '比较不同胎次、家系或泌乳阶段之间的组学特征差异。',
      inputs: ['多组标签', '协变量'],
      output: 'ANOVA/Kruskal 结果',
      runtime: 'Local',
      tone: 'info',
      tagType: 'info'
    },
    {
      id: 'limma',
      name: 'Limma Difference Analysis',
      category: '差异分析',
      description: '用于转录组表达矩阵差异分析，输出候选基因、火山图和热图输入。',
      inputs: ['表达矩阵', '设计矩阵'],
      output: '差异基因列表',
      runtime: 'R',
      tone: 'info',
      tagType: 'info'
    },
    {
      id: 'lefse',
      name: 'Lefse Analysis',
      category: '差异分析',
      description: '面向瘤胃微生物或代谢类别，定位不同生产性能组的关键差异类群。',
      inputs: ['丰度矩阵', '分类层级'],
      output: 'LDA 分数和差异类群',
      runtime: 'Python',
      tone: 'info',
      tagType: 'info'
    },
    {
      id: 'random-forest',
      name: 'Random Forest Feature Selection',
      category: '机器学习',
      description: '训练泌乳量、乳脂率、乳蛋白率或繁殖效率预测模型，输出特征重要性排名。',
      inputs: ['训练矩阵', '目标性状'],
      output: '重要性排名与 OOB 误差',
      runtime: '分钟级',
      tone: 'warning',
      tagType: 'warning'
    },
    {
      id: 'svm',
      name: 'SVM Feature Selection',
      category: '机器学习',
      description: '通过支持向量机筛选能区分高低表型组的候选标记或代谢物。',
      inputs: ['组学矩阵', '分组标签'],
      output: '候选特征和分类性能',
      runtime: '分钟级',
      tone: 'warning',
      tagType: 'warning'
    },
    {
      id: 'boruta',
      name: 'Boruta Analysis',
      category: '机器学习',
      description: '识别稳定重要特征。',
      inputs: ['组学矩阵', '目标性状'],
      output: 'Confirmed/Tentative 特征',
      runtime: '分钟级',
      tone: 'warning',
      tagType: 'warning'
    },
    {
      id: 'roc',
      name: 'Predictive Model ROC',
      category: '机器学习',
      description: '评估候选模型对高产、高蛋白或高繁殖效率牛只的识别能力。',
      inputs: ['模型输出', '真实标签'],
      output: 'AUC、敏感性、特异性',
      runtime: 'Local',
      tone: 'warning',
      tagType: 'warning'
    },
    {
      id: 'correlation',
      name: 'Correlation & Partial Correlation',
      category: '关联分析',
      description: '计算组学特征与泌乳、体重、体尺、繁殖和质量性状的相关或偏相关。',
      inputs: ['组学特征', '表型性状', '协变量'],
      output: '相关矩阵与网络',
      runtime: 'Local',
      tone: 'primary',
      tagType: 'primary'
    },
    {
      id: 'gramm',
      name: 'GRaMM Correlation Analysis',
      category: '关联分析',
      description: '面向多组学间关联，构建基因、代谢物、微生物与表型之间的解释网络。',
      inputs: ['多组学矩阵', '性状矩阵'],
      output: '多层关联网络',
      runtime: 'Local',
      tone: 'primary',
      tagType: 'primary'
    },
    {
      id: 'cca-rda',
      name: 'CCA/RDA',
      category: '关联分析',
      description: '分析组学整体结构与泌乳阶段、家系、饲喂和繁殖协变量之间的关系。',
      inputs: ['组学矩阵', '环境/生产变量'],
      output: '排序图和解释率',
      runtime: 'R',
      tone: 'primary',
      tagType: 'primary'
    },
    {
      id: 'kegg',
      name: 'KEGG Pathway Analysis',
      category: '富集与通路',
      description: '把候选基因或代谢物映射到通路，解释乳成分合成、能量代谢和繁殖调控。',
      inputs: ['候选基因', '候选代谢物'],
      output: '通路富集结果',
      runtime: '联网/本地库',
      tone: 'teal',
      tagType: 'success'
    },
    {
      id: 'msea',
      name: 'Metabolite Set Enrichment Analysis',
      category: '富集与通路',
      description: '对代谢物集合做富集，定位与奶质、能量平衡和繁殖相关的代谢通路。',
      inputs: ['代谢物列表', '背景库'],
      output: '富集集合与 FDR',
      runtime: 'Local',
      tone: 'teal',
      tagType: 'success'
    },
    {
      id: 'ipath',
      name: 'IPATH Analysis',
      category: '富集与通路',
      description: '生成代谢网络路径图，展示候选代谢物在牛只生产性状中的通路位置。',
      inputs: ['代谢物 ID', '通路库'],
      output: '通路网络图',
      runtime: 'Local',
      tone: 'teal',
      tagType: 'success'
    },
    {
      id: 'heatmap',
      name: 'Heatmap',
      category: '可视化',
      description: '展示候选特征在不同牛只、家系或表型分组中的表达和丰度模式。',
      inputs: ['特征矩阵', '注释信息'],
      output: '聚类热图',
      runtime: '秒级',
      tone: 'info',
      tagType: 'info'
    },
    {
      id: 'violin-box',
      name: 'Violin Plot / Box Plot',
      category: '可视化',
      description: '比较候选特征在不同表型分组中的分布，明确差异方向和候选性状来源。',
      inputs: ['特征值', '分组标签'],
      output: '小提琴图和箱线图',
      runtime: '秒级',
      tone: 'info',
      tagType: 'info'
    },
    {
      id: 'venn-zscore',
      name: 'Venn Plot / Z-Score Scaled by Row',
      category: '可视化',
      description: '交叉多个模块的候选特征，并按行标准化观察关键牛群的模式。',
      inputs: ['候选列表', '特征矩阵'],
      output: 'Venn 图和 Z-score 矩阵',
      runtime: '秒级',
      tone: 'info',
      tagType: 'info'
    }
  ]

  const analysisModulesWithSchema = computed<AnalysisModule[]>(() =>
    analysisModules.map((module) => {
      const remote = remoteCatalogModules.value.find((item) => item.id === module.id)
      return {
        ...module,
        parameterSchema: remote?.parameterSchema || module.parameterSchema || []
      }
    })
  )

  const moduleCategories = computed(() => [
    '全部',
    ...Array.from(new Set(analysisModulesWithSchema.value.map((item) => item.category)))
  ])

  const milkStatsMap = computed(() => getMilkStatsMap(snapshot.value.milkRecords))
  const knownOmicsCowIds = computed(
    () =>
      new Set(
        samples.value
          .map((sample) => String(sample.cowId ?? sample.cowNumber ?? '').trim())
          .filter(Boolean)
      )
  )

  const statusText = computed(() => {
    if (loading.value) return '正在刷新本地数据'
    if (!samples.value.length && !datasets.value.length) return '等待组学数据接入'
    const connectedRepositories = repositoryCards.value.filter((item) => item.count > 0).length
    return `${connectedRepositories} 个本地仓库有记录 / ${analysisModules.length} 个模块定义`
  })

  const repositoryCards = computed<RepositoryCard[]>(() => {
    const readyTag = (count: number): TagType => (count > 0 ? 'success' : 'warning')
    const readyText = (count: number) => (count > 0 ? '已连接' : '待接入')
    const nowText = formatDateTime(new Date())
    const phenotypeCount = snapshot.value.milkRecords.length
    return [
      {
        id: 'phenotype',
        title: '表型矩阵',
        description: '泌乳量、乳脂、乳蛋白、体重、24 项体尺、行为与健康性状统一作为传统育种表型。',
        count: phenotypeCount,
        linkKey: 'cowNumber + collectionDate',
        refreshText: nowText,
        status: readyText(phenotypeCount),
        tagType: readyTag(phenotypeCount),
        tone: 'primary',
        icon: 'ri:survey-line'
      },
      {
        id: 'milk',
        title: '奶厅与泌乳性能',
        description: '从奶厅记录和泌乳传感器读取班次奶量、乳质等级、SCC、乳脂、乳蛋白和乳糖。',
        count: snapshot.value.milkRecords.length,
        linkKey: 'cowId / cowNumber',
        refreshText: nowText,
        status: readyText(snapshot.value.milkRecords.length),
        tagType: readyTag(snapshot.value.milkRecords.length),
        tone: 'teal',
        icon: 'ri:drop-line'
      },
      {
        id: 'pedigree',
        title: '系谱与种质资源',
        description: '调用牛只档案中的父号、母号、祖代、胎次和圈舍，作为传统育种和近交风险底座。',
        count: snapshot.value.cows.length,
        linkKey: 'cowNumber',
        refreshText: nowText,
        status: readyText(snapshot.value.cows.length),
        tagType: readyTag(snapshot.value.cows.length),
        tone: 'info',
        icon: 'ri:node-tree'
      },
      {
        id: 'reproduction',
        title: '繁殖与育种记录',
        description: '读取配种、妊检、产犊、繁殖周期和候选个体记录，用于繁殖效率相关组学分析。',
        count:
          snapshot.value.breedingRecords.length +
          (snapshot.value.reproductionCycles || []).length +
          (snapshot.value.breedingEvents || []).length,
        linkKey: 'cowNumber + eventDate',
        refreshText: nowText,
        status: readyText(snapshot.value.breedingRecords.length),
        tagType: readyTag(snapshot.value.breedingRecords.length),
        tone: 'warning',
        icon: 'ri:calendar-check-line'
      },
      {
        id: 'omics-samples',
        title: '组学样本信息',
        description: '血液、乳样、毛囊、组织、精液和瘤胃液样本，含采集日期、状态、质控和表型链接。',
        count: samples.value.length,
        linkKey: 'sampleCode + cowNumber',
        refreshText: nowText,
        status: readyText(samples.value.length),
        tagType: readyTag(samples.value.length),
        tone: 'primary',
        icon: 'ri:test-tube-line'
      },
      {
        id: 'omics-datasets',
        title: '组学数据矩阵',
        description: '基因组、SNP 分型、转录组、代谢组、微生物组和表型矩阵版本，不走上传流程。',
        count: datasets.value.length,
        linkKey: 'datasetCode + sampleIds',
        refreshText: nowText,
        status: readyText(datasets.value.length),
        tagType: readyTag(datasets.value.length),
        tone: 'teal',
        icon: 'ri:matrix-line'
      },
      {
        id: 'markers',
        title: '候选标记与变量',
        description: 'SNP、InDel、基因、转录本、CNV、蛋白和代谢物特征，用于模型训练和通路解释。',
        count: markers.value.length,
        linkKey: 'markerCode + trait',
        refreshText: nowText,
        status: readyText(markers.value.length),
        tagType: readyTag(markers.value.length),
        tone: 'info',
        icon: 'ri:dna-line'
      },
      {
        id: 'associations',
        title: '关联与育种分析结果',
        description: '读取多组学关联、候选基因、候选位点和基因组育种值分析结果，进入工作流复用。',
        count: associations.value.length + breedingAnalyses.value.length,
        linkKey: 'trait + candidate',
        refreshText: nowText,
        status: readyText(associations.value.length + breedingAnalyses.value.length),
        tagType: readyTag(associations.value.length + breedingAnalyses.value.length),
        tone: 'warning',
        icon: 'ri:git-merge-line'
      }
    ]
  })

  const localDataChain = computed(() => [
    {
      label: '牛只档案',
      value: snapshot.value.cows.length,
      note: '牛号、耳标、父母号、胎次、圈舍',
      tone: 'primary'
    },
    {
      label: '表型/泌乳',
      value: snapshot.value.milkRecords.length,
      note: '奶量、乳质、体重、体尺和传感器性状',
      tone: 'teal'
    },
    {
      label: '组学样本',
      value: samples.value.length,
      note: '血液、乳样、毛囊、组织和瘤胃液',
      tone: 'info'
    },
    {
      label: '分析结论',
      value: associations.value.length + breedingAnalyses.value.length,
      note: '候选基因、候选位点、育种值和选择指数',
      tone: 'warning'
    }
  ])

  const repositoryPreviewRows = computed(() => [
    {
      source: '表型矩阵',
      entity: '单牛-日期-性状',
      fields: 'cowNumber、collectionDate、traitCode、value、unit、source',
      downstream: 'PCA/PLS-DA 分组、相关分析、育种值模型协变量'
    },
    {
      source: '奶厅与泌乳',
      entity: '单牛-班次',
      fields: 'volume、milkFat、milkProtein、lactose、SCC、grade',
      downstream: '泌乳性能差异分析、奶质质量性状排名'
    },
    {
      source: '系谱与种质',
      entity: '单牛',
      fields: 'fatherNumber、motherNumber、parity、breed、currentPen',
      downstream: '近交风险、传统育种协变量、家系分组'
    },
    {
      source: '组学样本',
      entity: '样本-牛只',
      fields: 'sampleCode、cowNumber、sampleType、qualityScore、status',
      downstream: '矩阵匹配、样本质控、工作流输入'
    },
    {
      source: '组学数据矩阵',
      entity: '数据集-样本',
      fields: 'datasetCode、dataType、platform、sampleIds、qualityMetrics',
      downstream: '模块运行矩阵、批次校正、通路分析'
    },
    {
      source: '候选标记',
      entity: '标记-性状',
      fields: 'markerCode、markerType、geneSymbol、trait、pValue、effectSize',
      downstream: '机器学习特征、KEGG/MSEA、候选个体解释'
    }
  ])

  const linkedCowCards = computed(() =>
    snapshot.value.cows
      .map((cow) => {
        const milk = milkStatsMap.value[cow.id]
        const pedigreeScore = getPedigreeCompleteness(cow)
        const omicsCount = samples.value.filter((sample) => sampleMatchesCow(sample, cow)).length
        const readyScore = Math.min(
          100,
          Math.round(
            pedigreeScore * 0.35 +
              Math.min(100, (milk?.count || 0) * 16) * 0.3 +
              Math.min(100, omicsCount * 50) * 0.35
          )
        )
        return {
          id: cow.id,
          cowNumber: cow.cowNumber,
          fatherNumber: cow.fatherNumber || '-',
          motherNumber: cow.motherNumber || '-',
          pen: cow.currentPen || '未分圈',
          readyScore
        }
      })
      .sort((left, right) => right.readyScore - left.readyScore)
  )
  const {
    containerRef: linkedCowCardContainerRef,
    visibleItems: visibleLinkedCowCards,
    loadMore: loadMoreLinkedCowCards,
    handleScroll: onLinkedCowCardScroll,
    handleWheel: onLinkedCowCardWheel
  } = useLazyGridRenderWindow(linkedCowCards, {
    rowCount: 2,
    minItemWidth: 260,
    gap: 12,
    fallbackColumns: 2,
    mode: 'fixed-window'
  })

  const filteredAnalysisModules = computed(() => {
    const category = moduleCategory.value
    const keyword = moduleKeyword.value.trim().toLowerCase()
    return analysisModulesWithSchema.value.filter((module) => {
      const matchesCategory = category === '全部' || module.category === category
      const text = [module.name, module.category, module.description, module.inputs.join(' ')]
        .join(' ')
        .toLowerCase()
      const matchesKeyword = !keyword || text.includes(keyword)
      return matchesCategory && matchesKeyword
    })
  })
  const {
    containerRef: analysisModuleGridContainerRef,
    visibleItems: visibleAnalysisModules,
    startIndex: analysisModuleStartIndex,
    endIndex: analysisModuleEndIndex,
    totalCount: analysisModuleTotalCount,
    handleScroll: onAnalysisModuleScroll,
    handleWheel: onAnalysisModuleWheel
  } = useLazyGridRenderWindow(filteredAnalysisModules, {
    rowCount: 2,
    minItemWidth: 280,
    gap: 14,
    fallbackColumns: 3,
    mode: 'fixed-window'
  })

  const objectKeys = (value?: Record<string, unknown>) => Object.keys(value || {})
  const parameterGroupNames: Record<string, string> = {
    metadata: '元数据',
    preprocess: '预处理',
    statistics: '统计',
    model: '模型',
    validation: '验证',
    runtime: '运行',
    reproducibility: '复现',
    enrichment: '富集',
    network: '网络',
    visual: '可视化'
  }

  function asRecordArray(value: unknown): AnyRow[] {
    if (Array.isArray(value))
      return value.filter((item) => item && typeof item === 'object') as AnyRow[]
    if (value && typeof value === 'object' && Array.isArray((value as AnyRow).rows))
      return (value as AnyRow).rows as AnyRow[]
    return []
  }

  function formatPreviewCell(value: unknown): string | number {
    if (value === undefined || value === null || value === '') return '-'
    if (typeof value === 'number') return Number.isFinite(value) ? value : '-'
    if (typeof value === 'boolean') return value ? '是' : '否'
    if (typeof value === 'string') return value
    if (Array.isArray(value)) {
      const text = value
        .map((item) => formatPreviewCell(item))
        .filter((item) => item !== '-')
        .join('；')
      return text ? trimPreviewText(text) : '-'
    }
    if (typeof value === 'object') {
      try {
        return trimPreviewText(JSON.stringify(value))
      } catch {
        return '-'
      }
    }
    return String(value)
  }

  function trimPreviewText(value: string) {
    return value.length > 180 ? `${value.slice(0, 177)}...` : value
  }

  function tablePreviewRows(value: unknown) {
    return asRecordArray(value)
      .slice(0, 10)
      .map((row) =>
        Object.fromEntries(Object.entries(row).map(([key, cell]) => [key, formatPreviewCell(cell)]))
      )
  }

  function tablePreviewColumns(value: unknown) {
    const rows = tablePreviewRows(value)
    return Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, 8)
  }

  function chartPreviewPoints(value: unknown) {
    const rows = asRecordArray(value)
    return rows.map((row, index) => ({
      label: String(
        row.feature || row.sample || row.pathway || row.component || row.group || index + 1
      ),
      value: Math.abs(Number(row.score ?? row.value ?? row.y ?? row.tpr ?? row.size ?? row.n ?? 20))
    }))
  }

  function formatJson(value: unknown) {
    try {
      return JSON.stringify(value || {}, null, 0)
    } catch {
      return String(value || '')
    }
  }

  function formatDuration(value?: number) {
    const ms = Number(value || 0)
    if (!ms) return '-'
    return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`
  }

  function formatParameterValue(value: unknown) {
    if (typeof value === 'boolean') return value ? '开' : '关'
    if (value === undefined || value === null || value === '') return '-'
    return String(formatPreviewCell(value))
  }

  function toTextList(value: unknown): string[] {
    if (Array.isArray(value)) return value.flatMap((item) => toTextList(item)).filter(Boolean)
    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
        const values: string[] = toTextList(item)
        return values.length ? values.map((text: string) => `${key}:${text}`) : []
      })
    }
    if (value === undefined || value === null || value === '') return []
    return [String(value)]
  }

  function buildInputSourceText(result: ModuleRunResult | WorkflowRunRecord) {
    const inputSummary = (result.inputSummary || {}) as AnyRow
    const workflowTitles =
      'repositoryTitles' in result && result.repositoryTitles?.length
        ? result.repositoryTitles.map((item) => String(item))
        : []
    const summaryTitles = toTextList(
      inputSummary.repositoryTitles ||
        inputSummary.repository_titles ||
        inputSummary.inputRepositories
    )
    const repositoryTitle = String(
      inputSummary.repositoryTitle ||
        inputSummary.repository_title ||
        inputSummary.repositoryName ||
        ''
    ).trim()
    const repositoryId = String(
      inputSummary.repositoryId || inputSummary.repository_id || ''
    ).trim()
    const sourceRecordIds = toTextList(
      inputSummary.sourceRecordIds || inputSummary.source_record_ids
    )
    const title =
      workflowTitles.join(' / ') ||
      summaryTitles.join(' / ') ||
      repositoryTitle ||
      repositoryId ||
      '本地组学输入矩阵'
    if (!sourceRecordIds.length) return title
    const previewIds = sourceRecordIds.slice(0, 6).join(', ')
    return `${title} / 关联记录 ${previewIds}${sourceRecordIds.length > 6 ? '...' : ''}`
  }

  function buildResultDetailRows(result: ModuleRunResult | WorkflowRunRecord) {
    const sourceTables = buildInputSourceText(result)
    const scope =
      'repositoryTitles' in result && result.repositoryTitles?.length
        ? '按所选仓库、样本快照和运行参数聚合'
        : result.inputSummary
          ? '按输入快照和运行参数聚合'
          : '按本地数据和当前参数运行'
    return [
      {
        label: '运行输入',
        value:
          result.dataSource === 'generated'
            ? '场内可复现实验矩阵'
            : result.dataSource === 'mixed'
              ? '场内记录与补齐矩阵'
              : '场内组学矩阵'
      },
      { label: '统计口径', value: scope },
      { label: '关联仓库', value: sourceTables },
      { label: '操作人', value: result.operator || 'system' },
      { label: '任务编号', value: result.runCode || '-' },
      { label: '开始时间', value: result.startedAt || result.executedAt || '-' },
      { label: '结束时间', value: result.finishedAt || result.executedAt || '-' },
      { label: '运行耗时', value: formatDuration(result.durationMs) }
    ]
  }

  function buildTablePreview(value: unknown) {
    const sourceRows = asRecordArray(value)
    const rows = tablePreviewRows(value)
    return {
      rows,
      columns: tablePreviewColumns(value),
      total: sourceRows.length
    }
  }

  function buildChartPreview(value: unknown) {
    return chartPreviewPoints(value).slice(0, 12)
  }

  function detailChartDomId(runId: string, chartKey: string) {
    return `omics-detail-chart-${String(runId || 'run').replace(/[^a-zA-Z0-9_-]+/g, '-')}-${String(chartKey || 'chart').replace(/[^a-zA-Z0-9_-]+/g, '-')}`
  }

  async function renderDetailChartsSoon() {
    await nextTick()
    resultDetail.charts.forEach((chart) => renderDetailChart(chart))
  }

  function renderDetailChart(chartItem: {
    key: string
    domId: string
    raw: unknown
    points: Array<{ label: string; value: number }>
  }) {
    const element = document.getElementById(chartItem.domId)
    if (!element) return
    const chart = getOrCreateChart(element, chartItem.domId)
    const rows = asRecordArray(chartItem.raw)
    const keyText = chartItem.key.toLowerCase()
    if (
      keyText.includes('roc') &&
      rows.some((row) => row.fpr !== undefined && row.tpr !== undefined)
    ) {
      chart.setOption(
        {
          tooltip: { trigger: 'axis' },
          grid: { left: 54, right: 24, top: 24, bottom: 42 },
          xAxis: { type: 'value', name: 'FPR', min: 0, max: 1 },
          yAxis: { type: 'value', name: 'TPR', min: 0, max: 1 },
          series: [
            {
              type: 'line',
              smooth: true,
              symbolSize: 5,
              data: rows.map((row) => [Number(row.fpr || 0), Number(row.tpr || 0)])
            }
          ]
        },
        true
      )
      return
    }
    if (rows.some((row) => row.source !== undefined && row.target !== undefined)) {
      const nodes = Array.from(
        new Set(rows.flatMap((row) => [String(row.source), String(row.target)]))
      ).map((name) => ({ name }))
      chart.setOption(
        {
          tooltip: {},
          series: [
            {
              type: 'graph',
              layout: 'force',
              roam: true,
              label: { show: true },
              force: { repulsion: 90, edgeLength: 80 },
              data: nodes,
              links: rows.map((row) => ({
                source: String(row.source),
                target: String(row.target),
                value: Number(row.weight || row.score || row.value || 1)
              }))
            }
          ]
        },
        true
      )
      return
    }
    if (rows.some((row) => row.x !== undefined && row.y !== undefined)) {
      chart.setOption(
        {
          tooltip: {
            formatter: (params: AnyRow) =>
              `${params.value?.[2] || chartItem.key}<br/>x ${params.value?.[0]} / y ${params.value?.[1]}`
          },
          grid: { left: 54, right: 24, top: 24, bottom: 42 },
          xAxis: { type: 'value' },
          yAxis: { type: 'value' },
          series: [
            {
              type: 'scatter',
              symbolSize: 12,
              data: rows.map((row, index) => [
                Number(row.x || 0),
                Number(row.y || 0),
                row.label || row.sample || row.feature || index + 1
              ])
            }
          ]
        },
        true
      )
      return
    }
    const points = chartItem.points.length
      ? chartItem.points
      : chartPreviewPoints(chartItem.raw).slice(0, 12)
    chart.setOption(
      {
        tooltip: { trigger: 'axis' },
        grid: { left: 64, right: 24, top: 24, bottom: 56 },
        xAxis: {
          type: 'category',
          axisLabel: { rotate: points.length > 6 ? 28 : 0 },
          data: points.map((point) => point.label)
        },
        yAxis: { type: 'value' },
        series: [
          {
            type: 'bar',
            data: points.map((point) => Number(point.value || 0)),
            itemStyle: { color: '#2563eb', borderRadius: [6, 6, 0, 0] }
          }
        ]
      },
      true
    )
  }

  function openModuleResultDetail(result: ModuleRunResult) {
    resultDetail.title = `${result.module} · ${result.title}`
    resultDetail.subtitle = '模块结果'
    resultDetail.primary = result.status
    resultDetail.summary = result.summary
    resultDetail.tone = result.tone
    resultDetail.sourceType = 'module'
    resultDetail.sourceRecord = result
    resultDetail.rows = buildResultDetailRows(result)
    resultDetail.parameters = parameterSnapshotRows(result).slice(0, 20)
    resultDetail.tables = objectKeys(result.tables).map((key) => {
      const preview = buildTablePreview(result.tables?.[key])
      return { key, rows: preview.rows, columns: preview.columns, total: preview.total }
    })
    resultDetail.charts = objectKeys(result.charts).map((key) => ({
      key,
      domId: detailChartDomId(result.id, key),
      raw: result.charts?.[key],
      points: buildChartPreview(result.charts?.[key])
    }))
    resultDetail.notes = result.methodNotes || []
    resultDetailVisible.value = true
    renderDetailChartsSoon()
  }

  function openWorkflowStepDetail(step: AnalysisModule, index: number) {
    const controls = getModuleParameterControls(step.id)
    resultDetail.title = `${step.name} · 第 ${index + 1} 步`
    resultDetail.subtitle = '工作流步骤'
    resultDetail.primary = step.output
    resultDetail.summary = step.description
    resultDetail.tone = step.tone
    resultDetail.sourceType = ''
    resultDetail.sourceRecord = null
    resultDetail.rows = [
      { label: '模块分类', value: step.category },
      { label: '运行模式', value: step.runtime },
      { label: '输入', value: step.inputs.join(' / ') },
      { label: '输出', value: step.output }
    ]
    resultDetail.parameters = controls.slice(0, 16).map((control) => ({
      key: control.key,
      label: control.label,
      value: formatParameterValue(getWorkflowStepValue(step.id, control.key, control)),
      group: control.group || 'parameter'
    }))
    resultDetail.tables = []
    resultDetail.charts = []
    resultDetail.notes = controls.map((control) => parameterHelpText(control))
    resultDetailVisible.value = true
  }

  function openWorkflowResultDetail(result: WorkflowRunRecord) {
    resultDetail.title = `${result.template} · ${result.title}`
    resultDetail.subtitle = '工作流结果'
    resultDetail.primary = result.score
    resultDetail.summary = result.summary
    resultDetail.tone = result.tone
    resultDetail.sourceType = 'workflow'
    resultDetail.sourceRecord = result
    resultDetail.rows = buildResultDetailRows(result)
    resultDetail.parameters = workflowStepParameterRows(result)
      .slice(0, 20)
      .map((row) => ({
        key: row.key,
        label: row.label,
        value: row.value,
        group: row.moduleName
      }))
    resultDetail.tables = objectKeys(result.tables).map((key) => {
      const preview = buildTablePreview(result.tables?.[key])
      return { key, rows: preview.rows, columns: preview.columns, total: preview.total }
    })
    resultDetail.charts = objectKeys(result.charts).map((key) => ({
      key,
      domId: detailChartDomId(result.id, key),
      raw: result.charts?.[key],
      points: buildChartPreview(result.charts?.[key])
    }))
    resultDetail.notes = result.methodNotes || []
    resultDetailVisible.value = true
    renderDetailChartsSoon()
  }

  function parameterHelpText(control: ModuleParameterControl) {
    const parts = [
      control.group ? parameterGroupNames[control.group] || control.group : '',
      control.algorithm ? `算法：${control.algorithm}` : '',
      control.description || '',
      control.unit ? `单位：${control.unit}` : '',
      control.default !== undefined ? `默认：${formatParameterValue(control.default)}` : ''
    ].filter(Boolean)
    return parts.join('；')
  }

  function exportResult(result: ModuleRunResult, format: 'json' | 'csv') {
    const payload = format === 'json' ? JSON.stringify(result, null, 2) : buildResultCsv(result)
    const blob = new Blob([payload], {
      type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8'
    })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${result.id}.${format}`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  function buildResultCsv(result: ModuleRunResult) {
    const firstKey = objectKeys(result.tables)[0]
    const rows = tablePreviewRows(result.tables?.[firstKey])
    const columns = tablePreviewColumns(result.tables?.[firstKey])
    if (!rows.length || !columns.length)
      return `runId,module,status\n${result.id},${result.module},${result.status}\n`
    return [
      columns.join(','),
      ...rows.map((row) => columns.map((column) => JSON.stringify(row[column] ?? '')).join(','))
    ].join('\n')
  }

  function exportWorkflowResult(result: WorkflowRunRecord, format: 'json' | 'csv') {
    const payload =
      format === 'json' ? JSON.stringify(result, null, 2) : buildWorkflowResultCsv(result)
    const blob = new Blob([payload], {
      type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8'
    })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${result.id}.${format}`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  function exportResultDetail(format: 'json' | 'csv') {
    if (!resultDetail.sourceRecord) {
      ElMessage.warning('当前详情没有可导出的运行记录')
      return
    }
    if (resultDetail.sourceType === 'workflow') {
      exportWorkflowResult(resultDetail.sourceRecord as WorkflowRunRecord, format)
      return
    }
    exportResult(resultDetail.sourceRecord as ModuleRunResult, format)
  }

  function buildWorkflowResultCsv(result: WorkflowRunRecord) {
    const rows = tablePreviewRows(result.tables?.moduleRuns)
    const columns = tablePreviewColumns(result.tables?.moduleRuns)
    if (!rows.length || !columns.length)
      return `runId,workflow,status\n${result.id},${result.template},${result.status}\n`
    return [
      columns.join(','),
      ...rows.map((row) => columns.map((column) => JSON.stringify(row[column] ?? '')).join(','))
    ].join('\n')
  }

  function parseResultParameters(result: ModuleRunResult): AnyRow {
    const topLevelEffective =
      result.effectiveParameters && typeof result.effectiveParameters === 'object'
        ? (result.effectiveParameters as AnyRow)
        : {}
    if (!result.parameters) return { ...topLevelEffective, effectiveParameters: topLevelEffective }
    if (typeof result.parameters === 'string') {
      try {
        const parsed = JSON.parse(result.parameters) as AnyRow
        const nestedEffective =
          parsed.effectiveParameters && typeof parsed.effectiveParameters === 'object'
            ? (parsed.effectiveParameters as AnyRow)
            : {}
        return {
          ...parsed,
          effectiveParameters: Object.keys(nestedEffective).length
            ? nestedEffective
            : topLevelEffective
        }
      } catch {
        return { ...topLevelEffective, effectiveParameters: topLevelEffective }
      }
    }
    const parameters = result.parameters as AnyRow
    const nestedEffective =
      parameters.effectiveParameters && typeof parameters.effectiveParameters === 'object'
        ? (parameters.effectiveParameters as AnyRow)
        : {}
    return {
      ...parameters,
      effectiveParameters: Object.keys(nestedEffective).length ? nestedEffective : topLevelEffective
    }
  }

  function parameterSnapshotRows(result: ModuleRunResult) {
    const parameters = parseResultParameters(result)
    const snapshot = Array.isArray(parameters.parameterSchemaSnapshot)
      ? (parameters.parameterSchemaSnapshot as AnyRow[])
      : []
    const effective =
      parameters.effectiveParameters && typeof parameters.effectiveParameters === 'object'
        ? (parameters.effectiveParameters as AnyRow)
        : parameters
    if (snapshot.length) {
      return snapshot.slice(0, 24).map((row) => ({
        key: String(row.key || row.backendParam || ''),
        label: String(row.label || row.key || ''),
        value: formatParameterValue(effective[String(row.backendParam || row.key)] ?? row.value),
        group: String(row.group || 'parameter'),
        algorithm: row.algorithm ? String(row.algorithm) : ''
      }))
    }
    return Object.entries(effective)
      .filter(([key]) => !['parameterSchemaSnapshot', 'effectiveParameters'].includes(key))
      .slice(0, 24)
      .map(([key, value]) => ({
        key,
        label: key,
        value: formatParameterValue(value),
        group: 'parameter',
        algorithm: ''
      }))
  }

  function workflowStepParameterRows(result: WorkflowRunRecord) {
    const parameters = result.parameters || {}
    const effective = parameters.effectiveParameters
    const steps = Array.isArray((effective as AnyRow)?.steps)
      ? ((effective as AnyRow).steps as AnyRow[])
      : Array.isArray(parameters.steps)
        ? (parameters.steps as AnyRow[])
        : []
    return steps
      .flatMap((step, stepIndex) => {
        const moduleId = String(step.moduleId || '')
        const moduleName = String(
          step.moduleName || step.module || moduleId || `Step ${stepIndex + 1}`
        )
        const values =
          step.parameters && typeof step.parameters === 'object'
            ? (step.parameters as AnyRow)
            : (step as AnyRow).parameters || {}
        const snapshot = Array.isArray(values.parameterSchemaSnapshot)
          ? (values.parameterSchemaSnapshot as AnyRow[])
          : []
        if (snapshot.length) {
          return snapshot.slice(0, 8).map((row) => ({
            key: `${moduleId}-${row.key || row.backendParam}`,
            label: String(row.label || row.key || ''),
            value: formatParameterValue(values[String(row.backendParam || row.key)] ?? row.value),
            moduleName
          }))
        }
        return Object.entries(values)
          .filter(
            ([key]) => !['parameterSchemaSnapshot', 'moduleInputs', 'moduleOutput'].includes(key)
          )
          .slice(0, 8)
          .map(([key, value]) => ({
            key: `${moduleId}-${key}`,
            label: key,
            value: formatParameterValue(value),
            moduleName
          }))
      })
      .slice(0, 32)
  }

  function getNumericModuleParam(key: string) {
    const value = moduleRunForm[key]
    return typeof value === 'number' ? value : Number(value) || 0
  }

  function setNumericModuleParam(key: string, value: number | number[] | undefined) {
    moduleRunForm[key] = Array.isArray(value) ? Number(value[0] || 0) : Number(value || 0)
  }

  function getBooleanModuleParam(key: string) {
    const value = moduleRunForm[key]
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return Boolean(value)
    if (typeof value === 'string')
      return ['1', 'true', 'yes', 'on', '开'].includes(value.toLowerCase())
    return false
  }

  function setBooleanModuleParam(key: string, value: boolean | string | number) {
    moduleRunForm[key] = Boolean(value)
  }

  function getTextModuleParam(key: string) {
    const value = moduleRunForm[key]
    return value === undefined || value === null ? '' : String(value)
  }

  function setTextModuleParam(key: string, value: string | number | null | undefined) {
    moduleRunForm[key] = value === null || value === undefined ? '' : String(value)
  }

  function getWorkflowStepValue(moduleId: string, key: string, control?: ModuleParameterControl) {
    const values = workflowStepParameterValues[moduleId] || {}
    return values[key] ?? (control ? getControlDefaultValue(control) : '')
  }

  function setWorkflowStepValue(
    moduleId: string,
    key: string,
    value: string | number | boolean | number[] | null | undefined
  ) {
    if (!workflowStepParameterValues[moduleId]) workflowStepParameterValues[moduleId] = {}
    if (Array.isArray(value)) {
      workflowStepParameterValues[moduleId][key] = Number(value[0] || 0)
    } else if (value === null || value === undefined) {
      workflowStepParameterValues[moduleId][key] = ''
    } else {
      workflowStepParameterValues[moduleId][key] = value
    }
  }

  function getWorkflowStepNumber(moduleId: string, control: ModuleParameterControl) {
    return Number(getWorkflowStepValue(moduleId, control.key, control)) || 0
  }

  function getWorkflowStepBoolean(moduleId: string, control: ModuleParameterControl) {
    const value = getWorkflowStepValue(moduleId, control.key, control)
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return Boolean(value)
    return ['1', 'true', 'yes', 'on', '开'].includes(String(value).toLowerCase())
  }

  function getWorkflowStepText(moduleId: string, control: ModuleParameterControl) {
    const value = getWorkflowStepValue(moduleId, control.key, control)
    return value === undefined || value === null ? '' : String(value)
  }

  function getControlDefaultValue(control: ModuleParameterControl) {
    if (control.default !== undefined) return control.default as string | number | boolean
    if (control.type === 'boolean') return false
    if (control.type === 'number' || control.type === 'slider') return 0
    return ''
  }

  function mergeParameterSchema(
    primary: ModuleParameterControl[],
    fallback: ModuleParameterControl[] = []
  ) {
    const merged = new Map<string, ModuleParameterControl>()
    for (const control of [...fallback, ...primary]) {
      if (!control?.key) continue
      merged.set(control.key, { ...merged.get(control.key), ...control })
    }
    return Array.from(merged.values())
  }

  const fallbackParameterSchemaByModule: Record<string, ModuleParameterControl[]> = {
    'missing-normalize': [
      {
        key: 'lowVariancePercent',
        label: '低方差过滤比例',
        type: 'slider',
        min: 0,
        max: 50,
        step: 5
      },
      {
        key: 'outlierPercentile',
        label: '离群阈值分位数',
        type: 'slider',
        min: 80,
        max: 99,
        step: 1
      }
    ],
    'cleaning-processing': [
      {
        key: 'lowVariancePercent',
        label: '低方差过滤比例',
        type: 'slider',
        min: 0,
        max: 50,
        step: 5
      },
      {
        key: 'outlierPercentile',
        label: '离群阈值分位数',
        type: 'slider',
        min: 80,
        max: 99,
        step: 1
      }
    ],
    pca: [{ key: 'nComponents', label: '降维组件数', type: 'number', min: 2, max: 8, step: 1 }],
    plsda: [{ key: 'nComponents', label: '降维组件数', type: 'number', min: 1, max: 8, step: 1 }],
    oplsda: [{ key: 'nComponents', label: '降维组件数', type: 'number', min: 1, max: 8, step: 1 }],
    'cca-rda': [
      { key: 'nComponents', label: '排序轴数量', type: 'number', min: 2, max: 8, step: 1 }
    ],
    'two-group-test': [
      {
        key: 'testMethod',
        label: '统计检验方式',
        type: 'select',
        options: [
          { label: '自动择优', value: 'auto' },
          { label: '参数检验', value: 'parametric' },
          { label: '非参数检验', value: 'nonparametric' }
        ]
      }
    ],
    'multi-group-test': [
      {
        key: 'testMethod',
        label: '统计检验方式',
        type: 'select',
        options: [
          { label: '自动择优', value: 'auto' },
          { label: '参数检验', value: 'parametric' },
          { label: '非参数检验', value: 'nonparametric' }
        ]
      }
    ],
    limma: [
      {
        key: 'testMethod',
        label: '统计检验方式',
        type: 'select',
        options: [
          { label: '自动择优', value: 'auto' },
          { label: '参数检验', value: 'parametric' },
          { label: '非参数检验', value: 'nonparametric' }
        ]
      }
    ],
    lefse: [
      {
        key: 'testMethod',
        label: '统计检验方式',
        type: 'select',
        options: [
          { label: '自动择优', value: 'auto' },
          { label: '参数检验', value: 'parametric' },
          { label: '非参数检验', value: 'nonparametric' }
        ]
      }
    ],
    'random-forest': [
      { key: 'nEstimators', label: '树数量', type: 'number', min: 40, max: 500, step: 20 },
      { key: 'cvFold', label: '交叉验证折数', type: 'number', min: 3, max: 10, step: 1 }
    ],
    boruta: [
      { key: 'nEstimators', label: '树数量', type: 'number', min: 40, max: 500, step: 20 },
      { key: 'cvFold', label: '交叉验证折数', type: 'number', min: 3, max: 10, step: 1 }
    ],
    roc: [
      { key: 'nEstimators', label: '树数量', type: 'number', min: 40, max: 500, step: 20 },
      { key: 'cvFold', label: '交叉验证折数', type: 'number', min: 3, max: 10, step: 1 }
    ],
    svm: [
      { key: 'cvFold', label: '交叉验证折数', type: 'number', min: 3, max: 10, step: 1 },
      {
        key: 'permutationRepeats',
        label: '置换重要性次数',
        type: 'number',
        min: 3,
        max: 30,
        step: 1
      }
    ],
    correlation: [
      {
        key: 'correlationMethod',
        label: '相关方法',
        type: 'select',
        options: [
          { label: 'Pearson', value: 'pearson' },
          { label: 'Spearman', value: 'spearman' }
        ]
      }
    ],
    gramm: [
      {
        key: 'correlationMethod',
        label: '相关方法',
        type: 'select',
        options: [
          { label: 'Pearson', value: 'pearson' },
          { label: 'Spearman', value: 'spearman' }
        ]
      }
    ],
    kegg: [{ key: 'topN', label: '候选特征 TopN', type: 'number', min: 5, max: 100, step: 5 }],
    msea: [{ key: 'topN', label: '候选特征 TopN', type: 'number', min: 5, max: 100, step: 5 }],
    ipath: [{ key: 'topN', label: '候选特征 TopN', type: 'number', min: 5, max: 100, step: 5 }],
    heatmap: [
      {
        key: 'heatmapFeatureCount',
        label: '可视化特征数',
        type: 'number',
        min: 5,
        max: 80,
        step: 5
      }
    ],
    'violin-box': [
      {
        key: 'heatmapFeatureCount',
        label: '可视化特征数',
        type: 'number',
        min: 5,
        max: 80,
        step: 5
      }
    ],
    'venn-zscore': [
      {
        key: 'heatmapFeatureCount',
        label: '可视化特征数',
        type: 'number',
        min: 5,
        max: 80,
        step: 5
      }
    ]
  }

  const moduleParameterControls = computed<ModuleParameterControl[]>(() => {
    const remoteSchema = selectedModule.value?.parameterSchema || []
    const moduleId = selectedModule.value?.id || ''
    return mergeParameterSchema(remoteSchema, fallbackParameterSchemaByModule[moduleId] || [])
  })

  const advancedParameterCount = computed(
    () => moduleParameterControls.value.filter((control) => control.advanced).length
  )

  const moduleResults = computed<ModuleRunResult[]>(() => [
    ...moduleRunResults.value,
    ...remoteModuleResults.value
  ])
  const { visibleItems: visibleModuleResults, loadMore: loadMoreModuleResults } =
    useLazyRenderWindow(moduleResults, {
      initialCount: 10,
      batchSize: 10,
      mode: 'fixed-window'
    })

  const workflowTemplates = ref<WorkflowTemplate[]>([
    {
      id: 'milk-yield-genomics',
      name: '泌乳性能组学解释流程',
      target: '泌乳量 / 乳脂 / 乳蛋白',
      description:
        '从奶厅和表型矩阵生成高低表型组，串联预处理、PCA、随机森林、差异分析和 KEGG 通路解释。',
      moduleIds: ['missing-normalize', 'pca', 'random-forest', 'two-group-test', 'kegg', 'heatmap']
    },
    {
      id: 'fertility-genomics',
      name: '繁殖效率关联流程',
      target: '受胎率 / 产犊间隔',
      description: '调用繁殖记录、系谱和组学矩阵，分析影响受胎、空怀和产犊间隔的候选特征。',
      moduleIds: ['cleaning-processing', 'plsda', 'correlation', 'boruta', 'roc', 'violin-box']
    },
    {
      id: 'selection-index',
      name: '综合育种值工作流',
      target: '选择指数 / 候选个体',
      description: '合并表型、系谱、组学和质量性状，输出候选母牛、种公牛和质量性状排名解释。',
      moduleIds: ['missing-normalize', 'oplsda', 'gramm', 'svm', 'cca-rda', 'venn-zscore']
    }
  ])

  const activeWorkflowTemplate = computed(
    () =>
      workflowTemplates.value.find((template) => template.id === activeWorkflowTemplateId.value) ||
      workflowTemplates.value[0]
  )

  const activeWorkflowModuleIds = computed(() => activeWorkflowTemplate.value.moduleIds)

  const activeWorkflowSteps = computed(() =>
    activeWorkflowModuleIds.value
      .map((id) => analysisModulesWithSchema.value.find((module) => module.id === id))
      .filter((module): module is AnalysisModule => Boolean(module))
  )

  function getModuleParameterControls(moduleId: string): ModuleParameterControl[] {
    const module = analysisModulesWithSchema.value.find((item) => item.id === moduleId)
    const remoteSchema = Array.isArray(module?.parameterSchema) ? module.parameterSchema : []
    return mergeParameterSchema(remoteSchema, fallbackParameterSchemaByModule[moduleId] || [])
  }

  const workflowAvailableModules = computed(() =>
    analysisModulesWithSchema.value.filter((module) => {
      const matchesCategory =
        workflowModuleCategory.value === '全部' || module.category === workflowModuleCategory.value
      return matchesCategory && !activeWorkflowModuleIds.value.includes(module.id)
    })
  )
  const {
    containerRef: workflowModuleContainerRef,
    visibleItems: visibleWorkflowAvailableModules,
    startIndex: workflowModuleStartIndex,
    endIndex: workflowModuleEndIndex,
    totalCount: workflowModuleTotalCount,
    handleScroll: onWorkflowModuleScroll,
    handleWheel: onWorkflowModuleWheel
  } = useLazyGridRenderWindow(workflowAvailableModules, {
    rowCount: 2,
    minItemWidth: 210,
    gap: 10,
    fallbackColumns: 3,
    mode: 'fixed-window'
  })

  const workflowTraits = computed(() => {
    const traits = new Set([
      '泌乳量',
      '乳脂率',
      '乳蛋白率',
      '乳糖率',
      '体细胞数',
      '体重',
      '体高',
      '胸围',
      '受胎率',
      '产犊间隔'
    ])
    markers.value.forEach((marker) => marker.trait && traits.add(marker.trait))
    associations.value.forEach((item) => item.trait && traits.add(item.trait))
    breedingAnalyses.value.forEach((item) => item.targetTrait && traits.add(item.targetTrait))
    return Array.from(traits)
  })

  const workflowResults = computed(() => [
    ...workflowRunRecords.value,
    ...remoteWorkflowResults.value
  ])
  const { visibleItems: visibleWorkflowResults, loadMore: loadMoreWorkflowResults } =
    useLazyRenderWindow(workflowResults, {
      initialCount: 10,
      batchSize: 10,
      mode: 'fixed-window'
    })

  const recentWorkflowRunRecords = computed(() =>
    workflowRunRecords.value.length
      ? workflowRunRecords.value.slice(0, 4)
      : remoteWorkflowResults.value.slice(0, 4)
  )
  const { visibleItems: visibleWorkflowRunRecords, loadMore: loadMoreWorkflowRunRecords } =
    useLazyRenderWindow(recentWorkflowRunRecords, {
      initialCount: 10,
      batchSize: 10,
      mode: 'fixed-window'
    })

  watch(
    activeWorkflowSteps,
    (steps) => {
      steps.forEach((step) => ensureWorkflowStepDefaults(step.id))
    },
    { immediate: true }
  )

  const workflowCandidateRows = computed(() => {
    const candidatesFromAnalysis = breedingAnalyses.value.flatMap((analysis) =>
      (analysis.topCandidates || []).map((candidate) => ({
        rank: candidate.rank,
        cowNumber: candidate.cowNumber,
        trait: analysis.targetTrait,
        phenotype: candidate.phenotypeScore ? `表型 ${candidate.phenotypeScore}` : '表型待复核',
        genomic: `GEBV ${Number(candidate.genomicEstimate || 0).toFixed(2)}`,
        pedigree: '已关联系谱',
        decision: candidate.notes || '进入候选个体池'
      }))
    )
    if (candidatesFromAnalysis.length) {
      return candidatesFromAnalysis.sort((left, right) => left.rank - right.rank).slice(0, 8)
    }

    return linkedCowCards.value.map((cow, index) => ({
      rank: index + 1,
      cowNumber: cow.cowNumber,
      trait: workflowParams.trait,
      phenotype: `分析就绪 ${cow.readyScore}%`,
      genomic:
        knownOmicsCowIds.value.has(cow.cowNumber) || knownOmicsCowIds.value.has(cow.id)
          ? '已有样本证据'
          : '待补组学矩阵',
      pedigree: `${cow.fatherNumber}/${cow.motherNumber}`,
      decision: cow.readyScore >= 80 ? '进入候选排序' : '补齐组学或表型后复核'
    }))
  })
  const {
    visibleItems: visibleWorkflowCandidateRows,
    loadMore: loadMoreWorkflowCandidateRows,
    handleWheel: onWorkflowCandidateWheel
  } = useLazyRenderWindow(workflowCandidateRows, {
    initialCount: 10,
    batchSize: 10,
    mode: 'fixed-window'
  })

  const guideItems = [
    {
      index: '01',
      title: '进入本地数据仓库',
      description: '先确认平台已经能读到牛只、表型、奶厅、系谱、繁殖和组学数据。',
      points: [
        '无需上传数据表',
        '使用 cowNumber / cowId 作为核心关联键',
        '质控状态不足时先回到源业务页面补齐'
      ]
    },
    {
      index: '02',
      title: '选择分析模块',
      description:
        '在模块库中选择 PCA、PLS-DA、随机森林、Boruta、Correlation、KEGG、Heatmap 等方法。',
      points: [
        '预处理模块必须在矩阵分析前运行',
        '机器学习模块需要目标性状',
        '通路模块依赖候选基因或代谢物列表'
      ]
    },
    {
      index: '03',
      title: '查看模块结果',
      description: '单模块结果用于快速判断样本质量、特征重要性、通路富集和表型关联方向。',
      points: ['模块结果保留参数和输入仓库', '显著结果进入工作流结果', '异常样本回到本地仓库复核']
    },
    {
      index: '04',
      title: '编排工作流',
      description: '选择本地数据源、目标性状、分组方式和参数后，把多个模块串成育种分析流程。',
      points: [
        '泌乳流程连接奶厅与质量性状',
        '繁殖流程连接配种和产犊记录',
        '选择指数流程连接表型、系谱和组学'
      ]
    },
    {
      index: '05',
      title: '沉淀工作流结果',
      description: '工作流输出候选特征、候选通路、候选个体和选配建议。',
      points: ['结果可回写种质评价', '候选个体可进入选配计划', '每条结论都保留输入数据和模块链路']
    }
  ]

  const markerRows = computed(() =>
    markers.value
      .slice()
      .sort((left, right) => Number(left.pValue || 1) - Number(right.pValue || 1))
  )

  const _reproductionRiskCount = computed(() => {
    const cycles = snapshot.value.reproductionCycles || []
    return cycles.filter((row) => {
      const status = JSON.stringify(row).toLowerCase()
      return (
        status.includes('open') ||
        status.includes('risk') ||
        status.includes('空怀') ||
        status.includes('未妊娠')
      )
    }).length
  })

  function sampleMatchesCow(sample: OmicsSample, cow: CowBasic) {
    const sampleKeys = [sample.cowId, sample.cowNumber].map((item) => String(item || '').trim())
    const cowKeys = [cow.id, cow.cowNumber, (cow as AnyRow).number].map((item) =>
      String(item || '').trim()
    )
    return sampleKeys.some((key) => key && cowKeys.includes(key))
  }

  function getRouteSection() {
    const currentName = String(route.name || '')
    const currentPath = route.path
    return routeSectionMappings.find(
      (item) => item.names.includes(currentName) || item.paths.includes(currentPath)
    )
  }

  function syncSectionFromRoute() {
    const mapping = getRouteSection()
    if (mapping && activeSection.value !== mapping.key) {
      routeSyncing.value = true
      activeSection.value = mapping.key
      routeSyncing.value = false
    }
  }

  async function syncRouteFromSection(section: SectionKey) {
    const target = sections.find((item) => item.key === section)
    if (!target || route.path === target.path) return
    routeSyncing.value = true
    try {
      await router.replace(target.path)
    } finally {
      routeSyncing.value = false
    }
  }

  async function safeRows<T>(tableName: string): Promise<T[]> {
    try {
      const rows = await databaseService.getTableDataAsync(tableName, { silent: true })
      return Array.isArray(rows) ? (rows as T[]) : []
    } catch {
      return []
    }
  }

  async function loadData() {
    loading.value = true
    try {
      const [
        platformSnapshot,
        omicsSamples,
        omicsDatasets,
        omicsMarkers,
        omicsAssociations,
        analyses
      ] = await Promise.all([
        loadOmicsPlatformSnapshot(),
        safeRows<OmicsSample>('omics-samples'),
        safeRows<OmicsDataset>('omics-datasets'),
        safeRows<OmicsMarker>('omics-markers'),
        safeRows<MultiOmicsAssociation>('multi-omics-associations'),
        safeRows<BreedingAnalysis>('breeding-analyses')
      ])
      snapshot.value = platformSnapshot
      samples.value = omicsSamples
      datasets.value = omicsDatasets
      markers.value = omicsMarkers
      associations.value = omicsAssociations
      breedingAnalyses.value = analyses
      const [catalogModules, realModuleResults, realWorkflowResults] = await Promise.all([
        getOmicsModuleCatalog().catch(() => []),
        getOmicsModuleResults(50).catch(() => []),
        getOmicsWorkflowResults(50).catch(() => [])
      ])
      remoteCatalogModules.value = catalogModules as OmicsCatalogModule[]
      remoteModuleResults.value = normalizeRemoteModuleResults(realModuleResults as any[])
      remoteWorkflowResults.value = normalizeRemoteWorkflowResults(realWorkflowResults as any[])
      await nextTick()
      renderCharts()
    } catch (error) {
      console.error('加载本地组学分析仓库失败:', error)
      ElMessage.error('加载本地组学分析仓库失败')
    } finally {
      loading.value = false
    }
  }

  async function loadOmicsPlatformSnapshot(): Promise<PlatformSnapshot> {
    const context = await buildUnifiedDataContext()
    const [milkRecords, reproduction] = await Promise.all([
      loadUnifiedMilkRecords(context),
      loadUnifiedReproductionEvents(context)
    ])
    return {
      cows: context.cows as PlatformSnapshot['cows'],
      sensors: [],
      milkRecords: milkRecords as PlatformSnapshot['milkRecords'],
      breedingRecords: reproduction.events,
      reproductionCycles: reproduction.cycles,
      breedingEvents: reproduction.events,
      alerts: [],
      healthScores: []
    }
  }

  function openModule(module: AnalysisModule) {
    selectedModule.value =
      analysisModulesWithSchema.value.find((item) => item.id === module.id) || module
    resetModuleRunForm()
    moduleDialogVisible.value = true
  }

  function resetModuleRunForm() {
    const keepRepositoryId = String(moduleRunForm.repositoryId || 'omics-datasets')
    const keepTrait = String(moduleRunForm.trait || workflowTraits.value[0] || '泌乳量')
    for (const key of Object.keys(moduleRunForm)) {
      delete moduleRunForm[key]
    }
    moduleRunForm.repositoryId = keepRepositoryId
    moduleRunForm.trait = keepTrait
    moduleRunForm.groupBy = 'phenotype_group'
    for (const control of moduleParameterControls.value) {
      if (control.default !== undefined) {
        moduleRunForm[control.key] = control.default as string | number | boolean
      }
    }
    moduleRunForm.repositoryId = keepRepositoryId
    moduleRunForm.trait = keepTrait
  }

  function buildModuleParameterPayload() {
    const values: Record<string, unknown> = {}
    const schemaSnapshot = moduleParameterControls.value.map((control) => {
      const value = moduleRunForm[control.key] ?? control.default
      values[control.key] = value
      if (control.backendParam && control.backendParam !== control.key)
        values[control.backendParam] = value
      return {
        key: control.key,
        backendParam: control.backendParam || control.key,
        label: control.label,
        type: control.type,
        group: control.group,
        advanced: Boolean(control.advanced),
        required: Boolean(control.required),
        default: control.default,
        value,
        algorithm: control.algorithm,
        unit: control.unit,
        description: control.description
      }
    })
    return { values, schemaSnapshot }
  }

  function ensureWorkflowStepDefaults(moduleId: string) {
    if (!workflowStepParameterValues[moduleId]) workflowStepParameterValues[moduleId] = {}
    for (const control of getModuleParameterControls(moduleId)) {
      if (workflowStepParameterValues[moduleId][control.key] === undefined) {
        workflowStepParameterValues[moduleId][control.key] = getControlDefaultValue(control)
      }
    }
  }

  function buildWorkflowStepParameterPayload(moduleId: string) {
    ensureWorkflowStepDefaults(moduleId)
    const values: Record<string, unknown> = {}
    const schemaSnapshot = getModuleParameterControls(moduleId).map((control) => {
      const value =
        workflowStepParameterValues[moduleId]?.[control.key] ?? getControlDefaultValue(control)
      values[control.key] = value
      if (control.backendParam && control.backendParam !== control.key)
        values[control.backendParam] = value
      return {
        key: control.key,
        backendParam: control.backendParam || control.key,
        label: control.label,
        type: control.type,
        group: control.group,
        advanced: Boolean(control.advanced),
        required: Boolean(control.required),
        default: control.default,
        value,
        algorithm: control.algorithm,
        unit: control.unit,
        description: control.description
      }
    })
    return { values, schemaSnapshot }
  }

  function normalizeRemoteModuleResults(rows: any[]): ModuleRunResult[] {
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      id: String(row.id),
      moduleId: String(row.moduleId || row.module_id || ''),
      module: String(row.module || row.moduleName || row.module_name || row.moduleId || ''),
      title: String(
        row.title ||
          `${row.trait || moduleRunForm.trait} - ${row.module || row.moduleName || '模块'} 计算结果`
      ),
      status: String(row.status || '已完成'),
      tagType: (row.tagType || 'success') as TagType,
      tone: (row.tone || 'primary') as Tone,
      summary: String(row.summary || ''),
      metrics: Array.isArray(row.metrics) ? row.metrics : [],
      tags: Array.isArray(row.tags) ? row.tags : [row.dataSource || '后端结果'],
      parameters: row.parameters || {},
      effectiveParameters:
        row.effectiveParameters || row.effective_parameters || row.result?.effectiveParameters,
      executedAt: row.executedAt || row.executed_at,
      dataSource:
        row.dataSource ||
        row.data_source ||
        row.inputSummary?.dataSource ||
        row.input_summary?.data_source ||
        'local',
      methodNotes: row.methodNotes || row.method_notes,
      tables: row.tables,
      charts: row.charts,
      inputSummary: row.inputSummary || row.input_summary || {},
      artifacts: Array.isArray(row.artifacts) ? row.artifacts : [],
      operator: row.operator,
      runCode: row.runCode || row.run_code || row.parameters?.runCode || row.parameters?.run_code,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      durationMs: Number(row.durationMs || 0)
    }))
  }

  function normalizeRemoteWorkflowResults(rows: any[]): WorkflowRunRecord[] {
    return (Array.isArray(rows) ? rows : []).map((row) => {
      const parameters = row.parameters && typeof row.parameters === 'object' ? row.parameters : {}
      const inputSummary = row.inputSummary || row.input_summary || {}
      const repositoryIds = Array.isArray(row.repositoryIds)
        ? row.repositoryIds
        : Array.isArray(row.repository_ids)
          ? row.repository_ids
          : selectedRepositoryIds.value
      const summaryRepositoryTitles = toTextList(
        (inputSummary as AnyRow).repositoryTitles ||
          (inputSummary as AnyRow).repository_titles ||
          (inputSummary as AnyRow).inputRepositories
      )
      const repositoryTitles = summaryRepositoryTitles.length
        ? summaryRepositoryTitles
        : repositoryIds.map(
            (id: unknown) =>
              repositoryCards.value.find((repo) => repo.id === String(id))?.title || String(id)
          )
      const moduleIds = Array.isArray(row.moduleIds)
        ? row.moduleIds
        : Array.isArray(row.module_ids)
          ? row.module_ids
          : []
      const moduleNames = Array.isArray(row.moduleNames)
        ? row.moduleNames
        : moduleIds.map(
            (id: string) =>
              analysisModulesWithSchema.value.find((item) => item.id === id)?.name || id
          )
      const statusText = String(row.status || '已完成')
      return {
        id: String(row.id),
        template: String(row.template || row.workflowName || row.workflow_name || '组学工作流'),
        title: String(row.title || `${row.trait || workflowParams.trait} 工作流真实计算结果`),
        trait: String(row.trait || workflowParams.trait),
        status: (statusText === 'completed' ? '已完成' : statusText) as WorkflowRunRecord['status'],
        statusType: (row.statusType ||
          row.status_type ||
          (statusText === 'failed' ? 'danger' : 'success')) as TagType,
        executedAt: String(row.executedAt || row.executed_at || ''),
        dataSource: String(
          row.dataSource ||
            row.data_source ||
            (inputSummary as AnyRow).dataSource ||
            (inputSummary as AnyRow).data_source ||
            'local'
        ),
        repositoryTitles: repositoryTitles.map((item: unknown) => String(item)),
        moduleNames,
        parameterSnapshot: String(
          row.parameterSnapshot ||
            `trait=${row.trait || workflowParams.trait}; modules=${moduleNames.length}`
        ),
        summary: String(row.summary || ''),
        score: String(row.score || '88分'),
        tone: (row.tone || 'teal') as Tone,
        metrics: Array.isArray(row.metrics) ? row.metrics : [],
        conclusion: String(row.conclusion || ''),
        parameters,
        effectiveParameters:
          row.effectiveParameters ||
          row.effective_parameters ||
          ((parameters as AnyRow).effectiveParameters as Record<string, unknown>),
        tables: row.tables || row.tablesJson || row.tables_json || {},
        charts: row.charts || row.chartsJson || row.charts_json || {},
        inputSummary,
        artifacts: Array.isArray(row.artifacts) ? row.artifacts : [],
        operator: row.operator,
        runCode:
          row.runCode ||
          row.run_code ||
          (parameters as AnyRow).runCode ||
          (parameters as AnyRow).run_code,
        startedAt: row.startedAt || row.started_at,
        finishedAt: row.finishedAt || row.finished_at,
        durationMs: Number(row.durationMs || row.duration_ms || 0),
        steps: Array.isArray(row.steps)
          ? row.steps
          : Array.isArray((parameters as AnyRow).steps)
            ? (parameters as AnyRow).steps
            : [],
        moduleRunIds: Array.isArray(row.moduleRunIds)
          ? row.moduleRunIds
          : Array.isArray(row.module_run_ids)
            ? row.module_run_ids
            : [],
        methodNotes: Array.isArray(row.methodNotes)
          ? row.methodNotes
          : Array.isArray(row.method_notes)
            ? row.method_notes
            : []
      }
    })
  }

  async function runSelectedModule() {
    if (!selectedModule.value) return
    const module = selectedModule.value
    const repo = repositoryCards.value.find((item) => item.id === moduleRunForm.repositoryId)
    const { values, schemaSnapshot } = buildModuleParameterPayload()
    runningModule.value = true
    try {
      const result = await runOmicsModule({
        moduleId: module.id,
        trait: moduleRunForm.trait,
        repositoryId: moduleRunForm.repositoryId,
        groupBy: moduleRunForm.groupBy,
        parameters: {
          ...values,
          repositoryTitle: repo?.title,
          moduleName: module.name,
          parameterSchemaSnapshot: schemaSnapshot,
          clientSubmittedAt: new Date().toISOString(),
          operator: moduleRunForm.operator,
          runCode: moduleRunForm.runCode,
          metadataNote: moduleRunForm.metadataNote,
          inputRepositories: [repo?.title || moduleRunForm.repositoryId],
          moduleInputs: module.inputs,
          moduleOutput: module.output
        }
      })
      moduleRunResults.value = normalizeRemoteModuleResults([result])
        .concat(moduleRunResults.value)
        .slice(0, 12)
      moduleDialogVisible.value = false
      activeSection.value = 'moduleResults'
      ElMessage.success(`${module.name} 已完成真实计算，结果已入库`)
    } catch (error) {
      console.error('运行组学模块失败:', error)
      ElMessage.error(`${module.name} 运行失败，请检查组学分析服务`)
    } finally {
      runningModule.value = false
    }
  }

  function _groupByText(value: string) {
    const map: Record<string, string> = {
      phenotype_group: '高低表型组',
      parity_group: '胎次分组',
      pedigree_family: '系谱家系',
      lactation_stage: '泌乳阶段'
    }
    return map[value] || value
  }

  function toggleWorkflowStepParams(moduleId: string) {
    ensureWorkflowStepDefaults(moduleId)
    expandedWorkflowStepId.value = expandedWorkflowStepId.value === moduleId ? '' : moduleId
  }

  function createWorkflow() {
    const name = newWorkflowName.value.trim()
    if (!name) {
      ElMessage.warning('请先输入工作流名称')
      return
    }
    const id = `custom-workflow-${Date.now()}`
    workflowTemplates.value = [
      {
        id,
        name,
        target: workflowParams.trait,
        description:
          '自定义工作流：从本地数据源中选择仓库，再按步骤添加分析模块，运行后结果进入工作流结果。',
        moduleIds: []
      },
      ...workflowTemplates.value
    ]
    activeWorkflowTemplateId.value = id
    newWorkflowName.value = ''
    ElMessage.success(`${name} 已创建，请添加分析步骤`)
  }

  function updateActiveWorkflowModules(moduleIds: string[]) {
    moduleIds.forEach((moduleId) => ensureWorkflowStepDefaults(moduleId))
    workflowTemplates.value = workflowTemplates.value.map((template) =>
      template.id === activeWorkflowTemplate.value.id ? { ...template, moduleIds } : template
    )
  }

  function addModuleToWorkflow(moduleId: string) {
    if (activeWorkflowModuleIds.value.includes(moduleId)) return
    const module = analysisModulesWithSchema.value.find((item) => item.id === moduleId)
    ensureWorkflowStepDefaults(moduleId)
    updateActiveWorkflowModules([...activeWorkflowModuleIds.value, moduleId])
    ElMessage.success(`${module?.name || '模块'} 已添加到当前工作流`)
  }

  function removeWorkflowStep(moduleId: string) {
    updateActiveWorkflowModules(activeWorkflowModuleIds.value.filter((id) => id !== moduleId))
  }

  function moveWorkflowStep(index: number, direction: -1 | 1) {
    const nextIndex = index + direction
    const ids = [...activeWorkflowModuleIds.value]
    if (nextIndex < 0 || nextIndex >= ids.length) return
    const [item] = ids.splice(index, 1)
    ids.splice(nextIndex, 0, item)
    updateActiveWorkflowModules(ids)
  }

  function _repositoryTitleList() {
    return repositoryCards.value
      .filter((repo) => selectedRepositoryIds.value.includes(repo.id))
      .map((repo) => repo.title)
  }

  async function runCurrentWorkflow() {
    if (!activeWorkflowSteps.value.length) {
      ElMessage.warning('当前工作流还没有分析步骤，请先添加模块')
      return
    }
    const stepRepositoryIds: string[] = []
    const stepRepositoryTitles: string[] = []
    const steps = activeWorkflowSteps.value.map((step, index) => {
      const { values, schemaSnapshot } = buildWorkflowStepParameterPayload(step.id)
      const stepRepositoryId = String(
        values.repositoryId || selectedRepositoryIds.value[0] || 'omics-datasets'
      )
      const stepRepository = repositoryCards.value.find((repo) => repo.id === stepRepositoryId)
      const stepRepositoryTitle = stepRepository?.title || stepRepositoryId
      stepRepositoryIds.push(stepRepositoryId)
      stepRepositoryTitles.push(stepRepositoryTitle)
      return {
        moduleId: step.id,
        order: index + 1,
        parameters: {
          ...values,
          trait: workflowParams.trait,
          groupBy: workflowParams.groupBy,
          repositoryId: stepRepositoryId,
          repositoryTitle: stepRepositoryTitle,
          moduleName: step.name,
          parameterSchemaSnapshot: schemaSnapshot,
          clientSubmittedAt: new Date().toISOString(),
          operator: workflowParams.operator,
          runCode: workflowParams.runCode,
          metadataNote: workflowParams.metadataNote,
          inputRepositories: [stepRepositoryTitle],
          moduleInputs: step.inputs,
          moduleOutput: step.output
        }
      }
    })
    const workflowRepositoryIds = Array.from(
      new Set(stepRepositoryIds.length ? stepRepositoryIds : selectedRepositoryIds.value)
    )
    const workflowRepositoryTitles = workflowRepositoryIds.map(
      (id) => repositoryCards.value.find((repo) => repo.id === id)?.title || id
    )
    runningWorkflow.value = true
    try {
      const result = await runOmicsWorkflow({
        workflowId: activeWorkflowTemplate.value.id,
        workflowName: activeWorkflowTemplate.value.name,
        trait: workflowParams.trait,
        repositoryIds: workflowRepositoryIds,
        moduleIds: activeWorkflowModuleIds.value,
        steps,
        parameters: {
          groupBy: workflowParams.groupBy,
          missingRate: workflowParams.missingRate,
          cvFold: workflowParams.cvFold,
          operator: workflowParams.operator,
          runCode: workflowParams.runCode,
          metadataNote: workflowParams.metadataNote,
          repositoryTitles: workflowRepositoryTitles,
          stepRepositoryTitles
        }
      })
      workflowRunRecords.value = normalizeRemoteWorkflowResults([result])
        .concat(workflowRunRecords.value)
        .slice(0, 8)
      activeSection.value = 'workflowResults'
      ElMessage.success(`已生成 ${workflowParams.trait} 工作流真实计算结果`)
    } catch (error) {
      console.error('运行组学工作流失败:', error)
      ElMessage.error('工作流运行失败，请检查组学分析服务')
    } finally {
      runningWorkflow.value = false
    }
  }

  function getOrCreateChart(element: HTMLElement, key: string) {
    const cached = chartInstances.value.get(key)
    if (cached && !cached.isDisposed() && cached.getDom() === element) return cached
    if (cached) {
      cached.dispose()
      chartInstances.value.delete(key)
    }
    const existing = echarts.getInstanceByDom(element)
    if (existing && !existing.isDisposed()) {
      chartInstances.value.set(key, existing)
      return existing
    }
    const chart = echarts.init(element)
    chartInstances.value.set(key, chart)
    return chart
  }

  function renderTraitRadar() {
    const element = document.getElementById('omics-trait-radar')
    if (!element) return
    const milkVolumes = Object.values(milkStatsMap.value).map((item) => item.average)
    const chart = getOrCreateChart(element, 'omics-trait-radar')
    chart.setOption(
      {
        tooltip: {},
        radar: {
          radius: '68%',
          indicator: [
            { name: '泌乳', max: 100 },
            { name: '奶质', max: 100 },
            { name: '体尺', max: 100 },
            { name: '繁殖', max: 100 },
            { name: '系谱', max: 100 },
            { name: '组学', max: 100 }
          ],
          axisName: { color: '#334155' },
          splitLine: { lineStyle: { color: 'rgba(37, 99, 235, 0.14)' } },
          splitArea: { areaStyle: { color: ['rgba(59,130,246,0.04)', 'rgba(20,184,166,0.05)'] } }
        },
        series: [
          {
            type: 'radar',
            data: [
              {
                name: '当前覆盖',
                value: [
                  Math.min(100, average(milkVolumes) * 8 || 0),
                  Math.min(100, snapshot.value.milkRecords.length * 9),
                  Math.min(100, snapshot.value.cows.length * 12),
                  Math.min(100, snapshot.value.breedingRecords.length * 10),
                  Math.round(
                    average(snapshot.value.cows.map((cow) => getPedigreeCompleteness(cow))) || 0
                  ),
                  Math.min(100, samples.value.length * 18 + datasets.value.length * 12)
                ],
                areaStyle: { color: 'rgba(37, 99, 235, 0.16)' },
                lineStyle: { color: '#2563eb', width: 3 },
                itemStyle: { color: '#2563eb' }
              }
            ]
          }
        ]
      },
      true
    )
  }

  function renderPcaChart() {
    const element = document.getElementById('omics-pca-chart')
    if (!element) return
    const chart = getOrCreateChart(element, 'omics-pca-chart')
    const cows = snapshot.value.cows.slice(0, 12)
    const data = cows
      .map((cow, index) => {
        const milk = milkStatsMap.value[cow.id]?.average
        if (!milk) return null
        const pedigree = getPedigreeCompleteness(cow)
        const omics = samples.value.filter((sample) => sampleMatchesCow(sample, cow)).length
        return [
          Number((milk * 0.9 + (index % 3) * 2).toFixed(2)),
          Number((pedigree * 0.16 + omics * 5 + (index % 4)).toFixed(2)),
          cow.cowNumber,
          milk >= average(Object.values(milkStatsMap.value).map((item) => item.average))
            ? '高泌乳组'
            : '对照组'
        ]
      })
      .filter((item): item is [number, number, string, string] => Array.isArray(item))
    chart.setOption(
      {
        tooltip: {
          formatter: (params: AnyRow) =>
            `${params.value[2]}<br/>PC1 ${params.value[0]} / PC2 ${params.value[1]}<br/>${params.value[3]}`
        },
        grid: { left: 44, right: 24, top: 24, bottom: 44 },
        xAxis: { name: 'PC1', type: 'value' },
        yAxis: { name: 'PC2', type: 'value' },
        series: [
          {
            type: 'scatter',
            symbolSize: 16,
            data,
            itemStyle: {
              color: (params: AnyRow) => (params.value[3] === '高泌乳组' ? '#14b8a6' : '#2563eb')
            }
          }
        ]
      },
      true
    )
  }

  function renderMarkerChart() {
    const element = document.getElementById('omics-marker-chart')
    if (!element) return
    const chart = getOrCreateChart(element, 'omics-marker-chart')
    const rows = markerRows.value.slice(0, 8)
    const sourceRows = rows
    chart.setOption(
      {
        tooltip: { trigger: 'axis' },
        grid: { left: 72, right: 24, top: 24, bottom: 44 },
        xAxis: {
          type: 'category',
          axisLabel: { rotate: 24 },
          data: sourceRows.map((item) => item.markerCode)
        },
        yAxis: { type: 'value', name: '-log10(P)' },
        series: [
          {
            type: 'bar',
            data: sourceRows.map((item) => {
              const pValue = toFiniteNumber(item.pValue) || 0.01
              return Number((-Math.log10(Math.max(pValue, 1e-8))).toFixed(2))
            }),
            itemStyle: { color: '#2563eb', borderRadius: [6, 6, 0, 0] }
          }
        ]
      },
      true
    )
  }

  function renderCharts() {
    renderTraitRadar()
    renderPcaChart()
    renderMarkerChart()
  }

  function disposeCharts() {
    chartInstances.value.forEach((chart) => chart.dispose())
    chartInstances.value.clear()
  }

  watch(
    () => activeSection.value,
    async (section) => {
      if (!routeSyncing.value) {
        await syncRouteFromSection(section)
      }
      await nextTick()
      renderCharts()
    }
  )

  watch(
    () => [route.name, route.path],
    () => {
      syncSectionFromRoute()
    },
    { immediate: true }
  )

  watch(resultDetailVisible, (visible) => {
    if (!visible) {
      resultDetail.charts.forEach((chart) => {
        const instance = chartInstances.value.get(chart.domId)
        if (instance && !instance.isDisposed()) instance.dispose()
        chartInstances.value.delete(chart.domId)
      })
    } else {
      renderDetailChartsSoon()
    }
  })

  onMounted(() => {
    syncSectionFromRoute()
    loadData()
  })

  onBeforeUnmount(() => {
    disposeCharts()
  })
</script>

<style scoped lang="scss">
  .fc-metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 14px;
  }

  .workbench-nav {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 10px;
  }

  .section-button {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: center;
    min-height: 42px;
    color: var(--fluent-text-soft);
    font-size: 13px;
    font-weight: 720;
    cursor: pointer;
    background: rgb(255 255 255 / 42%);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
    box-shadow: var(--fluent-inset-highlight);
    transition:
      background 0.18s ease,
      color 0.18s ease,
      border-color 0.18s ease;
  }

  .section-button svg,
  .section-button :deep(svg) {
    width: 17px;
    height: 17px;
  }

  .section-button.active {
    color: var(--fluent-primary);
    background: rgb(var(--fluent-primary-rgb) / 10%);
    border-color: rgb(var(--fluent-primary-rgb) / 32%);
  }

  .overview-grid,
  .split-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.12fr) minmax(280px, 0.68fr);
    gap: 18px;
    align-items: stretch;
  }

  .section-stack {
    display: grid;
    gap: 18px;
  }

  .load-more-row {
    display: flex;
    justify-content: center;
    padding-top: 12px;
  }

  .local-chain,
  .repository-grid,
  .analysis-module-grid,
  .result-grid,
  .workflow-result-grid,
  .run-record-grid,
  .guide-grid {
    display: grid;
    gap: 14px;
  }

  .local-chain {
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  }

  .repository-grid {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }

  .repository-ingest-note {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 18px;
    padding: 14px 16px;
    margin-bottom: 14px;
    background:
      linear-gradient(180deg, rgb(255 255 255 / 72%), rgb(255 255 255 / 30%)),
      rgb(244 250 247 / 72%);
    border: 1px solid var(--fluent-border);
    border-left: 4px solid var(--fluent-teal);
    border-radius: var(--fluent-radius);
    box-shadow: var(--fluent-inset-highlight);

    div {
      display: grid;
      gap: 6px;
      min-width: 220px;
    }

    span {
      color: var(--fluent-muted);
      font-size: 12px;
      font-weight: 680;
    }

    strong {
      color: var(--fluent-text);
      font-size: 18px;
      font-weight: 780;
    }

    p {
      max-width: 780px;
      margin: 0;
      color: var(--fluent-text-soft);
      font-size: 13px;
      line-height: 1.65;
    }
  }

  .analysis-module-grid {
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  }

  .analysis-module-grid-scroll {
    max-height: calc((196px * 2) + 28px);
    padding: 2px 8px 2px 2px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .result-grid,
  .workflow-result-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .run-record-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .chain-card,
  .repository-card,
  .analysis-module-card,
  .module-operation-card,
  .module-parameter-panel,
  .result-card,
  .workflow-result-card,
  .run-record-card,
  .guide-card,
  .cow-mini-card,
  .workflow-step-card,
  .workflow-module-chip,
  .workflow-create-box,
  .workflow-module-picker {
    min-width: 0;
    padding: 14px;
    background: #fff;
    border: 1px solid var(--fluent-border);
    border-left: 4px solid var(--fluent-primary);
    border-radius: var(--fluent-radius);
    box-shadow: 0 1px 2px rgb(15 23 42 / 5%);
    transition:
      background-color 160ms ease,
      border-color 160ms ease;
  }

  .analysis-module-card,
  .result-card,
  .workflow-result-card,
  .workflow-step-card {
    cursor: pointer;
  }

  .analysis-module-card {
    display: flex;
    flex-direction: column;
    min-height: 196px;
  }

  .analysis-module-card:hover,
  .analysis-module-card:focus-visible,
  .result-card:hover,
  .result-card:focus-visible,
  .workflow-result-card:hover,
  .workflow-result-card:focus-visible,
  .workflow-step-card:hover,
  .workflow-step-card:focus-visible {
    border-color: rgb(var(--fluent-primary-rgb) / 45%);
    background: rgb(248 250 252);
  }

  .chain-card.teal,
  .repository-card.teal,
  .analysis-module-card.teal,
  .module-operation-card.teal,
  .result-card.teal,
  .workflow-result-card.teal {
    border-left-color: var(--fluent-teal);
  }

  .run-record-card.teal {
    border-left-color: var(--fluent-teal);
  }

  .chain-card.info,
  .repository-card.info,
  .analysis-module-card.info,
  .module-operation-card.info,
  .result-card.info,
  .workflow-result-card.info {
    border-left-color: var(--el-color-info);
  }

  .run-record-card.info {
    border-left-color: var(--el-color-info);
  }

  .chain-card.warning,
  .repository-card.warning,
  .analysis-module-card.warning,
  .module-operation-card.warning,
  .result-card.warning,
  .workflow-result-card.warning {
    border-left-color: var(--fluent-amber);
  }

  .run-record-card.warning {
    border-left-color: var(--fluent-amber);
  }

  .chain-card.danger,
  .repository-card.danger,
  .analysis-module-card.danger,
  .module-operation-card.danger,
  .result-card.danger,
  .workflow-result-card.danger {
    border-left-color: var(--fluent-danger);
  }

  .run-record-card.danger {
    border-left-color: var(--fluent-danger);
  }

  .chain-card span,
  .repository-card span,
  .analysis-module-card span,
  .module-operation-card span,
  .module-parameter-panel span,
  .workflow-module-chip span,
  .workflow-picker-head span,
  .result-card span,
  .workflow-result-card span,
  .run-record-card span,
  .cow-mini-card span,
  .workflow-step-card span,
  .workflow-title-row span,
  .parameter-panel span,
  .guide-card li {
    color: var(--fluent-muted);
    font-size: 12px;
    font-weight: 680;
  }

  .chain-card strong {
    display: block;
    margin-top: 6px;
    color: var(--fluent-text);
    font-size: 26px;
    font-weight: 780;
  }

  .chain-card p,
  .repository-card p,
  .analysis-module-card p,
  .module-operation-card p,
  .result-card p,
  .workflow-result-card p,
  .run-record-card p,
  .cow-mini-card p,
  .workflow-step-card p,
  .workflow-title-row p,
  .guide-card p {
    margin: 8px 0 0;
    color: var(--fluent-text-soft);
    font-size: 13px;
    line-height: 1.65;
  }

  .chart-box {
    width: 100%;
    height: 300px;
  }

  .card-head,
  .module-card-head,
  .result-card-head,
  .workflow-title-row,
  .module-footer {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    justify-content: space-between;
  }

  .module-card-head {
    min-width: 0;
  }

  .module-card-head > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .module-card-head > .el-tag {
    flex: 0 0 auto;
    max-width: 84px;
  }

  .icon-box {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 42px;
    color: var(--fluent-primary);
    font-size: 21px;
    background: rgb(var(--fluent-primary-rgb) / 10%);
    border-radius: var(--fluent-radius);
  }

  .repository-card h3,
  .analysis-module-card h3,
  .module-operation-card h3,
  .result-card h3,
  .workflow-result-card h3,
  .run-record-card h3,
  .cow-mini-card h3,
  .workflow-step-card h3,
  .workflow-title-row h3,
  .workflow-sidebar h3,
  .parameter-panel h3,
  .guide-card h3 {
    margin: 8px 0 0;
    color: var(--fluent-text);
    font-size: 15px;
    font-weight: 760;
  }

  .analysis-module-card h3 {
    display: -webkit-box;
    min-height: 42px;
    overflow: hidden;
    line-height: 1.42;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .analysis-module-card {
    cursor: pointer;
  }

  .analysis-module-card.active {
    border-color: rgb(var(--fluent-primary-rgb) / 34%);
    box-shadow:
      var(--fluent-inset-highlight),
      0 14px 32px rgb(var(--fluent-primary-rgb) / 14%);
  }

  .module-operation-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 16px;
    align-items: start;
  }

  .module-parameter-panel {
    display: grid;
    gap: 12px;
    border-left-color: var(--fluent-teal);
  }

  .module-parameter-panel label {
    display: grid;
    gap: 6px;
  }

  .module-dynamic-params {
    display: grid;
    gap: 10px;
    padding: 10px;
    background: rgb(var(--fluent-primary-rgb) / 6%);
    border: 1px solid rgb(var(--fluent-primary-rgb) / 12%);
    border-radius: var(--fluent-radius);
  }

  .io-summary,
  .result-io-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .io-summary div,
  .result-io-grid div {
    min-width: 0;
    padding: 9px 10px;
    background: rgb(255 255 255 / 42%);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
  }

  .io-summary strong,
  .result-io-grid strong {
    display: block;
    margin-top: 4px;
    overflow: hidden;
    color: var(--fluent-text);
    font-size: 12px;
    font-weight: 740;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .module-result-preview {
    padding: 10px;
    margin-top: 12px;
    background: rgb(var(--fluent-primary-rgb) / 7%);
    border: 1px solid rgb(var(--fluent-primary-rgb) / 12%);
    border-radius: var(--fluent-radius);
  }

  .module-result-preview strong {
    display: block;
    margin-top: 4px;
    color: var(--fluent-text);
    font-size: 14px;
    font-weight: 760;
  }

  .repo-stats,
  .result-metrics {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin-top: 12px;
  }

  .repo-stats div,
  .result-metrics div,
  .parameter-summary {
    min-width: 0;
    padding: 10px;
    background: rgb(255 255 255 / 44%);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
  }

  .repo-stats strong,
  .result-metrics strong,
  .workflow-conclusion,
  .parameter-summary strong {
    display: block;
    margin-top: 4px;
    overflow: hidden;
    color: var(--fluent-text);
    font-size: 13px;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cow-mini-list {
    display: grid;
    gap: 12px;
  }

  .cow-mini-list-viewport {
    max-height: min(68vh, 640px);
    overflow: auto;
    padding: 2px 4px 10px;
  }

  .cow-mini-card {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
  }

  .cow-mini-score {
    flex: 0 0 76px;
    text-align: right;
  }

  .cow-mini-score strong {
    display: block;
    color: var(--fluent-primary);
    font-size: 22px;
    font-weight: 780;
  }

  .cow-mini-score small {
    color: var(--fluent-muted);
    font-size: 12px;
    font-weight: 680;
  }

  .module-toolbar {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) 320px;
    gap: 12px;
    margin-bottom: 14px;
  }

  .method-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 12px;
  }

  .method-tags span {
    padding: 4px 8px;
    color: var(--fluent-primary);
    background: rgb(var(--fluent-primary-rgb) / 8%);
    border: 1px solid rgb(var(--fluent-primary-rgb) / 14%);
    border-radius: 999px;
  }

  .module-footer {
    margin-top: auto;
    padding-top: 12px;
    align-items: center;
    justify-content: flex-end;
  }

  .workflow-layout {
    display: grid;
    grid-template-columns: 280px minmax(0, 1fr) 280px;
    gap: 16px;
    align-items: start;
  }

  .workflow-sidebar,
  .parameter-panel {
    display: grid;
    gap: 12px;
    padding: 14px;
    background: rgb(255 255 255 / 36%);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
  }

  .workflow-sidebar h3,
  .parameter-panel h3 {
    margin: 0;
  }

  .source-option-group,
  .source-option,
  .parameter-panel label {
    display: grid;
    gap: 6px;
  }

  .source-option {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }

  .template-button {
    display: grid;
    gap: 4px;
    padding: 10px;
    text-align: left;
    cursor: pointer;
    background: rgb(255 255 255 / 48%);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
  }

  .workflow-create-box {
    display: grid;
    gap: 8px;
    border-left-color: var(--fluent-teal);
  }

  .template-button.active {
    border-color: rgb(var(--fluent-primary-rgb) / 34%);
    box-shadow: inset 3px 0 0 var(--fluent-primary);
  }

  .template-button span {
    color: var(--fluent-text);
    font-size: 13px;
    font-weight: 760;
  }

  .template-button small {
    color: var(--fluent-muted);
    font-size: 12px;
  }

  .workflow-canvas {
    min-height: 520px;
    padding: 16px;
    background:
      linear-gradient(90deg, rgb(var(--fluent-primary-rgb) / 5%) 1px, transparent 1px),
      linear-gradient(180deg, rgb(var(--fluent-primary-rgb) / 5%) 1px, transparent 1px),
      rgb(255 255 255 / 34%);
    background-size: 28px 28px;
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
  }

  .workflow-steps {
    display: grid;
    gap: 12px;
    margin-top: 16px;
  }

  .workflow-step-card {
    position: relative;
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 12px;
    align-items: start;
    border-left-color: var(--fluent-teal);
  }

  .workflow-step-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }

  .workflow-step-params {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 10px;
    max-height: 460px;
    padding: 12px;
    margin-top: 12px;
    overflow: auto;
    background: rgb(255 255 255 / 54%);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
  }

  .workflow-step-params label {
    display: grid;
    gap: 6px;
    min-width: 0;
    padding: 10px;
    background: rgb(255 255 255 / 48%);
    border: 1px solid rgb(var(--fluent-primary-rgb) / 10%);
    border-radius: var(--fluent-radius);
  }

  .workflow-step-params label.advanced {
    background: rgb(var(--fluent-primary-rgb) / 5%);
  }

  .workflow-module-picker {
    display: grid;
    gap: 12px;
    margin-top: 16px;
    border-left-color: var(--fluent-amber);
  }

  .workflow-picker-head {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
  }

  .workflow-picker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 10px;
  }

  .workflow-picker-scroll {
    max-height: calc((82px * 2) + 28px);
    padding: 2px 8px 2px 2px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .workflow-module-chip {
    display: grid;
    gap: 4px;
    min-height: 82px;
    text-align: left;
    cursor: pointer;
    border-left-color: var(--fluent-primary);
  }

  .workflow-module-chip strong {
    overflow: hidden;
    color: var(--fluent-text);
    font-size: 13px;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .step-index {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    color: #fff;
    font-size: 13px;
    font-weight: 780;
    background: var(--fluent-primary);
    border-radius: 50%;
  }

  .parameter-summary {
    display: grid;
    gap: 4px;
  }

  .workflow-result-card .result-card-head strong {
    flex: 0 0 auto;
    color: var(--fluent-primary);
    font-size: 24px;
    font-weight: 780;
  }

  .run-meta-grid,
  .dialog-io-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 8px;
    margin-top: 12px;
  }

  .run-meta-grid div,
  .dialog-io-grid div,
  .result-preview-block,
  .table-preview-card,
  .mini-chart-card,
  .chart-detail-card {
    min-width: 0;
    padding: 10px;
    background: rgb(255 255 255 / 46%);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
  }

  .result-preview-block {
    display: grid;
    gap: 10px;
    margin-top: 12px;
  }

  .mini-chart-bars {
    display: flex;
    gap: 6px;
    align-items: end;
    height: 92px;
    padding: 8px;
    margin-top: 8px;
    background: rgb(var(--fluent-primary-rgb) / 6%);
    border-radius: var(--fluent-radius);
  }

  .mini-chart-bars i {
    flex: 1;
    min-width: 6px;
    background: linear-gradient(180deg, var(--fluent-teal), var(--fluent-primary));
    border-radius: 999px 999px 4px 4px;
  }

  .detail-chart-box {
    width: 100%;
    height: 280px;
    min-width: 260px;
    margin-top: 10px;
  }

  .export-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }

  .module-dialog-grid {
    display: grid;
    grid-template-columns: 320px minmax(0, 1fr);
    gap: 16px;
  }

  :deep(.module-run-dialog) {
    display: flex;
    flex-direction: column;
    max-height: 90vh;
    margin: 5vh auto !important;
    overflow: hidden;
  }

  :deep(.module-run-dialog .el-dialog__body) {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  :deep(.module-run-dialog .el-dialog__footer) {
    position: sticky;
    bottom: 0;
    z-index: 3;
    background: rgb(255 255 255 / 92%);
    border-top: 1px solid var(--fluent-border);
  }

  .module-dialog-summary {
    padding: 16px;
    background: rgb(255 255 255 / 54%);
    border: 1px solid var(--fluent-border);
    border-left: 4px solid var(--fluent-primary);
    border-radius: var(--fluent-radius);
  }

  .parameter-schema-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .parameter-schema-grid label {
    display: grid;
    gap: 6px;
    min-width: 0;
    padding: 10px;
    background: rgb(var(--fluent-primary-rgb) / 5%);
    border: 1px solid rgb(var(--fluent-primary-rgb) / 12%);
    border-radius: var(--fluent-radius);
  }

  .parameter-schema-grid.compact {
    max-height: 560px;
    padding-right: 4px;
    overflow: auto;
  }

  .parameter-schema-grid label.advanced {
    background: rgb(15 118 110 / 6%);
    border-color: rgb(15 118 110 / 18%);
  }

  .parameter-label {
    display: flex;
    gap: 6px;
    align-items: center;
    justify-content: space-between;
  }

  .parameter-current {
    min-width: 0;
    overflow: hidden;
    color: var(--fluent-text);
    font-size: 12px;
    font-weight: 720;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .parameter-toolbar,
  .parameter-snapshot-grid,
  .artifact-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .parameter-toolbar > div,
  .parameter-snapshot-grid > div,
  .artifact-list > div {
    min-width: 0;
    padding: 9px 10px;
    background: rgb(255 255 255 / 48%);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
  }

  .parameter-snapshot-grid strong,
  .artifact-list strong {
    display: block;
    min-width: 0;
    overflow: hidden;
    color: var(--fluent-text);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .parameter-snapshot-grid small,
  .artifact-list small {
    display: block;
    margin-top: 3px;
    overflow: hidden;
    color: var(--fluent-muted);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .parameter-schema-grid small {
    min-height: 16px;
    color: var(--fluent-muted);
    font-size: 12px;
    line-height: 1.35;
  }

  .workflow-conclusion {
    padding: 10px;
    margin-top: 12px;
    white-space: normal;
    background: rgb(var(--fluent-primary-rgb) / 7%);
    border: 1px solid rgb(var(--fluent-primary-rgb) / 12%);
  }

  .result-source {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 10px;
  }

  .workflow-trace,
  .record-line {
    padding: 9px 10px;
    margin-top: 10px;
    background: rgb(255 255 255 / 44%);
    border: 1px solid var(--fluent-border);
    border-radius: var(--fluent-radius);
  }

  .workflow-trace strong,
  .record-line strong {
    display: block;
    margin-top: 4px;
    overflow: hidden;
    color: var(--fluent-text);
    font-size: 13px;
    font-weight: 740;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .method-note-list {
    display: grid;
    gap: 6px;
    margin-top: 10px;
  }

  .method-note-list span {
    padding: 7px 9px;
    color: var(--fluent-text-soft);
    font-size: 12px;
    line-height: 1.5;
    background: rgb(255 255 255 / 38%);
    border: 1px dashed var(--fluent-border);
    border-radius: var(--fluent-radius);
  }

  .guide-grid {
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  }

  .guide-card {
    display: grid;
    grid-template-columns: 52px minmax(0, 1fr);
    gap: 14px;
  }

  .guide-index {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 52px;
    height: 52px;
    color: #fff;
    font-weight: 780;
    background: linear-gradient(135deg, var(--fluent-primary), var(--fluent-teal));
    border-radius: var(--fluent-radius);
  }

  .guide-card ul {
    padding-left: 18px;
    margin: 10px 0 0;
  }

  .guide-card li {
    margin: 6px 0;
    line-height: 1.5;
  }

  @media (max-width: 1280px) {
    .workbench-nav,
    .fc-metric-grid,
    .local-chain,
    .repository-grid,
    .result-grid,
    .workflow-result-grid,
    .run-record-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .workflow-layout,
    .module-dialog-grid,
    .module-operation-layout,
    .overview-grid,
    .split-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 760px) {
    .workbench-nav,
    .fc-metric-grid,
    .local-chain,
    .repository-grid,
    .result-grid,
    .workflow-result-grid,
    .run-record-grid,
    .module-toolbar,
    .repo-stats,
    .result-metrics,
    .workflow-picker-head,
    .run-meta-grid,
    .dialog-io-grid,
    .parameter-schema-grid,
    .guide-card {
      grid-template-columns: 1fr;
    }

    .section-button,
    .cow-mini-card,
    .card-head,
    .result-card-head,
    .workflow-title-row,
    .workflow-picker-head,
    .module-footer {
      display: grid;
      justify-content: stretch;
    }

    .chart-box {
      height: 260px;
    }

    .cow-mini-score {
      text-align: left;
    }
  }
</style>
