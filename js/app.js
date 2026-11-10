import {
  PRODUCTS,
  STEPS,
  activeStep,
  clearBlock,
  confirmStep,
  createTask,
  elapsedText,
  evidenceToCsv,
  formatDate,
  getProduct,
  parseCsv,
  resetProgress,
  sealEvidence,
  stepById,
  stepStatus,
  taskComplete,
  taskDigest,
  validateBatchRecords,
  verifyFixture,
  verifyFirstPiece,
  verifyMaterial,
  verifyTorque,
} from "./engine.js";

const STORAGE_KEY = "gongxu-changeover-task-v1";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

let task = loadTask() ?? createTask();
let selectedModel = task.targetModel;
let toastTimer = null;
let chatMessages = [
  {
    role: "agent",
    text:
      "我已连接当前换型任务。可以问我：下一步做什么、为什么被拦截、当前治具和参数要求是什么。我的回答只使用本机任务与规则库。",
  },
];
let toolTrace = [
  {
    name: "get_task_state",
    detail: "读取当前任务、步骤状态与阻塞原因",
  },
  {
    name: "lookup_sop",
    detail: "读取目标型号的治具、参数和BOM标准",
  },
];
let batchRows = [];

function loadTask() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (!parsed?.targetModel || !Array.isArray(parsed.evidence)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveTask() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(task));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showView(viewName) {
  $$(".view").forEach((view) => {
    view.classList.toggle("on", view.id === `view-${viewName}`);
  });
  $$(".tab").forEach((tab) => {
    tab.classList.toggle("on", tab.dataset.view === viewName);
  });
  if (viewName === "evidence") renderEvidence();
  if (viewName === "agent") renderAgent();
  if (viewName === "execute") renderExecution();
  window.location.hash = viewName === "overview" ? "" : viewName;
  $("main").scrollTop = 0;
}

