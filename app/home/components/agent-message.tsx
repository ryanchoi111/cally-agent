"use client";

import type { AgentResponseBlock } from "@/lib/types";

export function stripHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function renderInlineMarkdown(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }

    return part;
  });
}

export function MarkdownMessage({ content }: { content: string }) {
  const blocks = content.trim().split(/\n\s*\n/g);

  return (
    <div className="markdown-message">
      {blocks.map((block, blockIndex) => {
        const lines = block.split("\n").filter((line) => line.trim());
        const isUnorderedList = lines.every((line) => /^[-*]\s+/.test(line.trim()));
        const isNumberedList = lines.every((line) => /^\d+\.\s+/.test(line.trim()));

        if (isUnorderedList) {
          return (
            <ul key={blockIndex}>
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>
                  {renderInlineMarkdown(line.trim().replace(/^[-*]\s+/, ""))}
                </li>
              ))}
            </ul>
          );
        }

        if (isNumberedList) {
          return (
            <ol key={blockIndex}>
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>
                  {renderInlineMarkdown(line.trim().replace(/^\d+\.\s+/, ""))}
                </li>
              ))}
            </ol>
          );
        }

        if (lines.length === 1 && /^#{1,3}\s+/.test(lines[0].trim())) {
          return (
            <div className="markdown-heading" key={blockIndex}>
              {renderInlineMarkdown(lines[0].trim().replace(/^#{1,3}\s+/, ""))}
            </div>
          );
        }

        return (
          <p key={blockIndex}>
            {lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {renderInlineMarkdown(line)}
                {lineIndex < lines.length - 1 ? <br /> : null}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

export function ResponseBlocks({ blocks }: { blocks: AgentResponseBlock[] }) {
  if (!blocks.length) {
    return null;
  }

  return (
    <div className="response-blocks">
      {blocks.map((block, index) => {
        if (block.type === "summary") {
          return (
            <section className="response-block" key={`${block.type}-${index}`}>
              <div className="response-block-kicker">Summary</div>
              <div className="response-block-title">{block.title}</div>
              <p>{block.body}</p>
            </section>
          );
        }

        if (block.type === "recommendation_group" || block.type === "action_checklist") {
          return (
            <section className="response-block" key={`${block.type}-${index}`}>
              <div className="response-block-kicker">
                {block.type === "action_checklist" ? "Next steps" : "Recommendations"}
              </div>
              <div className="response-block-title">{block.title}</div>
              <ul>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{item}</li>
                ))}
              </ul>
            </section>
          );
        }

        if (block.type === "meeting_plan") {
          return (
            <section className="response-block" key={`${block.type}-${index}`}>
              <div className="response-block-kicker">Meeting plan</div>
              <div className="response-block-title">{block.title}</div>
              <div className="meeting-plan-grid">
                {block.groups.map((group, groupIndex) => (
                  <div className="meeting-plan-item" key={groupIndex}>
                    <div className="meeting-plan-label">{group.label}</div>
                    <div className="meeting-plan-recommendation">{group.recommendation}</div>
                    <div className="meeting-plan-rationale">{group.rationale}</div>
                  </div>
                ))}
              </div>
            </section>
          );
        }

        return (
          <section className="response-block" key={`${block.type}-${index}`}>
            <div className="response-block-kicker">Draft</div>
            <div className="response-block-title">{block.title}</div>
            <div className="response-block-audience">{block.audience}</div>
            <p className="response-block-draft">{block.body}</p>
          </section>
        );
      })}
    </div>
  );
}
