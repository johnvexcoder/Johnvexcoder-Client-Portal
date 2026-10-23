import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type {
  FieldAnswer,
  FieldDefinition,
} from "../features/questionnaire/schema";
import type { PackageConfig } from "../features/packages/catalog";
import {
  parseItems,
  type ContentItem,
} from "../features/questionnaire/content-model";
export function ContentField({
  field,
  answer,
  config,
  id,
  onChange,
  onBlur,
}: {
  field: FieldDefinition;
  answer: FieldAnswer;
  config: PackageConfig;
  id: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  if (field.type === "collection") {
    let items: ContentItem[] = [];
    let invalid = false;
    try {
      items = answer.value ? parseItems(answer.value) : [];
    } catch {
      invalid = true;
    }
    if (invalid)
      return (
        <div className="error-panel">
          <p>
            This saved collection needs correction. Its original text is
            preserved below.
          </p>
          <textarea
            id={id}
            value={answer.value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
          />
        </div>
      );
    const cap =
      field.key === "projects"
        ? (config.maxProjects ?? 0)
        : (field.maxItems ?? 30);
    const write = (next: ContentItem[]) =>
      onChange(next.length ? JSON.stringify(next) : "");
    return (
      <div id={id} role="group" aria-label={field.label}>
        <div className="structured-items">
          {items.map((item, index) => (
            <article className="structured-item" key={item.id}>
              <div className="structured-item-header">
                <strong>
                  {field.label} · {index + 1}
                </strong>
                <div>
                  <button
                    type="button"
                    aria-label={`Move item ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() => {
                      const next = items.slice();
                      [next[index - 1], next[index]] = [
                        next[index],
                        next[index - 1],
                      ];
                      write(next);
                    }}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move item ${index + 1} down`}
                    disabled={index === items.length - 1}
                    onClick={() => {
                      const next = items.slice();
                      [next[index + 1], next[index]] = [
                        next[index],
                        next[index + 1],
                      ];
                      write(next);
                    }}
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove item ${index + 1}`}
                    onClick={() => write(items.filter((v) => v.id !== item.id))}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              {field.itemFields?.map((child) => (
                <label
                  key={child.key}
                  htmlFor={`${id}-${item.id}-${child.key}`}
                >
                  {child.label}
                  {child.required ? " *" : ""}
                  <ContentField
                    field={child}
                    answer={{
                      value: item.fields[child.key] ?? "",
                      status: "provided",
                    }}
                    config={config}
                    id={`${id}-${item.id}-${child.key}`}
                    onBlur={onBlur}
                    onChange={(value) =>
                      write(
                        items.map((v) =>
                          v.id === item.id
                            ? {
                                ...v,
                                fields: { ...v.fields, [child.key]: value },
                              }
                            : v,
                        ),
                      )
                    }
                  />
                  {child.help && <small>{child.help}</small>}
                </label>
              ))}
            </article>
          ))}
        </div>
        <button
          type="button"
          className="secondary collection-add"
          disabled={items.length >= cap}
          onClick={() =>
            write([...items, { id: crypto.randomUUID(), fields: {} }])
          }
        >
          <Plus size={14} />
          Add item · {items.length}/{cap}
        </button>
        {items.length >= cap && (
          <p className="muted small">Your package’s item limit is reached.</p>
        )}
      </div>
    );
  }
  if (field.type === "select")
    return (
      <select
        id={id}
        className="field-select"
        value={answer.value}
        onBlur={onBlur}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose an option…</option>
        {field.options?.map((option) => (
          <option key={option} value={option}>
            {option.replaceAll("_", " ")}
          </option>
        ))}
      </select>
    );
  if (field.type === "checkbox")
    return (
      <label className="inline-check">
        <input
          id={id}
          type="checkbox"
          checked={answer.value === "yes"}
          onBlur={onBlur}
          onChange={(e) => onChange(e.target.checked ? "yes" : "no")}
        />
        I confirm this.
      </label>
    );
  if (field.type === "multi") {
    let chosen: string[] = [];
    try {
      chosen = JSON.parse(answer.value || "[]");
    } catch {
      /* Invalid old value is not silently retained. */
    }
    return (
      <div
        className="multiselect-grid"
        id={id}
        role="group"
        aria-label={field.label}
      >
        {field.options?.map((option) => (
          <label key={option}>
            <input
              type="checkbox"
              checked={chosen.includes(option)}
              disabled={
                !chosen.includes(option) &&
                config.editableSections != null &&
                chosen.length >= config.editableSections
              }
              onBlur={onBlur}
              onChange={(e) =>
                onChange(
                  JSON.stringify(
                    e.target.checked
                      ? [...chosen, option]
                      : chosen.filter((v) => v !== option),
                  ),
                )
              }
            />
            {option}
          </label>
        ))}
      </div>
    );
  }
  if (["url", "text", "color", "destination"].includes(field.type ?? ""))
    return (
      <input
        id={id}
        type={field.type === "url" ? "url" : "text"}
        value={answer.value}
        maxLength={field.type === "url" ? 2048 : 12000}
        placeholder={
          field.type === "url"
            ? "https://…"
            : field.type === "color"
              ? "#142B4B"
              : ""
        }
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
    );
  return (
    <textarea
      id={id}
      aria-describedby={`help-${field.key}`}
      value={answer.value}
      rows={field.type === "routes" || field.type === "links" ? 5 : 4}
      maxLength={12000}
      placeholder="Share your thoughts here…"
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    />
  );
}