function notify(message, type = "") {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast show ${type}`.trim();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.className = "toast";
  }, 2600);
}

function renderAll() {
  renderTop();
  renderOverview();
  renderOrderForm();
  renderExecution();
  renderEvidence();
  renderAgentContext();
}

function renderTop() {
  const done = task.verified.length;
  const blocked = Boolean(task.blocked);
  const stateLabel = taskComplete(task)
    ? "已完成"
    : blocked
      ? "已拦截"
      : task.startedAt
        ? "进行中"
        : "就绪";
  $("#topStats").innerHTML = `
    <div class="topstat"><b>${escapeHtml(task.line)}</b><span>当前产线</span></div>
    <div class="topstat"><b>${escapeHtml(task.workOrder)}</b><span>当前工单</span></div>
    <div class="topstat ${taskComplete(task) ? "ok" : ""}"><b>${done} / ${STEPS.length}</b><span>已验证步骤</span></div>
    <div class="topstat ${blocked ? "hot" : "ok"}"><b>${blocked ? "BLOCK" : stateLabel}</b><span>${blocked ? "禁止下一步" : "现场状态"}</span></div>
    <div class="topstat"><b id="topElapsed">${elapsedText(task)}</b><span>换型用时</span></div>
  `;
  $("#tabSteps").textContent = `${done}/${STEPS.length}`;
  $("#tabExecute").textContent = blocked ? "已拦截" : taskComplete(task) ? "已完成" : task.startedAt ? "进行中" : "待开始";
  $("#tabEvidence").textContent = String(task.evidence.length);
}

function renderOverview() {
  const done = task.verified.length;
  const percent = Math.round((done / STEPS.length) * 100);
  const blocked = task.blocked;
  $("#kpis").innerHTML = `
    <div class="kpi"><b>${escapeHtml(task.targetModel)}</b><p>目标型号</p><small>${escapeHtml(getProduct(task.targetModel).name)}</small></div>
    <div class="kpi"><b>${escapeHtml(task.workOrder)}</b><p>当前工单</p><small>${escapeHtml(task.line)} · ${escapeHtml(task.operator)}</small></div>
    <div class="kpi ${taskComplete(task) ? "ok" : ""}"><b>${done} / ${STEPS.length}</b><p>已验证步骤</p><small>状态机逐项放行</small></div>
    <div class="kpi ${blocked ? "hot" : "ok"}"><b>${blocked ? 1 : 0}</b><p>当前阻塞</p><small>${blocked ? escapeHtml(blocked.title) : "无阻断项"}</small></div>
    <div class="kpi"><b>${task.evidence.length}</b><p>证据记录</p><small>本地审计条目</small></div>
  `;

  const state = $("#taskState");
  state.className = `task-state ${taskComplete(task) ? "done" : blocked ? "blocked" : task.startedAt ? "active" : ""}`;
  state.textContent = taskComplete(task) ? "已完成" : blocked ? "已拦截" : task.startedAt ? "执行中" : "就绪";

  $("#currentTaskSub").textContent = `${task.workOrder} · ${task.line} · ${getProduct(task.targetModel).name}`;
  $("#progressDial").style.setProperty("--p", percent);
  $("#progressPercent").textContent = `${percent}%`;

  const current = activeStep(task);
  if (taskComplete(task)) {
    $("#nextTitle").textContent = "换型完成，证据包已封印";
    $("#nextDescription").textContent = "所有关键动作已完成核验，记录可导出用于班组交接和质量追溯。";
  } else if (blocked) {
    $("#nextTitle").textContent = blocked.title;
    $("#nextDescription").textContent = blocked.detail;
  } else if (!task.startedAt) {
    $("#nextTitle").textContent = "开始一次可验证的换型";
    $("#nextDescription").textContent = "确认工单后，系统会解锁第一步，并按现场核验结果逐项推进。";
  } else {
    $("#nextTitle").textContent = current?.title ?? "继续执行";
    $("#nextDescription").textContent = current?.description ?? "";
  }
  $("#currentMeta").innerHTML = `
    <span>目标治具 <b>${escapeHtml(getProduct(task.targetModel).fixtureId)}</b></span>
    <span>目标扭力 <b>${getProduct(task.targetModel).torque.toFixed(2)} N·m</b></span>
    <span>物料 <b>${escapeHtml(getProduct(task.targetModel).materialCode)}</b></span>
  `;

  const expected = getProduct(task.targetModel);
  const controls = [
    {
      number: "01",
      title: "治具编号",
      description: expected.fixtureName,
      value: expected.fixtureId,
      status: controlStatus("fixture"),
    },
    {
      number: "02",
      title: "设备扭力",
      description: `允许 ±${expected.torqueTolerance.toFixed(2)} N·m`,
      value: `${expected.torque.toFixed(2)} N·m`,
      status: controlStatus("torque"),
    },
    {
      number: "03",
      title: "物料BOM",
      description: expected.materialName,
      value: expected.materialCode,
      status: controlStatus("material"),
    },
  ];
  $("#controlList").innerHTML = controls
    .map(
      (item) => `
        <div class="control-item ${item.status === "done" ? "is-ok" : item.status === "blocked" ? "is-bad" : ""}">
          <span class="control-num">${item.number}</span>
          <div><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.description)}</small></div>
          <span class="control-value">${escapeHtml(item.value)}</span>
        </div>
      `,
    )
    .join("");

  $("#timelineHint").textContent = `${done} / ${STEPS.length} 已验证`;
  $("#processRail").innerHTML = STEPS.map((step, index) => {
    const status = stepStatus(task, step.id);
    return `
      <div class="rail-step ${status === "done" ? "is-done" : status === "active" ? "is-active" : status === "blocked" ? "is-blocked" : ""}">
        <span class="rail-dot"></span>
        <b>${escapeHtml(step.short)}</b>
        <span>${String(index + 1).padStart(2, "0")}</span>
      </div>
    `;
  }).join("");

  $("#stepMatrix").innerHTML = `
    <table class="step-matrix">
      <thead><tr><th>步骤</th><th>动作</th><th>现场核验</th><th>证据</th></tr></thead>
      <tbody>
        ${STEPS.map((step) => {
          const status = stepStatus(task, step.id);
          const label = status === "done" ? "已放行" : status === "active" ? "进行中" : status === "blocked" ? "已拦截" : "待执行";
          return `<tr>
            <td class="matrix-step">${escapeHtml(step.short)}</td>
            <td><i class="matrix-swatch ${status}"></i> ${label}</td>
            <td><i class="matrix-swatch ${["fixture", "torque", "material", "firstpiece"].includes(step.id) ? status : "na"}"></i> ${["fixture", "torque", "material", "firstpiece"].includes(step.id) ? label : "规则确认"}</td>
            <td><i class="matrix-swatch ${status}"></i> ${status === "done" ? "已留存" : "未生成"}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  `;

  $("#evidenceCountInline").textContent = `${task.evidence.length} 条`;
  renderEventList($("#recentEvents"), task.evidence.slice(0, 5), true);
}

function controlStatus(stepId) {
  if (task.verified.includes(stepId)) return "done";
  if (task.blocked?.stepId === stepId) return "blocked";
  return "pending";
}

function renderEventList(container, events, compact = false) {
  if (!events.length) {
    container.innerHTML = `<div class="empty-state">当前还没有审计记录。<br>开始换型后，每个判定都会写入本地证据链。</div>`;
    return;
  }
  container.innerHTML = events
    .map(
      (item) => `
        <div class="event-row">
          <span class="event-time">${escapeHtml(formatDate(item.at))}</span>
          <div class="event-main">
            <b>${escapeHtml(item.title)}</b>
            <span>${escapeHtml(compact ? truncate(item.detail, 64) : item.detail)}</span>
          </div>
          <span class="event-status ${item.type === "blocked" ? "blocked" : ""}">${item.type === "blocked" ? "拦截" : "记录"}</span>
        </div>
      `,
    )
    .join("");
}

function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function renderOrderForm() {
  if (document.activeElement?.closest("#orderForm")) {
    renderOrderResolution();
    return;
  }
  $("#workOrderInput").value = task.workOrder;
  $("#lineInput").value = task.line;
  $("#operatorInput").value = task.operator;
  selectedModel = task.targetModel;
  renderModelOptions();
  renderOrderResolution();
}

function renderModelOptions() {
  $("#modelOptions").innerHTML = ["B02", "C03"]
    .map((code) => {
      const product = PRODUCTS[code];
      return `
        <button type="button" class="model-card ${selectedModel === code ? "on" : ""}" data-model="${code}">
          <b>${escapeHtml(product.code)} · ${escapeHtml(product.name.replace(`${code} `, ""))}</b>
          <span>${escapeHtml(product.fixtureId)} · ${product.torque.toFixed(2)} N·m · ${escapeHtml(product.materialCode)}</span>
        </button>
      `;
    })
    .join("");
  $$(".model-card", $("#modelOptions")).forEach((button) => {
    button.addEventListener("click", () => {
      selectedModel = button.dataset.model;
      renderModelOptions();
      renderOrderResolution();
    });
  });
}

function renderOrderResolution() {
  const product = getProduct(selectedModel);
  $("#modelBadge").textContent = product.code;
  $("#orderResolution").innerHTML = `
    <div class="resolution-hero">
      <span>TARGET PRODUCT</span>
      <b>${escapeHtml(product.code)} · ${escapeHtml(product.name.replace(`${product.code} `, ""))}</b>
    </div>
    <div class="resolution-grid">
      <div class="resolution-item"><span>适用工位</span><b>${escapeHtml(product.station)}</b></div>
      <div class="resolution-item"><span>治具编号</span><b>${escapeHtml(product.fixtureId)}</b></div>
      <div class="resolution-item"><span>设备扭力</span><b>${product.torque.toFixed(2)} ± ${product.torqueTolerance.toFixed(2)} N·m</b></div>
      <div class="resolution-item"><span>物料编码</span><b>${escapeHtml(product.materialCode)}</b></div>
      <div class="resolution-item"><span>首件间隙</span><b>${product.gapMin.toFixed(2)}–${product.gapMax.toFixed(2)} mm</b></div>
      <div class="resolution-item"><span>首件扭力</span><b>${product.firstTorqueMin.toFixed(2)}–${product.firstTorqueMax.toFixed(2)} N·m</b></div>
    </div>
  `;
  $("#riskGrid").innerHTML = `
    <div class="risk-card">
      <span class="risk-label">FIXTURE</span>
      <b>J-A17 与目标治具外形接近</b>
      <p>使用扫码核验，禁止仅凭外观确认。</p>
    </div>
    <div class="risk-card">
      <span class="risk-label">PARAMETER</span>
      <b>设备可能保留上一型号参数</b>
      <p>必须读取面板当前值，不看历史工艺卡。</p>
    </div>
    <div class="risk-card">
      <span class="risk-label">MATERIAL</span>
      <b>料盒标签相似，存在混料风险</b>
      <p>物料编码与工单BOM必须完全一致。</p>
    </div>
  `;
}

function renderExecution() {
  const current = activeStep(task);
  const product = getProduct(task.targetModel);
  const blocked = task.blocked;
  $("#executeSubtitle").textContent = `${task.workOrder} · ${task.line} · ${product.name}`;
  $("#executeTaskChip").textContent = taskComplete(task) ? "证据包已完成" : blocked ? "后续步骤已锁定" : task.startedAt ? "现场执行中" : "等待开始";
  $("#stepProgressText").textContent = `${task.verified.length} / ${STEPS.length}`;

  $("#stepList").innerHTML = STEPS.map((step, index) => {
    const status = stepStatus(task, step.id);
    const label =
      status === "done"
        ? "已验证"
        : status === "active"
          ? "当前"
          : status === "blocked"
            ? "已拦截"
            : "待执行";
    return `
      <div class="step-item ${status}">
        <span class="step-number">${String(index + 1).padStart(2, "0")}</span>
        <div><b>${escapeHtml(step.short)}</b><small>${escapeHtml(step.title)}</small></div>
        <span class="step-state">${label}</span>
      </div>
    `;
  }).join("");

  const actionStatus = $("#actionStatus");
  actionStatus.className = `status-badge ${taskComplete(task) ? "done" : blocked ? "blocked" : task.startedAt ? "active" : "pending"}`;
  actionStatus.textContent = taskComplete(task) ? "已完成" : blocked ? "已拦截" : task.startedAt ? "执行中" : "等待开始";
  $("#actionPanelTitle").textContent = taskComplete(task) ? "换型闭环已完成" : current?.title ?? "当前动作";
  $("#actionPanelSub").textContent = taskComplete(task)
    ? "证据已封印，可导出与打印"
    : current?.description ?? "";

  renderActionBody(current, blocked);
  renderAuditTrail();
}

function renderActionBody(current, blocked) {
  const body = $("#actionBody");
  if (taskComplete(task)) return renderCompleteState(body);
  if (!task.startedAt) return renderStartState(body);

  const intro = blocked
    ? `<div class="action-intro blocked"><b>${escapeHtml(blocked.title)}</b><p>${escapeHtml(blocked.detail)}</p></div>`
    : `<div class="action-intro"><b>本步放行条件</b><p>${escapeHtml(current.description)}</p></div>`;
  const product = getProduct(task.targetModel);

  if (!current) return;
  if (current.id === "order") {
    body.innerHTML = `
      ${intro}
      <div class="expect-box">
        <div class="expect-item"><span>目标型号</span><b>${escapeHtml(product.code)}</b></div>
        <div class="expect-item"><span>当前工单</span><b>${escapeHtml(task.workOrder)}</b></div>
        <div class="expect-item"><span>适用工位</span><b>${escapeHtml(product.station)}</b></div>
      </div>
      <div class="action-actions"><button class="btn primary" id="confirmOrder">确认工单并开始换型</button></div>
      ${toolLog(["get_work_order", "lookup_product_standard"], "待确认工单与设备标准")}
    `;
    $("#confirmOrder").addEventListener("click", () => {
      confirmStep(task, "order", `${task.workOrder} 与 ${product.code} 标准已确认`, { product });
      saveAndRender("工单已确认，进入旧料清理");
    });
    return;
  }

  if (current.id === "clear") {
    body.innerHTML = `
      ${intro}
      <label class="check-row"><input type="checkbox" id="clearMaterial"> A型旧料已全部撤出当前工位</label>
      <label class="check-row"><input type="checkbox" id="clearSign"> 已完成旧料隔离与换型状态牌更新</label>
      <div class="action-actions"><button class="btn primary" id="confirmClear" disabled>确认清空并继续</button></div>
      ${toolLog(["get_previous_model", "check_line_clearance"], "旧料状态需人工确认")}
    `;
    const update = () => {
      $("#confirmClear").disabled = !($("#clearMaterial").checked && $("#clearSign").checked);
    };
    $("#clearMaterial").addEventListener("change", update);
    $("#clearSign").addEventListener("change", update);
    $("#confirmClear").addEventListener("click", () => {
      confirmStep(task, "clear", "旧料已清空、隔离状态牌已更新", {
        materialCleared: true,
        areaIsolated: true,
      });
      saveAndRender("旧料清空完成，开始更换治具");
    });
    return;
  }

  if (current.id === "fixture") {
    body.innerHTML = `
      ${intro}
      ${expectBox([
        ["目标治具", product.fixtureId],
        ["治具名称", product.fixtureName],
        ["核验方式", "二维码精确匹配"],
      ])}
      <label class="field">
        <span>扫描或输入治具二维码</span>
        <div class="scan-row">
          <input id="fixtureScan" autocomplete="off" placeholder="等待扫码枪输入…">
          <button class="btn primary" id="verifyFixture">核验并放行</button>
        </div>
      </label>
      <div class="helper-row">
        <button data-fill="J-A17">模拟扫描旧治具 J-A17</button>
        <button data-fill="${product.fixtureId}">模拟扫描目标治具 ${product.fixtureId}</button>
      </div>
      ${toolLog(["scan_barcode", "compare_fixture"], `目标 ${product.fixtureId}`)}
    `;
    bindFixtureActions(product);
    return;
  }

  if (current.id === "torque") {
    const min = product.torque - product.torqueTolerance;
    const max = product.torque + product.torqueTolerance;
    body.innerHTML = `
      ${intro}
      ${expectBox([
        ["目标扭力", `${product.torque.toFixed(2)} N·m`],
        ["允许范围", `${min.toFixed(2)}–${max.toFixed(2)}`],
        ["当前设备来源", product.station],
      ])}
      <div class="form-grid">
        <label class="span-2">
          <span>输入设备面板当前读数（N·m）</span>
          <input id="torqueValue" type="number" step="0.01" inputmode="decimal" value="${task.targetModel === "B02" ? "1.20" : "1.20"}">
        </label>
      </div>
      <div class="action-actions"><button class="btn primary" id="verifyTorque">校验参数并放行</button></div>
      ${toolLog(["read_panel_value", "compare_parameter_range"], `允许 ${min.toFixed(2)}–${max.toFixed(2)} N·m`)}
    `;
    $("#verifyTorque").addEventListener("click", () => {
      const result = verifyTorque(task, $("#torqueValue").value);
      if (result.ok) saveAndRender("扭力参数通过核验");
      else saveAndRender(result.blocked.detail, "bad");
    });
    return;
  }

  if (current.id === "material") {
    body.innerHTML = `
      ${intro}
      ${expectBox([
        ["目标物料", product.materialCode],
        ["物料名称", product.materialName],
        ["核验方式", "二维码与BOM比对"],
      ])}
      <label class="field">
        <span>扫描或输入物料二维码</span>
        <div class="scan-row">
          <input id="materialScan" autocomplete="off" placeholder="等待扫码枪输入…">
          <button class="btn primary" id="verifyMaterial">核验并放行</button>
        </div>
      </label>
      <div class="helper-row">
        <button data-fill="MAT-A-110">模拟扫描A型混料</button>
        <button data-fill="${product.materialCode}">模拟扫描目标物料 ${product.materialCode}</button>
      </div>
      ${toolLog(["scan_material", "compare_bom"], `目标 ${product.materialCode}`)}
    `;
    bindMaterialActions(product);
    return;
  }

  if (current.id === "firstpiece") {
    body.innerHTML = `
      ${intro}
      ${expectBox([
        ["间隙范围", `${product.gapMin.toFixed(2)}–${product.gapMax.toFixed(2)} mm`],
        ["扭力范围", `${product.firstTorqueMin.toFixed(2)}–${product.firstTorqueMax.toFixed(2)} N·m`],
        ["照片证据", "必须留存"],
      ])}
      <div class="form-grid">
        <label>
          <span>首件间隙（mm）</span>
          <input id="gapValue" type="number" step="0.01" inputmode="decimal" value="0.44">
        </label>
        <label>
          <span>首件扭力（N·m）</span>
          <input id="firstTorqueValue" type="number" step="0.01" inputmode="decimal" value="${product.firstTorqueMin.toFixed(2)}">
        </label>
        <div class="photo-drop span-2">
          <div><b id="photoLabel">${task.firstPieceDraft.photoName ? escapeHtml(task.firstPieceDraft.photoName) : "尚未添加首件照片"}</b><span>本地预览，不上传服务器</span></div>
          <div class="button-row">
            <button class="btn ghost small" type="button" id="choosePhoto">选择照片</button>
            <button class="btn ghost small" type="button" id="samplePhoto">载入示例证据</button>
          </div>
        </div>
      </div>
      <input type="file" id="photoInput" accept="image/*" hidden>
      <div class="action-actions"><button class="btn primary" id="verifyFirstPiece">提交首件核验</button></div>
      ${toolLog(["read_first_piece", "validate_quality_rules", "attach_photo"], "间隙、扭力、照片三项同时校验")}
    `;
    bindFirstPieceActions(product);
    return;
  }

  if (current.id === "seal") {
    body.innerHTML = `
      ${intro}
      <div class="evidence-callout complete">
        <b>${task.verified.length} 个步骤已核验</b>
        <p>系统将写入当前时间、任务摘要与证据摘要，完成后不可继续修改。</p>
      </div>
      <div class="checks-grid" style="margin-top:16px">
        ${STEPS.slice(0, 6).map((step) => `<div class="check-chip ok"><span>${escapeHtml(step.short)}</span><b>已放行</b></div>`).join("")}
      </div>
      <div class="action-actions"><button class="btn primary" id="sealTask">封印并生成证据包</button></div>
      ${toolLog(["collect_audit_events", "digest_evidence_package"], "生成可追溯摘要")}
    `;
    $("#sealTask").addEventListener("click", () => {
      const result = sealEvidence(task);
      if (result.ok) saveAndRender("证据包已生成并封印", "ok");
      else saveAndRender(result.blocked.detail, "bad");
    });
  }
}

function renderStartState(body) {
  const product = getProduct(task.targetModel);
  body.innerHTML = `
    <div class="action-intro">
      <b>现场状态机尚未启动</b>
      <p>开始后，系统将锁定未核验动作，防止跳步。操作数据仅保存在本机浏览器。</p>
    </div>
    ${expectBox([
      ["目标治具", product.fixtureId],
      ["目标扭力", `${product.torque.toFixed(2)} N·m`],
      ["目标物料", product.materialCode],
    ])}
    <div class="action-actions"><button class="btn primary" id="startTask">开始换型</button><button class="btn ghost" id="reviewOrder">查看工单标准</button></div>
    ${toolLog(["get_task", "lock_pending_steps"], "开始后进入逐步核验")}
  `;
  $("#startTask").addEventListener("click", () => {
    markStartedManually();
    saveAndRender("换型已开始，请确认工单");
  });
  $("#reviewOrder").addEventListener("click", () => showView("orders"));
}

function renderCompleteState(body) {
  const digest = taskDigest(task);
  body.innerHTML = `
    <div class="action-intro">
      <b>本次换型已完成</b>
      <p>所有关键动作已验证，证据摘要 ${digest}。可以导出、打印或开始下一批次。</p>
    </div>
    <div class="expect-box">
      <div class="expect-item"><span>完成步骤</span><b>${STEPS.length} / ${STEPS.length}</b></div>
      <div class="expect-item"><span>总用时</span><b>${elapsedText(task)}</b></div>
      <div class="expect-item"><span>审计记录</span><b>${task.evidence.length}</b></div>
    </div>
    <div class="checks-grid">
      ${["治具编号", "扭力参数", "物料BOM", "首件检查"].map((label) => `<div class="check-chip ok"><span>${label}</span><b>已核验</b></div>`).join("")}
    </div>
    <div class="action-actions"><button class="btn primary" data-go-view="evidence">查看证据包</button><button class="btn ghost" id="nextTask">开始下一批次</button></div>
    ${toolLog(["collect_audit_events", "digest_evidence_package"], `SHA摘要 ${digest}`)}
  `;
  $("#nextTask").addEventListener("click", () => {
    task = resetProgress(createTask({
      targetModel: task.targetModel,
      workOrder: task.workOrder,
      line: task.line,
      operator: task.operator,
    }));
    saveTask();
    renderAll();
    showView("orders");
    notify("已准备下一批次，请确认工单");
  });
}

function markStartedManually() {
  if (!task.startedAt) {
    task.startedAt = new Date().toISOString();
    task.evidence.unshift({
      id: `EV-${Date.now()}-START`,
      at: task.startedAt,
      type: "info",
      stepId: "order",
      title: "换型开始",
      detail: `${task.line} / ${task.targetModel} 动态换型清单已启用`,
      actor: task.operator,
    });
  }
}

function expectBox(items) {
  return `<div class="expect-box">${items
    .map(([label, value]) => `<div class="expect-item"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`)
    .join("")}</div>`;
}

function toolLog(tools, detail) {
  return `<div class="action-log"><h4>TOOL TRACE</h4>${tools
    .map((tool) => `<code>${escapeHtml(tool)}() · ${escapeHtml(detail)}</code>`)
    .join("")}</div>`;
}

function bindFixtureActions(product) {
  $("#verifyFixture").addEventListener("click", () => {
    const result = verifyFixture(task, $("#fixtureScan").value);
    if (result.ok) saveAndRender("治具核验通过，进入参数切换");
    else saveAndRender(result.blocked.detail, "bad");
  });
  $("#fixtureScan").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      $("#verifyFixture").click();
    }
  });
  $$("[data-fill]", $(".helper-row")).forEach((button) => {
    button.addEventListener("click", () => {
      $("#fixtureScan").value = button.dataset.fill;
      $("#fixtureScan").focus();
    });
  });
}

