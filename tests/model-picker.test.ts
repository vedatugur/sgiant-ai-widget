import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// The BUILT module, like the other logic tests: the source imports its
// siblings without extensions, which node's own TypeScript loading refuses.
import {
  groupModels,
  initialModel,
  type ModelOption,
} from "../dist/model-picker.js";
import { WIDGET_LABELS } from "../dist/labels.js";
import {
  WIDGET_CONDITIONAL_TARGETS,
  WIDGET_TARGETS,
} from "../dist/widget-manifest.js";

/**
 * THE MODEL PICKER SENDS WHAT THE PERSON CHOSE, FROM A LIST THE HOST OWNS
 * (sgiant-platform#465).
 *
 * The widget must never know which models exist: the host passes them as data,
 * and a second vendor is a longer list, not a widget release. These pin the two
 * things that make that safe (a retired model is never sent, and vendors sit
 * apart without any vendor-specific code) and the wiring that sends the choice.
 */

const CLAUDE: ModelOption[] = [
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", cost: "1×" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", cost: "2×" },
  { id: "claude-opus-5-5", label: "Opus 5.5", cost: "4×" },
];

test("the remembered choice wins, but only while the host still offers it", () => {
  assert.equal(
    initialModel(CLAUDE, "claude-opus-5-5", "claude-sonnet-5-5"),
    "claude-opus-5-5"
  );
  // Retired since last visit: never sent again; the host's default instead.
  assert.equal(
    initialModel(CLAUDE, "claude-opus-4-8", "claude-sonnet-5-5"),
    "claude-sonnet-5-5"
  );
  // No memory, no usable default: the first option.
  assert.equal(
    initialModel(CLAUDE, null, "gpt-nope"),
    "claude-haiku-4-5-20251001"
  );
  assert.equal(initialModel([], "x", "y"), null);
});

test("a second vendor is a longer list: grouped, in the host's order", () => {
  const mixed: ModelOption[] = [
    { id: "claude-sonnet-5-5", label: "Sonnet 5.5", group: "Anthropic" },
    { id: "gpt-x", label: "GPT X", group: "OpenAI" },
    { id: "claude-opus-5-5", label: "Opus 5.5", group: "Anthropic" },
  ];
  assert.deepEqual(
    groupModels(mixed).map((g) => [g.group, g.options.map((o) => o.id)]),
    [
      ["Anthropic", ["claude-sonnet-5-5", "claude-opus-5-5"]],
      ["OpenAI", ["gpt-x"]],
    ]
  );
  // One vendor, no groups: one group with no heading.
  assert.deepEqual(
    groupModels(CLAUDE).map((g) => g.group),
    [null]
  );
});

test("the module has no idea which vendors exist", () => {
  const src = readFileSync("src/model-picker.ts", "utf8").replace(
    /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
    ""
  );
  assert.doesNotMatch(src, /claude|anthropic|openai|gemini|gpt/i);
});

test("the chosen id rides every turn, after extraBody, and only when there is a picker", () => {
  const src = readFileSync("src/index.ts", "utf8");
  assert.match(
    src,
    /\.\.\.\(opts\.extraBody \?\? \{\}\),\s*\.\.\.\(picker \? \{ model: picker\.value\(\) \} : \{\}\),/
  );
  // No picker unless the host passed models.
  assert.match(src, /const picker =\s*opts\.models\?\.length && firstModel/);
  // Remembered per layout scope, and validated against the list on mount.
  assert.match(src, /const modelKey = layoutScope \? `\$\{ns\}:model:\$\{layoutScope\}` : null;/);
  assert.match(src, /initialModel\(opts\.models, readItem\(modelKey\), opts\.defaultModel\)/);
  assert.match(src, /opts\.onModelChange\?\.\(id\)/);
});

test("the pill is a declared, conditional control, with words for its chrome", () => {
  const src = readFileSync("src/index.ts", "utf8");
  assert.match(
    src,
    /picker\.button\.setAttribute\("data-ai-target", WIDGET_TARGETS\.model\)/
  );
  assert.ok(WIDGET_CONDITIONAL_TARGETS.includes(WIDGET_TARGETS.model));
  assert.ok(WIDGET_LABELS.modelPicker);
  assert.match(WIDGET_LABELS.modelPickerAria, /\{model\}/);
});
