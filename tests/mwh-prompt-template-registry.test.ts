import { describe, expect, it } from "vitest";
import {
  choosePromptTemplate,
  createPromptTemplate,
  disablePromptTemplate,
  extractPromptVariables,
  previewPromptTemplate,
  publishPromptTemplate,
  renderPromptTemplate,
  validatePromptVariables,
} from "../src/mwh/modules/ai-infra/prompt-template-registry/core.js";
import { MemoryPromptTemplateRegistry } from "../src/mwh/modules/ai-infra/prompt-template-registry/memory-registry.js";

describe("MWH prompt-template-registry middleware", () => {
  it("extracts variables and creates templates", () => {
    expect(extractPromptVariables("Hello {{ name }} from {{project_1}} and {{name}}")).toEqual([
      "name",
      "project_1",
    ]);
    const template = createPromptTemplate({
      id: "review",
      version: 1,
      name: "Review",
      template: "Review {{file}} for {{audience}}.",
      nowMs: 1_000,
      metadata: { owner: "ai" },
    });

    expect(template).toEqual(
      expect.objectContaining({
        id: "review",
        version: 1,
        variables: ["audience", "file"],
        status: "draft",
      }),
    );
  });

  it("validates variables and previews drafts without requiring publication", () => {
    const draft = createPromptTemplate({
      id: "review",
      version: 1,
      name: "Review",
      template: "Review {{file}} for {{audience}}.",
      nowMs: 1_000,
    });

    expect(validatePromptVariables(draft, { file: "src/app.ts", secret: "drop" })).toEqual({
      valid: false,
      required: ["audience", "file"],
      missing: ["audience"],
      extra: ["secret"],
    });
    expect(
      previewPromptTemplate(draft, {
        variables: { file: "src/app.ts", audience: "maintainers", secret: "drop" },
        nowMs: 1_100,
      }),
    ).toEqual({
      templateId: "review",
      version: 1,
      rendered: "Review src/app.ts for maintainers.",
      variables: { audience: "maintainers", file: "src/app.ts" },
      renderedAtMs: 1_100,
    });
  });

  it("publishes, disables, selects versions, and renders published templates", () => {
    const draft = createPromptTemplate({
      id: "review",
      version: 1,
      name: "Review",
      template: "Review {{file}} for {{audience}}.",
      nowMs: 1_000,
    });
    const published = publishPromptTemplate(draft, { nowMs: 1_100 });
    const newer = publishPromptTemplate({ ...draft, version: 2 }, { nowMs: 1_200 });

    expect(choosePromptTemplate([published, newer], { id: "review" })?.version).toBe(2);
    expect(disablePromptTemplate(newer, { nowMs: 1_300 }).status).toBe("disabled");
    expect(() =>
      renderPromptTemplate(draft, {
        variables: { file: "src/app.ts", audience: "maintainers" },
        nowMs: 1_400,
      }),
    ).toThrow("template must be published");
    expect(() =>
      renderPromptTemplate(published, {
        variables: { file: "src/app.ts" },
        nowMs: 1_400,
      }),
    ).toThrow("missing prompt variables: audience");
    expect(
      renderPromptTemplate(published, {
        variables: { file: "src/app.ts", audience: "maintainers", secret: "drop" },
        nowMs: 1_400,
      }),
    ).toEqual({
      templateId: "review",
      version: 1,
      rendered: "Review src/app.ts for maintainers.",
      variables: { audience: "maintainers", file: "src/app.ts" },
      renderedAtMs: 1_400,
    });
  });

  it("runs stateful create, version, publish, render, audit, disable, latest, and clone-safe flows", () => {
    let now = 1_000;
    const registry = new MemoryPromptTemplateRegistry({ now: () => now });
    const first = registry.create({
      id: "review",
      name: "Review",
      template: "Review {{file}}.",
    });
    now = 1_100;
    const second = registry.create({
      id: "review",
      name: "Review",
      template: "Review {{file}} for {{audience}}.",
    });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(() =>
      registry.render({ id: "review", version: 2, variables: { file: "a.ts", audience: "dev" } }),
    ).toThrow("prompt template not found");
    expect(
      registry.validate({
        id: "review",
        version: 2,
        variables: { file: "a.ts", secret: "drop" },
      }),
    ).toEqual({
      valid: false,
      required: ["audience", "file"],
      missing: ["audience"],
      extra: ["secret"],
    });
    expect(
      registry.preview({
        id: "review",
        version: 2,
        variables: { file: "a.ts", audience: "dev", secret: "drop" },
      }),
    ).toEqual(
      expect.objectContaining({
        rendered: "Review a.ts for dev.",
        variables: { audience: "dev", file: "a.ts" },
      }),
    );
    expect(registry.audit()).toEqual([]);

    now = 1_200;
    registry.publish("review", 1);
    now = 1_300;
    registry.publish("review", 2);
    const rendered = registry.render({
      id: "review",
      variables: { file: "src/app.ts", audience: "maintainers" },
    });
    expect(rendered.rendered).toBe("Review src/app.ts for maintainers.");
    expect(registry.audit()).toEqual([
      expect.objectContaining({ templateId: "review", version: 2 }),
    ]);

    registry.disable("review", 2);
    expect(registry.render({ id: "review", variables: { file: "src/app.ts" } }).version).toBe(1);

    const read = registry.get("review", 1)!;
    (read.variables as string[]).push("mutated");
    expect(registry.get("review", 1)?.variables).toEqual(["file"]);
    expect(registry.list("review").map((template) => template.version)).toEqual([2, 1]);
  });
});