function bindMaterialActions(product) {
  $("#verifyMaterial").addEventListener("click", () => {
    const result = verifyMaterial(task, $("#materialScan").value);
    if (result.ok) saveAndRender("物料核验通过，进入首件检查");
    else saveAndRender(result.blocked.detail, "bad");
  });
  $("#materialScan").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      $("#verifyMaterial").click();
    }
  });
  $$("[data-fill]", $(".helper-row")).forEach((button) => {
    button.addEventListener("click", () => {
      $("#materialScan").value = button.dataset.fill;
      $("#materialScan").focus();
    });
  });
}

function bindFirstPieceActions(product) {
  $("#choosePhoto").addEventListener("click", () => $("#photoInput").click());
  $("#photoInput").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    task.firstPieceDraft.photoName = file.name;
    $("#photoLabel").textContent = file.name;
    saveTask();
  });
  $("#samplePhoto").addEventListener("click", () => {
    task.firstPieceDraft.photoName = `OP03_首件_${product.code}_现场照片.jpg`;
    $("#photoLabel").textContent = task.firstPieceDraft.photoName;
    saveTask();
  });
  $("#verifyFirstPiece").addEventListener("click", () => {
    const gap = $("#gapValue").value;
    const torque = $("#firstTorqueValue").value;
    task.firstPieceDraft.gap = gap;
    task.firstPieceDraft.torque = torque;
    const result = verifyFirstPiece(task, {
      gap,
      torque,
      photoName: task.firstPieceDraft.photoName,
    });
    if (result.ok) saveAndRender("首件检查通过，进入证据封印");
    else saveAndRender(result.blocked.detail, "bad");
  });
}

