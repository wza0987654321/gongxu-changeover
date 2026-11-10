export const PRODUCTS = {
  A01: {
    code: "A01",
    name: "A01 基础型",
    fixtureId: "J-A17",
    fixtureName: "A型定位治具",
    torque: 1.2,
    torqueTolerance: 0.1,
    materialCode: "MAT-A-110",
    materialName: "A型底板与上盖",
    gapMin: 0.25,
    gapMax: 0.45,
    firstTorqueMin: 1.1,
    firstTorqueMax: 1.3,
    station: "ST-02",
  },
  B02: {
    code: "B02",
    name: "B02 高配型",
    fixtureId: "J-B09",
    fixtureName: "B型双孔定位治具",
    torque: 1.8,
    torqueTolerance: 0.1,
    materialCode: "MAT-B-320",
    materialName: "B型复合底板",
    gapMin: 0.35,
    gapMax: 0.55,
    firstTorqueMin: 1.7,
    firstTorqueMax: 1.9,
    station: "ST-02",
  },
  C03: {
    code: "C03",
    name: "C03 紧凑型",
    fixtureId: "J-C11",
    fixtureName: "C型窄边治具",
    torque: 2.2,
    torqueTolerance: 0.15,
    materialCode: "MAT-C-047",
    materialName: "C型增强底板",
    gapMin: 0.42,
    gapMax: 0.62,
    firstTorqueMin: 2.05,
    firstTorqueMax: 2.35,
    station: "ST-03",
  },
};

export const STEPS = [
  {
    id: "order",
    short: "读工单",
    title: "读取并确认换型工单",
    description: "确认目标型号、适用产线和本次需要变更的工位。",
    type: "confirm",
    evidenceLabel: "工单与目标型号已确认",
  },
  {
    id: "clear",
    short: "撤旧料",
    title: "清空A型旧料并完成区域隔离",
    description: "旧料清空与状态牌是两个独立动作，完成后才能切换治具。",
    type: "checklist",
    evidenceLabel: "A型旧料清空与隔离确认",
  },
  {
    id: "fixture",
    short: "换治具",
    title: "更换目标型号治具并扫码核验",
    description: "扫描治具二维码。编号不一致时，系统阻止下一步。",
    type: "scan",
    expectedKey: "fixtureId",
    evidenceLabel: "治具二维码核验",
  },
  {
    id: "torque",
    short: "调参数",
    title: "调整设备扭力并读取当前值",
    description: "输入设备面板当前读数。仅当读数落入目标公差范围才放行。",
    type: "number",
    expectedKey: "torque",
    evidenceLabel: "扭力参数核验",
  },
  {
    id: "material",
    short: "核物料",
    title: "扫描目标物料并比对工单BOM",
    description: "物料编码必须属于当前目标型号，错误的BOM会让首件整体失效。",
    type: "scan",
    expectedKey: "materialCode",
    evidenceLabel: "物料编码核验",
  },
  {
    id: "firstpiece",
    short: "首件检",
    title: "录入首件检测结果并留存照片",
    description: "首件间隙、扭力与照片必须同时满足要求。",
    type: "firstpiece",
    evidenceLabel: "首件检测与照片留存",
  },
  {
    id: "seal",
    short: "封证据",
    title: "生成换型证据包",
    description: "将输入、判定、整改与放行记录封装为可追溯报告。",
    type: "seal",
    evidenceLabel: "换型证据包封印",
  },
];

export function getProduct(code) {
  return PRODUCTS[code] ?? PRODUCTS.B02;
}

export function createTask({
  targetModel = "B02",
  workOrder = "WO-B-0209",
  line = "L02",
  operator = "操作员 03",
} = {}) {
  return {
    version: 1,
    taskId: `TASK-${Date.now().toString(36).toUpperCase()}`,
    workOrder,
    targetModel,
    line,
    operator,
    startedAt: null,
    finishedAt: null,
    stepIndex: 0,
    verified: [],
    blocked: null,
    firstPieceDraft: {
      gap: "",
      torque: "",
      photoName: "",
    },
    evidence: [
      event("info", "system", "任务已创建", `${workOrder} / ${targetModel}`, operator),
    ],
  };
}

