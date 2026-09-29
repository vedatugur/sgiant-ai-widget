/**
 * THE MODEL PICKER (sgiant-platform#465).
 *
 * The widget knows nothing about models. It does not know which ones exist,
 * which company serves them or what they cost, and it must never learn: the
 * HOST passes the options, normally straight from its own server, and the
 * widget shows them, remembers the person's choice and sends the chosen `id`
 * as `model` with every turn. Offering another vendor's models later is a
 * server change and a longer list here — `group` is how they sit apart
 * ("Anthropic", "OpenAI", …) — never a widget release.
 *
 * Its own module, like storage.ts: the choice logic is pure and tested without
 * a DOM, and index.ts only places the control and reads its value.
 */
import { PREFIX } from "./prefix";
import { el } from "./dom";
import { ICON_CHEV_D } from "./icons";

/** One model the person may pick. Plain data from the host. */
export interface ModelOption {
  /** Sent as `model` with every turn. Opaque to the widget. */
  id: string;
  /** What the person sees, e.g. "Sonnet 5.5". */
  label: string;
  /** One short line under the label, e.g. "Fast and capable". */
  hint?: string;
  /** The heading the option is listed under, typically the vendor. Options
   *  that share a group are shown together, in the order the host gave them. */
  group?: string;
  /** A short relative-cost tag beside the label, e.g. "1×" or "4×", so the
   *  person can see that a stronger model spends more of their credits. */
  cost?: string;
}

/**
 * The model to start with: the one this person chose last time IF the host
 * still offers it — a model since retired must never be sent — else the
 * host's default if it offers that, else the first option. Null only when
 * there is nothing to choose from.
 */
export function initialModel(
  options: readonly ModelOption[],
  remembered: string | null | undefined,
  fallback: string | undefined
): string | null {
  const offered = (id: string | null | undefined): id is string =>
    Boolean(id) && options.some((o) => o.id === id);
  if (offered(remembered)) return remembered;
  if (offered(fallback)) return fallback;
  return options[0]?.id ?? null;
}

/**
 * The options as the menu lists them: each group where its first option stood,
 * options in the host's order inside it. Options without a group form one
 * group with no heading, so a single-vendor list shows no heading at all.
 */
export function groupModels(
  options: readonly ModelOption[]
): Array<{ group: string | null; options: ModelOption[] }> {
  const groups: Array<{ group: string | null; options: ModelOption[] }> = [];
  for (const option of options) {
    const key = option.group?.trim() || null;
    let bucket = groups.find((g) => g.group === key);
    if (!bucket) {
      bucket = { group: key, options: [] };
      groups.push(bucket);
    }
    bucket.options.push(option);
  }
  return groups;
}

export interface ModelPicker {
  /** The pill and its menu, placed in the composer row by the caller. */
  root: HTMLElement;
  /** The pill: the control the widget manifest names. */
  button: HTMLButtonElement;
  /** The id of the chosen option. */
  value(): string;
  isOpen(): boolean;
  setOpen(open: boolean): void;
}

/**
 * The pill and its menu. DOM only: remembering the choice and sending it are
 * the caller's, told of every change through `onChange`.
 *
 * The menu opens UPWARD, because the pill sits in the composer at the bottom
 * of the panel, and it is a radio menu (`menuitemradio` + `aria-checked`), so
 * a screen reader announces which model is chosen rather than a row of
 * buttons.
 */
export function createModelPicker(input: {
  options: readonly ModelOption[];
  selected: string;
  /** Resolved strings, from the widget's own `L()`: the menu heading, and the
   *  pill's accessible name for a given model label. */
  heading: string;
  ariaLabel: (modelLabel: string) => string;
  onChange: (id: string) => void;
}): ModelPicker {
  let selected = input.selected;
  let open = false;
  const labelOf = (id: string): string =>
    input.options.find((o) => o.id === id)?.label ?? id;

  const root = el("div", `${PREFIX}-model`);
  const button = el("button", `${PREFIX}-model-btn`) as HTMLButtonElement;
  button.type = "button";
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  const name = el("span", `${PREFIX}-model-name`);
  const chevron = el("span", `${PREFIX}-model-chev`);
  chevron.innerHTML = ICON_CHEV_D;
  button.append(name, chevron);

  const menu = el("div", `${PREFIX}-menu ${PREFIX}-model-menu`);
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", input.heading);
  const heading = el("div", `${PREFIX}-model-heading`);
  heading.textContent = input.heading;
  heading.setAttribute("aria-hidden", "true");
  menu.append(heading);

  const items: HTMLButtonElement[] = [];
  for (const { group, options } of groupModels(input.options)) {
    if (group) {
      const g = el("div", `${PREFIX}-model-group`);
      g.textContent = group;
      g.setAttribute("aria-hidden", "true");
      menu.append(g);
    }
    for (const option of options) {
      const item = el(
        "button",
        `${PREFIX}-menu-item ${PREFIX}-model-item`
      ) as HTMLButtonElement;
      item.type = "button";
      item.setAttribute("role", "menuitemradio");
      item.dataset.modelId = option.id;
      const text = el("span", `${PREFIX}-model-text`);
      const label = el("span", `${PREFIX}-menu-label`);
      label.textContent = option.label;
      text.append(label);
      if (option.hint) {
        const hint = el("span", `${PREFIX}-model-hint`);
        hint.textContent = option.hint;
        text.append(hint);
      }
      item.append(text);
      if (option.cost) {
        const cost = el("span", `${PREFIX}-model-cost`);
        cost.textContent = option.cost;
        item.append(cost);
      }
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        choose(option.id);
        setOpen(false);
        button.focus();
      });
      items.push(item);
      menu.append(item);
    }
  }
  root.append(button, menu);

  const paint = (): void => {
    const label = labelOf(selected);
    name.textContent = label;
    button.title = input.ariaLabel(label);
    button.setAttribute("aria-label", input.ariaLabel(label));
    for (const item of items) {
      item.setAttribute(
        "aria-checked",
        item.dataset.modelId === selected ? "true" : "false"
      );
    }
  };

  const choose = (id: string): void => {
    if (id === selected) return;
    selected = id;
    paint();
    input.onChange(id);
  };

  // Class, not `display`, for the same reason as the More menu (#309): the
  // menu transitions, and `display` is not animatable.
  const setOpen = (next: boolean): void => {
    open = next;
    menu.classList.toggle(`${PREFIX}-menu-open`, next);
    button.setAttribute("aria-expanded", next ? "true" : "false");
    if (next) {
      const current =
        items.find((i) => i.dataset.modelId === selected) ?? items[0];
      current?.focus();
    }
  };

  button.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(!open);
  });
  // Arrow keys move between models and Escape closes, as a menu should; Enter
  // and Space already click the focused row.
  menu.addEventListener("keydown", (e) => {
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      button.focus();
    }
  });

  paint();
  return {
    root,
    button,
    value: () => selected,
    isOpen: () => open,
    setOpen,
  };
}