function saveAndRender(message, type = "ok") {
  saveTask();
  renderAll();
  if (message) notify(message, type);
}

function renderAuditTrail() {
  const container = $("#auditTrail");
  const events = task.evidence.slice(0, 8);
  if (!events.length) {
    container.innerHTML = `<div class="empty-state">尚无审计记录</div>`;
    return;
  }
  container.innerHTML = `<div class="audit-list">${events
    .map(
      (item) => `
        <div class="audit-entry ${item.type === "blocked" ? "blocked" : ""}">
          <b>${escapeHtml(item.title)}</b>
          <span>${escapeHtml(formatDate(item.at))} · ${escapeHtml(item.stepId)}</span>
          <span>${escapeHtml(item.detail)}</span>
        </div>
      `,
    )
    .join("")}</div>`;
}

function renderEvidence() {
  const blockedCount = task.evidence.filter((item) => item.type === "blocked").length;
  const digest = taskDigest(task);
  $("#evidenceKpis").innerHTML = `
    <div class="kpi"><b>${task.verified.length} / ${STEPS.length}</b><p>已核验步骤</p><small>${task.startedAt ? "状态机已启动" : "尚未开始"}</small></div>
    <div class="kpi"><b>${task.evidence.length}</b><p>审计记录</p><small>当前任务全部本地事件</small></div>
    <div class="kpi ${blockedCount ? "hot" : "ok"}"><b>${blockedCount}</b><p>拦截记录</p><small>错误动作不会静默通过</small></div>
    <div class="kpi"><b>${taskComplete(task) ? "已封印" : "草稿"}</b><p>证据状态</p><small>${digest}</small></div>
    <div class="kpi"><b>${elapsedText(task)}</b><p>任务用时</p><small>${formatDate(task.startedAt || new Date()) } 起</small></div>
  `;
  $("#evidenceStatus").textContent = taskComplete(task) ? "已封印" : "草稿";
  $("#digestLabel").textContent = `摘要 ${digest}`;
  $("#evidenceSummary").innerHTML = `
    <div class="evidence-callout ${taskComplete(task) ? "complete" : ""}">
      <b>${taskComplete(task) ? "换型证据已完整" : task.verified.length ? "换型仍在执行" : "尚未生成现场证据"}</b>
      <p>${taskComplete(task) ? "关键步骤全部放行，可导出用于交接、审计或质量追溯。" : `已完成 ${task.verified.length} / ${STEPS.length} 步，仍未满足完整证据条件。`}</p>
    </div>
    <div class="checks-grid">
      ${["fixture", "torque", "material", "firstpiece"].map((id) => {
        const ok = task.verified.includes(id);
        return `<div class="check-chip ${ok ? "ok" : ""}"><span>${escapeHtml(stepById(id).short)}</span><b>${ok ? "已核验" : "待核验"}</b></div>`;
      }).join("")}
    </div>
  `;

  const tbody = $("#evidenceTable");
  if (!task.evidence.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">暂无审计记录</div></td></tr>`;
    return;
  }
  tbody.innerHTML = task.evidence
    .map(
      (item) => `
        <tr>
          <td class="mono">${escapeHtml(formatDate(item.at))}</td>
          <td>${escapeHtml(stepById(item.stepId)?.short || item.stepId)}</td>
          <td class="${item.type === "blocked" ? "bad" : "ok"}">${item.type === "blocked" ? "拦截" : item.type === "verified" ? "放行" : "记录"}</td>
          <td><b>${escapeHtml(item.title)}</b><br>${escapeHtml(item.detail)}</td>
          <td>${escapeHtml(item.actor)}</td>
        </tr>
      `,
    )
    .join("");
}

