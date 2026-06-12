import {
  type PromptRenderRecord,
  type PromptTemplate,
  choosePromptTemplate,
  clonePromptRenderRecord,
  clonePromptTemplate,
  createPromptTemplate,
  disablePromptTemplate,
  previewPromptTemplate,
  publishPromptTemplate,
  renderPromptTemplate,
  validatePromptVariables,
} from "./core.js";

export class MemoryPromptTemplateRegistry {
  private readonly now: () => number;
  private readonly templates = new Map<string, PromptTemplate[]>();
  private readonly renders: PromptRenderRecord[] = [];

  constructor(input: { now?: () => number } = {}) {
    this.now = input.now ?? Date.now;
  }

  create(input: {
    id: string;
    name: string;
    template: string;
    metadata?: Record<string, string>;
  }): PromptTemplate {
    const version = (this.templates.get(input.id)?.at(-1)?.version ?? 0) + 1;
    const template = createPromptTemplate({
      ...input,
      version,
      nowMs: this.now(),
    });
    this.templatesFor(input.id).push(template);
    return clonePromptTemplate(template);
  }

  publish(id: string, version?: number): PromptTemplate {
    const template = this.mustChoose(id, version, true);
    const next = publishPromptTemplate(template, { nowMs: this.now() });
    this.replace(next);
    return clonePromptTemplate(next);
  }

  disable(id: string, version?: number): PromptTemplate {
    const template = this.mustChoose(id, version, true);
    const next = disablePromptTemplate(template, { nowMs: this.now() });
    this.replace(next);
    return clonePromptTemplate(next);
  }

  render(input: {
    id: string;
    version?: number;
    variables: Record<string, string>;
  }): PromptRenderRecord {
    const template = this.mustChoose(input.id, input.version, false);
    const record = renderPromptTemplate(template, {
      variables: input.variables,
      nowMs: this.now(),
    });
    this.renders.push(record);
    return clonePromptRenderRecord(record);
  }

  preview(input: {
    id: string;
    version?: number;
    variables: Record<string, string>;
  }): PromptRenderRecord {
    const template = this.mustChoose(input.id, input.version, true);
    return clonePromptRenderRecord(
      previewPromptTemplate(template, {
        variables: input.variables,
        nowMs: this.now(),
      }),
    );
  }

  validate(input: {
    id: string;
    version?: number;
    variables: Record<string, string>;
    includeDrafts?: boolean;
  }): ReturnType<typeof validatePromptVariables> {
    const template = this.mustChoose(input.id, input.version, input.includeDrafts ?? true);
    return validatePromptVariables(template, input.variables);
  }

  get(id: string, version?: number): PromptTemplate | undefined {
    const template = choosePromptTemplate(this.templates.get(id) ?? [], {
      id,
      version,
      includeDrafts: true,
    });
    return template ? clonePromptTemplate(template) : undefined;
  }

  list(id?: string): PromptTemplate[] {
    const source = id ? (this.templates.get(id) ?? []) : [...this.templates.values()].flat();
    return source
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id) || right.version - left.version)
      .map(clonePromptTemplate);
  }

  audit(): PromptRenderRecord[] {
    return this.renders.map(clonePromptRenderRecord);
  }

  private templatesFor(id: string): PromptTemplate[] {
    const existing = this.templates.get(id);
    if (existing) return existing;
    const created: PromptTemplate[] = [];
    this.templates.set(id, created);
    return created;
  }

  private mustChoose(
    id: string,
    version: number | undefined,
    includeDrafts: boolean,
  ): PromptTemplate {
    const template = choosePromptTemplate(this.templates.get(id) ?? [], {
      id,
      version,
      includeDrafts,
    });
    if (!template) throw new Error("prompt template not found");
    return template;
  }

  private replace(template: PromptTemplate): void {
    const versions = this.templatesFor(template.id);
    const index = versions.findIndex((item) => item.version === template.version);
    if (index < 0) throw new Error("prompt template not found");
    versions[index] = template;
  }
}