export function event(type, stepId, title, detail, actor = "系统") {
  const now = new Date();
  return {
    id: `EV-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
    at: now.toISOString(),
    type,
    stepId,
    title,
    detail,
    actor,
  };
}

export function stepById(id) {
  return STEPS.find((step) => step.id === id);
}

export function activeStep(task) {
  if (!task) return STEPS[0];
  return STEPS[task.stepIndex] ?? null;
}

export function stepStatus(task, stepId) {
  if (!task) return "pending";
  if (task.blocked?.stepId === stepId) return "blocked";
  if (task.verified.includes(stepId)) return "done";
  if (!task.startedAt) return "pending";
  if (activeStep(task)?.id === stepId) return "active";
  return "pending";
}

export function markStarted(task) {
  if (!task.startedAt) {
    task.startedAt = new Date().toISOString();
    task.evidence.unshift(
      event(
        "info",
        "order",
        "换型开始",
        `${task.line} / ${task.targetModel} 动态换型清单已启用`,
        task.operator,
      ),
    );
  }
  return task;
}

export function verifyFixture(task, scanValue) {
  const expected = getProduct(task.targetModel);
  const value = String(scanValue || "").trim().toUpperCase();
  if (!value) {
    return fail(task, "fixture", "未读取到治具二维码", "请输入或使用扫码枪读取治具编号");
  }
  if (value !== expected.fixtureId) {
    return fail(
      task,
      "fixture",
      "治具型号不匹配",
      `扫描值 ${value}，目标要求 ${expected.fixtureId}。系统已锁定后续步骤。`,
      { expected: expected.fixtureId, actual: value },
    );
  }
  return pass(
    task,
    "fixture",
    "治具核验通过",
    `${value} 与 ${expected.fixtureName} 一致`,
    { expected: expected.fixtureId, actual: value },
  );
}

export function verifyTorque(task, torqueValue) {
  const expected = getProduct(task.targetModel);
  const actual = Number(torqueValue);
  const min = expected.torque - expected.torqueTolerance;
  const max = expected.torque + expected.torqueTolerance;
  if (!Number.isFinite(actual)) {
    return fail(task, "torque", "扭力读数无效", "请输入设备面板上的当前扭力值");
  }
  if (actual < min || actual > max) {
    return fail(
      task,
      "torque",
      "扭力参数超出公差",
      `当前 ${actual.toFixed(2)} N·m，目标 ${expected.torque.toFixed(2)} N·m，允许 ${min.toFixed(2)}–${max.toFixed(2)} N·m。`,
      { expected: `${min.toFixed(2)}–${max.toFixed(2)}`, actual },
    );
  }
  return pass(
    task,
    "torque",
    "扭力参数核验通过",
    `${actual.toFixed(2)} N·m 位于 ${min.toFixed(2)}–${max.toFixed(2)} N·m 范围内`,
    { expected: `${min.toFixed(2)}–${max.toFixed(2)}`, actual },
  );
}

export function verifyMaterial(task, materialValue) {
  const expected = getProduct(task.targetModel);
  const value = String(materialValue || "").trim().toUpperCase();
  if (!value) {
    return fail(task, "material", "未读取到物料编码", "请输入或使用扫码枪读取物料二维码");
  }
  if (value !== expected.materialCode) {
    return fail(
      task,
      "material",
      "物料与目标BOM不一致",
      `扫描值 ${value}，目标要求 ${expected.materialCode}。请隔离混料并复核。`,
      { expected: expected.materialCode, actual: value },
    );
  }
  return pass(
    task,
    "material",
    "物料核验通过",
    `${value} 与 ${expected.materialName} 一致`,
    { expected: expected.materialCode, actual: value },
  );
}

export function verifyFirstPiece(task, { gap, torque, photoName }) {
  const expected = getProduct(task.targetModel);
  const gapValue = Number(gap);
  const torqueValue = Number(torque);
  const reasons = [];
  if (!Number.isFinite(gapValue) || gapValue < expected.gapMin || gapValue > expected.gapMax) {
    reasons.push(`间隙应为 ${expected.gapMin.toFixed(2)}–${expected.gapMax.toFixed(2)} mm`);
  }
  if (
    !Number.isFinite(torqueValue) ||
    torqueValue < expected.firstTorqueMin ||
    torqueValue > expected.firstTorqueMax
  ) {
    reasons.push(
      `首件扭力应为 ${expected.firstTorqueMin.toFixed(2)}–${expected.firstTorqueMax.toFixed(2)} N·m`,
    );
  }
  if (!photoName) {
    reasons.push("缺少首件照片证据");
  }
  if (reasons.length) {
    return fail(
      task,
      "firstpiece",
      "首件检查未通过",
      reasons.join("；"),
      { expected, actual: { gap, torque, photoName: photoName || "" } },
    );
  }
  return pass(
    task,
    "firstpiece",
    "首件检查通过",
    `间隙 ${gapValue.toFixed(2)} mm，扭力 ${torqueValue.toFixed(2)} N·m，照片已留存`,
    { expected, actual: { gap: gapValue, torque: torqueValue, photoName } },
  );
}

export function confirmStep(task, stepId, detail, data = {}) {
  return pass(task, stepId, stepById(stepId)?.evidenceLabel ?? "步骤确认", detail, data);
}

export function sealEvidence(task) {
  if (task.verified.length !== STEPS.length - 1) {
    return fail(
      task,
      "seal",
      "证据包尚不完整",
      `已完成 ${task.verified.length} / ${STEPS.length} 步，无法封印。`,
    );
  }
  const result = pass(
    task,
    "seal",
    "换型证据包已生成",
    `共 ${task.evidence.length + 1} 条审计记录，可追溯至每一步输入与判定。`,
    { digest: taskDigest(task) },
  );
  if (result.ok) {
    task.finishedAt = new Date().toISOString();
  }
  return result;
}

export function clearBlock(task) {
  task.blocked = null;
}

export function resetProgress(task) {
  task.startedAt = null;
  task.finishedAt = null;
  task.stepIndex = 0;
  task.verified = [];
  task.blocked = null;
  task.firstPieceDraft = { gap: "", torque: "", photoName: "" };
  task.evidence = [
    event("info", "system", "任务已重置", `${task.workOrder} / ${task.targetModel}`, task.operator),
  ];
  return task;
}

function fail(task, stepId, title, detail, data = {}) {
  task.blocked = {
    stepId,
    title,
    detail,
    at: new Date().toISOString(),
  };
  task.evidence.unshift(
    event("blocked", stepId, title, detail, task.operator),
  );
  return { ok: false, blocked: task.blocked, data };
}

function pass(task, stepId, title, detail, data = {}) {
  task.blocked = null;
  if (!task.verified.includes(stepId)) {
    task.verified.push(stepId);
  }
  const currentIndex = STEPS.findIndex((step) => step.id === stepId);
  task.stepIndex = Math.max(task.stepIndex, Math.min(STEPS.length - 1, currentIndex + 1));
  task.evidence.unshift(
    event("verified", stepId, title, detail, task.operator),
  );
  return { ok: true, data };
}

export function taskComplete(task) {
  return Boolean(task?.finishedAt);
}

export function taskDigest(task) {
  const source = JSON.stringify({
    workOrder: task.workOrder,
    targetModel: task.targetModel,
    verified: task.verified,
    evidence: task.evidence.map(({ id, type, stepId, title, at }) => ({
      id,
      type,
      stepId,
      title,
      at,
    })),
  });
  return hashString(source).padEnd(16, "0").slice(0, 16).toUpperCase();
}

export function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function parseCsv(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error("CSV至少需要表头和一行数据");
  }
  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line, index) => {
    const values = splitCsvLine(line);
    if (values.length !== headers.length) {
      throw new Error(`CSV第 ${index + 2} 行字段数与表头不一致`);
    }
    return Object.fromEntries(headers.map((header, i) => [header, values[i].trim()]));
  });
}

function splitCsvLine(line) {
  const output = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      output.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  output.push(value);
  return output;
}

export function normalizeBatchRecords(records) {
  if (!Array.isArray(records)) {
    throw new Error("JSON数据必须是数组");
  }
  return records.map((record, index) => ({
    index: index + 1,
    workOrder: String(record.workOrder || record["工单"] || "").trim(),
    targetModel: String(record.targetModel || record["目标型号"] || "B02").trim(),
    fixtureId: String(record.fixtureId || record["治具编号"] || "").trim(),
    torque: Number(record.torque ?? record["扭力"]),
    materialCode: String(record.materialCode || record["物料编码"] || "").trim(),
    firstPieceGap: Number(record.firstPieceGap ?? record["首件间隙"]),
    firstPieceTorque: Number(record.firstPieceTorque ?? record["首件扭力"]),
  }));
}

export function validateBatchRecords(records) {
  const normalized = normalizeBatchRecords(records);
  return normalized.map((record) => {
    const expected = getProduct(record.targetModel);
    const reasons = [];
    if (record.fixtureId.toUpperCase() !== expected.fixtureId) {
      reasons.push(
        `治具应为 ${expected.fixtureId}，实际 ${record.fixtureId || "缺失"}`,
      );
    }
    if (
      !Number.isFinite(record.torque) ||
      Math.abs(record.torque - expected.torque) > expected.torqueTolerance
    ) {
      reasons.push(
        `扭力应为 ${(expected.torque - expected.torqueTolerance).toFixed(2)}–${(expected.torque + expected.torqueTolerance).toFixed(2)} N·m`,
      );
    }
    if (record.materialCode.toUpperCase() !== expected.materialCode) {
      reasons.push(
        `物料应为 ${expected.materialCode}，实际 ${record.materialCode || "缺失"}`,
      );
    }
    if (
      !Number.isFinite(record.firstPieceGap) ||
      record.firstPieceGap < expected.gapMin ||
      record.firstPieceGap > expected.gapMax
    ) {
      reasons.push(`首件间隙应为 ${expected.gapMin}–${expected.gapMax} mm`);
    }
    if (
      !Number.isFinite(record.firstPieceTorque) ||
      record.firstPieceTorque < expected.firstTorqueMin ||
      record.firstPieceTorque > expected.firstTorqueMax
    ) {
      reasons.push(
        `首件扭力应为 ${expected.firstTorqueMin.toFixed(2)}–${expected.firstTorqueMax.toFixed(2)} N·m`,
      );
    }
    return {
      ...record,
      expected,
      status: reasons.length ? "blocked" : "verified",
      reasons,
    };
  });
}

export function evidenceToCsv(task) {
  const rows = [
    ["时间", "步骤", "类型", "证据内容", "操作人"],
    ...task.evidence.map((item) => [
      formatDate(item.at),
      item.stepId,
      item.type,
      `${item.title}：${item.detail}`,
      item.actor,
    ]),
  ];
  return `\uFEFF${rows
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")}`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export function formatDate(value) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function elapsedText(task) {
  if (!task?.startedAt) return "00:00";
  const end = task.finishedAt ? new Date(task.finishedAt) : new Date();
  const seconds = Math.max(0, Math.floor((end - new Date(task.startedAt)) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