function agentReply(question) {
  const text = String(question || "").trim();
  const product = getProduct(task.targetModel);
  const current = activeStep(task);
  const blocked = task.blocked;
  let reply;
  let tools;

  if (/下一步|怎么做|继续/.test(text)) {
    if (taskComplete(task)) {
      reply = "本次换型已经完成。下一步可以导出证据包，或点击“开始下一批次”载入新工单。";
    } else if (blocked) {
      reply = `当前被拦截：${blocked.title}。${blocked.detail}\n先修正现场状态，再重新提交本步核验。`;
    } else if (!task.startedAt) {
      reply = "先在执行台点击“开始换型”，随后确认工单。系统会按步骤依次解锁。";
    } else {
      reply = `下一步：${current.title}。\n${current.description}\n达到标准后系统自动进入后续步骤。`;
    }
    tools = ["get_task_state", "get_active_step"];
  } else if (/为什么|拦截|卡住|错误/.test(text)) {
    reply = blocked
      ? `${blocked.title}\n${blocked.detail}\n控制策略：错误未修正前，后续步骤保持锁定。`
      : "当前没有拦截记录。关键治具、参数与物料每一步都会比对工单标准，错误时才会锁住下一步。";
    tools = ["get_task_state", "read_block_reason"];
  } else if (/治具|参数|扭力|物料|标准|BOM/.test(text)) {
    reply = `当前型号 ${product.code} 的放行标准：\n治具 ${product.fixtureId}\n设备扭力 ${product.torque.toFixed(2)} ± ${product.torqueTolerance.toFixed(2)} N·m\n物料 ${product.materialCode}\n首件间隙 ${product.gapMin.toFixed(2)}–${product.gapMax.toFixed(2)} mm\n首件扭力 ${product.firstTorqueMin.toFixed(2)}–${product.firstTorqueMax.toFixed(2)} N·m`;
    tools = ["lookup_product_standard", "get_task_state"];
  } else if (/证据|报告|导出|完整/.test(text)) {
    const missing = ["fixture", "torque", "material", "firstpiece"].filter((id) => !task.verified.includes(id));
    reply = taskComplete(task)
      ? `证据包已经封印，包含 ${task.evidence.length} 条审计记录，摘要 ${taskDigest(task)}。可以在证据链页面导出 JSON/CSV 或打印。`
      : `当前已有 ${task.evidence.length} 条记录。尚未完成的核验：${missing.length ? missing.map((id) => stepById(id).short).join("、") : "仅剩证据封印"}。`;
    tools = ["summarize_evidence", "list_missing_checks"];
  } else if (/风险|降低|效率/.test(text)) {
    reply = "降低换型风险优先处理三件事：第一，治具必须扫码而非目测；第二，参数读取设备当前值而不是沿用旧工艺卡；第三，首件未通过时不要放行。系统会把这些判断写成拦截记录。";
    tools = ["lookup_case_library", "summarize_controls"];
  } else if (/工单|型号|产品/.test(text)) {
    reply = `当前工单 ${task.workOrder}，产线 ${task.line}，目标型号 ${product.code} · ${product.name}。设备核验标准已按该型号生成。`;
    tools = ["get_work_order", "lookup_product_standard"];
  } else {
    reply = `我可以基于当前任务回答。当前状态：${taskComplete(task) ? "已完成" : blocked ? "已拦截" : task.startedAt ? "执行中" : "待开始"}，已完成 ${task.verified.length} / ${STEPS.length} 步。你可以问“下一步做什么”“为什么被拦截”或“当前核验标准”。`;
    tools = ["get_task_state"];
  }
  return { reply, tools };
}

