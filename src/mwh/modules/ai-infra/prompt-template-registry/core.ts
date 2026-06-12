export type PromptTemplateStatus = "draft" | "published" | "disabled";

export interface PromptTemplate {
  id: string;
  version: number;
  name: string;
  template: string;
  variables: readonly string[];
  status: PromptTemplateStatus;
  createdAtMs: number;
  updatedAtMs: number;
  metadata?: Record<string, string>;
}

export interface PromptRenderRecord {
  templateId: string;
  version: number;
  rendered: string;
  variables: Record<string, string>;
  renderedAtMs: number;
}

export interface PromptVariableValidation {
  valid: boolean;
  required: readonly string[];
  missing: readonly string[];
  extra: readonly string[];
}

export function extractPromptVariables(template: string): string[] {
  assertNonEmpty(template, "template");
  const variables = new Set<string>();
  for (const match of template.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)) {
    variables.add(match[1]!);
  }
  return [...variables].sort();
}

export function createPromptTemplate(input: {
  id: string;
  version: number;
  name: string;
  template: string;
  nowMs: number;
  status?: PromptTemplateStatus;
  metadata?: Record<string, string>;
}): PromptTemplate {
  assertNonEmpty(input.id, "id");
  assertPositiveInteger(input.version, "version");
  assertNonEmpty(input.name, "name");
  assertNonEmpty(input.template, "template");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const variables = extractPromptVariables(input.template);
  return {
    id: input.id,
    version: input.version,
    name: input.name,
    template: input.template,
    variables,
    status: input.status ?? "draft",
    createdAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
    metadata: input.metadata ? { ...input.metadata } : undefined,
  };
}

export function validatePromptVariables(
  template: PromptTemplate,
  variables: Record<string, string>,
): PromptVariableValidation {
  const required = [...template.variables];
  const requiredSet = new Set(required);
  const missing = required.filter((variable) => variables[variable] === undefined);
  const extra = Object.keys(variables)
    .filter((variable) => !requiredSet.has(variable))
    .sort();
  return {
    valid: missing.length === 0,
    required,
    missing,
    extra,
  };
}

export function publishPromptTemplate(
  template: PromptTemplate,
  input: { nowMs: number },
): PromptTemplate {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  return { ...clonePromptTemplate(template), status: "published", updatedAtMs: input.nowMs };
}

export function disablePromptTemplate(
  template: PromptTemplate,
  input: { nowMs: number },
): PromptTemplate {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  return { ...clonePromptTemplate(template), status: "disabled", updatedAtMs: input.nowMs };
}

export function choosePromptTemplate(
  templates: readonly PromptTemplate[],
  input: { id: string; version?: number; includeDrafts?: boolean },
): PromptTemplate | undefined {
  assertNonEmpty(input.id, "id");
  return templates
    .filter((template) => template.id === input.id)
    .filter((template) => input.version === undefined || template.version === input.version)
    .filter((template) => template.status !== "disabled")
    .filter((template) => input.includeDrafts || template.status === "published")
    .sort((left, right) => right.version - left.version)[0];
}

export function renderPromptTemplate(
  template: PromptTemplate,
  input: { variables: Record<string, string>; nowMs: number },
): PromptRenderRecord {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (template.status !== "published") throw new Error("template must be published before render");
  const validation = validatePromptVariables(template, input.variables);
  const missing = validation.missing;
  if (missing.length > 0) throw new Error(`missing prompt variables: ${missing.join(", ")}`);
  return {
    templateId: template.id,
    version: template.version,
    rendered: renderPromptText(template, input.variables),
    variables: pickPromptVariables(template, input.variables),
    renderedAtMs: input.nowMs,
  };
}

export function previewPromptTemplate(
  template: PromptTemplate,
  input: { variables: Record<string, string>; nowMs: number },
): PromptRenderRecord {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const validation = validatePromptVariables(template, input.variables);
  if (validation.missing.length > 0) {
    throw new Error(`missing prompt variables: ${validation.missing.join(", ")}`);
  }
  return {
    templateId: template.id,
    version: template.version,
    rendered: renderPromptText(template, input.variables),
    variables: pickPromptVariables(template, input.variables),
    renderedAtMs: input.nowMs,
  };
}

export function clonePromptTemplate(template: PromptTemplate): PromptTemplate {
  return {
    ...template,
    variables: [...template.variables],
    metadata: template.metadata ? { ...template.metadata } : undefined,
  };
}

export function clonePromptRenderRecord(record: PromptRenderRecord): PromptRenderRecord {
  return {
    ...record,
    variables: { ...record.variables },
  };
}

function renderPromptText(template: PromptTemplate, variables: Record<string, string>): string {
  return template.template.replace(
    /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
    (_match, variable: string) => variables[variable] ?? "",
  );
}

function pickPromptVariables(
  template: PromptTemplate,
  variables: Record<string, string>,
): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const variable of template.variables) {
    if (variables[variable] !== undefined) picked[variable] = variables[variable]!;
  }
  return picked;
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer`);
}