function sendChat(question) {
  const text = String(question || "").trim();
  if (!text) return;
  chatMessages.push({ role: "user", text });
  const answer = agentReply(text);
  chatMessages.push({ role: "agent", text: answer.reply });
  toolTrace.unshift({
    name: answer.tools.join(" + "),
    detail: `回答：${truncate(text, 28)}`,
  });
  toolTrace = toolTrace.slice(0, 8);
  renderAgent();
}

function renderAgent() {
  $("#chatBody").innerHTML = chatMessages
    .map(
      (message) => `<div class="msg ${message.role}"><div class="bubble">${escapeHtml(message.text)}</div></div>`,
    )
    .join("");
  const body = $("#chatBody");
  body.scrollTop = body.scrollHeight;
  const latestTools = toolTrace.slice(0, 4);
  $("#toolTrace").innerHTML = latestTools
    .map(
      (tool, index) => `
        <div class="trace-item">
          <i>${String(index + 1).padStart(2, "0")}</i>
          <div><b>${escapeHtml(tool.name)}</b><span>${escapeHtml(tool.detail)}</span></div>
        </div>
      `,
    )
    .join("");
  renderAgentContext();
}

function renderAgentContext() {
  const product = getProduct(task.targetModel);
  $("#agentContext").innerHTML = `
    <div class="context-item"><span>工单</span><b>${escapeHtml(task.workOrder)}</b></div>
    <div class="context-item"><span>目标型号</span><b>${escapeHtml(product.code)}</b></div>
    <div class="context-item"><span>当前步骤</span><b>${escapeHtml(activeStep(task)?.short || "已完成")}</b></div>
    <div class="context-item"><span>已完成</span><b>${task.verified.length}/${STEPS.length}</b></div>
    <div class="context-item"><span>阻塞</span><b>${task.blocked ? "是" : "否"}</b></div>
    <div class="context-item"><span>审计记录</span><b>${task.evidence.length}</b></div>
  `;
}

function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJson() {
  downloadFile(
    `${task.workOrder}_换型证据包.json`,
    JSON.stringify(
      {
        ...task,
        digest: taskDigest(task),
        exportedAt: new Date().toISOString(),
        product: getProduct(task.targetModel),
      },
      null,
      2,
    ),
    "application/json;charset=utf-8",
  );
  notify("JSON证据包已导出");
}

function handleFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = String(reader.result || "");
      const isJson = file.name.toLowerCase().endsWith(".json") || text.trim().startsWith("[");
      const records = isJson ? JSON.parse(text) : parseCsv(text);
      batchRows = validateBatchRecords(records);
      renderBatchResults(file.name, records.length);
      $("#parseStatus").textContent = `已导入 ${file.name} · ${records.length} 条记录 · 本地校验完成`;
    } catch (error) {
      $("#parseStatus").textContent = `解析失败：${error.message}`;
      notify(`文件解析失败：${error.message}`, "bad");
    }
  };
  reader.readAsText(file, "utf-8");
}

function loadSampleBatch() {
  const records = [
    {
      workOrder: "WO-B-0209",
      targetModel: "B02",
      fixtureId: "J-B09",
      torque: 1.82,
      materialCode: "MAT-B-320",
      firstPieceGap: 0.44,
      firstPieceTorque: 1.79,
    },
    {
      workOrder: "WO-B-0210",
      targetModel: "B02",
      fixtureId: "J-A17",
      torque: 1.81,
      materialCode: "MAT-B-320",
      firstPieceGap: 0.45,
      firstPieceTorque: 1.78,
    },
    {
      workOrder: "WO-C-0316",
      targetModel: "C03",
      fixtureId: "J-C11",
      torque: 2.08,
      materialCode: "MAT-C-047",
      firstPieceGap: 0.49,
      firstPieceTorque: 2.12,
    },
    {
      workOrder: "WO-B-0211",
      targetModel: "B02",
      fixtureId: "J-B09",
      torque: 1.20,
      materialCode: "MAT-B-320",
      firstPieceGap: 0.46,
      firstPieceTorque: 1.80,
    },
  ];
  batchRows = validateBatchRecords(records);
  renderBatchResults("内置示例数据", records.length);
  $("#parseStatus").textContent = `已载入内置示例 · ${records.length} 条记录 · 本地校验完成`;
}

function renderBatchResults(source, count) {
  const pass = batchRows.filter((row) => row.status === "verified").length;
  const blocked = count - pass;
  const fixtureIssue = batchRows.filter((row) =>
    row.reasons.some((reason) => reason.startsWith("治具")),
  ).length;
  const parameterIssue = batchRows.filter((row) =>
    row.reasons.some((reason) => reason.startsWith("扭力") || reason.startsWith("首件扭力")),
  ).length;
  $("#batchResult").innerHTML = `
    <section class="panel">
      <div class="panel-hd">
        <div><h3>批量核验结果</h3><span>${escapeHtml(source)} · ${count} 条记录</span></div>
        <span class="panel-badge">${pass === count ? "全部通过" : "发现异常"}</span>
      </div>
      <div class="panel-bd">
        <div class="batch-summary">
          <div class="batch-stat"><b>${count}</b><span>采集记录</span></div>
          <div class="batch-stat"><b>${pass}</b><span>通过</span></div>
          <div class="batch-stat hot"><b>${blocked}</b><span>需拦截</span></div>
          <div class="batch-stat hot"><b>${fixtureIssue + parameterIssue}</b><span>关键字段异常</span></div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>工单</th><th>型号</th><th>治具</th><th>扭力</th><th>物料</th><th>首件</th><th>判定</th><th>异常原因</th></tr></thead>
            <tbody>
              ${batchRows.map((row) => `
                <tr>
                  <td class="mono">${escapeHtml(row.workOrder || "—")}</td>
                  <td>${escapeHtml(row.targetModel)}</td>
                  <td>${escapeHtml(row.fixtureId || "缺失")}</td>
                  <td class="mono">${Number.isFinite(row.torque) ? row.torque.toFixed(2) : "缺失"}</td>
                  <td>${escapeHtml(row.materialCode || "缺失")}</td>
                  <td class="mono">${Number.isFinite(row.firstPieceGap) ? row.firstPieceGap.toFixed(2) : "—"} / ${Number.isFinite(row.firstPieceTorque) ? row.firstPieceTorque.toFixed(2) : "—"}</td>
                  <td class="${row.status === "verified" ? "ok" : "bad"}">${row.status === "verified" ? "放行" : "拦截"}</td>
                  <td>${row.reasons.length ? escapeHtml(row.reasons.join("；")) : "—"}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

function initTabs() {
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => showView(tab.dataset.view));
  });
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-go-view]");
    if (target) showView(target.dataset.goView);
  });
  window.addEventListener("hashchange", () => {
    const name = window.location.hash.replace("#", "") || "overview";
    if ($(`#view-${name}`)) showView(name);
  });
}

function initOrderForm() {
  $("#orderForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const workOrder = $("#workOrderInput").value.trim() || "WO-B-0209";
    const line = $("#lineInput").value;
    const operator = $("#operatorInput").value.trim() || "操作员 03";
    task = createTask({ targetModel: selectedModel, workOrder, line, operator });
    task.evidence.unshift({
      id: `EV-${Date.now()}-LOAD`,
      at: new Date().toISOString(),
      type: "info",
      stepId: "order",
      title: "动态换型清单已生成",
      detail: `${workOrder} / ${selectedModel} / ${getProduct(selectedModel).fixtureId}`,
      actor: operator,
    });
    saveTask();
    renderAll();
    showView("execute");
    notify("工单已载入，动态换型清单已生成", "ok");
  });
  $("#loadDemoOrder").addEventListener("click", () => {
    $("#workOrderInput").value = "WO-B-0209";
    $("#lineInput").value = "L02";
    $("#operatorInput").value = "操作员 03";
    selectedModel = "B02";
    renderModelOptions();
    renderOrderResolution();
    notify("示例工单已填入，点击载入即可开始");
  });
  $("#resetTask").addEventListener("click", () => {
    task = resetProgress(task);
    saveTask();
    renderAll();
    notify("当前换型进度已重置");
  });
}

function initExecution() {
  $("#goExecute").addEventListener("click", () => showView("execute"));
  $("#exportJson").addEventListener("click", exportJson);
  $("#exportCsv").addEventListener("click", () => {
    downloadFile(
      `${task.workOrder}_换型证据包.csv`,
      evidenceToCsv(task),
      "text/csv;charset=utf-8",
    );
    notify("CSV证据记录已导出");
  });
  $("#printEvidence").addEventListener("click", () => {
    showView("evidence");
    setTimeout(() => window.print(), 80);
  });
}

function initAgent() {
  $("#chatForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("#chatInput");
    sendChat(input.value);
    input.value = "";
    input.style.height = "";
  });
  $("#chatInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      $("#chatForm").requestSubmit();
    }
  });
  $("#chatInput").addEventListener("input", (event) => {
    event.target.style.height = "auto";
    event.target.style.height = `${Math.min(110, event.target.scrollHeight)}px`;
  });
  $$("#chatQuick button").forEach((button) => {
    button.addEventListener("click", () => sendChat(button.dataset.question));
  });
}

function initFieldImport() {
  const dropzone = $("#dropzone");
  const input = $("#fileInput");
  dropzone.addEventListener("click", () => input.click());
  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.click();
    }
  });
  input.addEventListener("change", (event) => handleFile(event.target.files?.[0]));
  ["dragenter", "dragover"].forEach((name) => {
    dropzone.addEventListener(name, (event) => {
      event.preventDefault();
      dropzone.classList.add("over");
    });
  });
  ["dragleave", "drop"].forEach((name) => {
    dropzone.addEventListener(name, (event) => {
      event.preventDefault();
      dropzone.classList.remove("over");
    });
  });
  dropzone.addEventListener("drop", (event) => handleFile(event.dataTransfer.files?.[0]));
  $("#loadSampleBatch").addEventListener("click", (event) => {
    event.stopPropagation();
    loadSampleBatch();
  });
  $("#downloadTemplate").addEventListener("click", (event) => {
    event.stopPropagation();
    downloadFile(
      "换型现场核验模板.csv",
      "\uFEFFworkOrder,targetModel,fixtureId,torque,materialCode,firstPieceGap,firstPieceTorque\r\nWO-B-0209,B02,J-B09,1.80,MAT-B-320,0.44,1.79\r\n",
      "text/csv;charset=utf-8",
    );
    notify("CSV模板已下载");
  });
}

function initClock() {
  const update = () => {
    $("#clock").textContent = new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date());
    const elapsed = $("#topElapsed");
    if (elapsed) elapsed.textContent = elapsedText(task);
  };
  update();
  setInterval(update, 1000);
}

function init() {
  initTabs();
  initOrderForm();
  initExecution();
  initAgent();
  initFieldImport();
  initClock();
  renderAll();
  renderAgent();
  const initialView = window.location.hash.replace("#", "") || "overview";
  if ($(`#view-${initialView}`)) showView(initialView);
}

init();
