import { parseDocument, DomUtils } from "htmlparser2";
import type { AnyNode, Element } from "domhandler";
import { decodeHTML } from "entities";
import { ParseError } from "./graph.ts";
export const tree = (source: string) =>
  parseDocument(source, { decodeEntities: true });
export const isElement = (node: AnyNode): node is Element => "name" in node;
export const textContent = (node: AnyNode): string =>
  DomUtils.textContent(node);
export function walk(node: AnyNode, visit: (node: Element) => void): void {
  if (isElement(node)) visit(node);
  if ("children" in node) for (const child of node.children) walk(child, visit);
}
export const escapeHTML = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const escapeMD = (value: string) => value.replace(/([\\`*_\[\]<>])/g, "\\$1");
const tokenKeys = new Set([
  "ec_req_sid",
  "__disablemin",
  "token",
  "access_token",
  "session",
  "sessionid",
  "session_id",
  "key",
  "timestamp",
  "v5q",
  "options",
  "xce",
]);
export function cleanURL(value: string, base: string): string {
  try {
    const url = new URL(decodeHTML(value || ""), base);
    if (!["https:", "http:", "mailto:", "tel:"].includes(url.protocol))
      return "";
    for (const k of [...url.searchParams.keys()])
      if (tokenKeys.has(k.toLowerCase())) url.searchParams.delete(k);
    if (url.hash.includes("=")) {
      const params = new URLSearchParams(url.hash.slice(1));
      for (const k of [...params.keys()])
        if (tokenKeys.has(k.toLowerCase())) params.delete(k);
      url.hash = params.toString();
    }
    return url.href;
  } catch {
    return "";
  }
}
const ignored = new Set([
  "script",
  "style",
  "button",
  "nav",
  "input",
  "select",
  "textarea",
]);
const voidTags = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
export function htmlToMarkdown(source: string, base: string): string {
  if (typeof source !== "string")
    throw new ParseError("Content must be HTML text");
  const protectedValues: string[] = [];
  const protect = (value: string) => {
    protectedValues.push(value);
    return "\0BLOCK" + (protectedValues.length - 1) + "\0";
  };
  const fence = (value: string, min: number) =>
    "`".repeat(
      Math.max(min, ...[...value.matchAll(/`+/g)].map((x) => x[0].length + 1)),
    );
  const tableHTML = (n: AnyNode): string => {
    if (!isElement(n))
      return n.type === "text" ? escapeHTML(textContent(n)) : "";
    if (ignored.has(n.name)) return "";
    const attrs = Object.entries(n.attribs)
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([k, v]) => {
        if (
          ["rowspan", "colspan", "alt", "title", "scope", "start"].includes(k)
        )
          return [[k, v]];
        const url = ["href", "src"].includes(k) ? cleanURL(v, base) : "";
        return url ? [[k, url]] : [];
      })
      .map(([k, v]) => " " + k + '="' + escapeHTML(v) + '"')
      .join("");
    return (
      "<" +
      n.name +
      attrs +
      ">" +
      (voidTags.has(n.name)
        ? ""
        : n.children.map(tableHTML).join("") + "</" + n.name + ">")
    );
  };
  const render = (n: AnyNode): string => {
    if (!isElement(n))
      return n.type === "text"
        ? escapeMD(textContent(n).replace(/\s+/g, " "))
        : "children" in n
          ? n.children.map(render).join("")
          : "";
    const tag = n.name,
      a = n.attribs;
    if (ignored.has(tag)) return "";
    if (tag === "pre") {
      const v = textContent(n).replace(/\r\n/g, "\n"),
        f = fence(v, 3);
      return "\n\n" + protect(f + "\n" + v + "\n" + f) + "\n\n";
    }
    if (tag === "code") {
      const v = textContent(n),
        f = fence(v, 1);
      return protect(f + " " + v + " " + f);
    }
    if (tag === "table") return "\n\n" + protect(tableHTML(n)) + "\n\n";
    if (tag === "ul" || tag === "ol") {
      const start = /^\d+$/.test(a.start || "1") ? Number(a.start || 1) : 1;
      return (
        "\n\n" +
        n.children
          .filter((x) => isElement(x) && x.name === "li")
          .map((x, i) => {
            const bullet = tag === "ol" ? start + i + ". " : "- ",
              v = (x as Element).children.map(render).join("").trim();
            return bullet + v.replace(/\n/g, "\n" + " ".repeat(bullet.length));
          })
          .join("\n") +
        "\n\n"
      );
    }
    const value = n.children.map(render).join("");
    if (tag === "a") {
      const url = cleanURL(a.href, base);
      return url
        ? "[" + (value.trim() || escapeMD(url)) + "](<" + url + ">)"
        : value;
    }
    if (tag === "img") {
      const url = cleanURL(a.src, base);
      return url
        ? "![" + escapeMD(a.alt || "") + "](<" + url + ">)"
        : escapeMD(a.alt || "");
    }
    if (
      ["video", "audio", "source", "iframe", "object", "embed"].includes(tag)
    ) {
      const url = cleanURL(a.src || a.data, base);
      return value + (url ? "\n[" + tag + "](<" + url + ">)\n" : "");
    }
    if (["strong", "b"].includes(tag)) return "**" + value + "**";
    if (["em", "i"].includes(tag)) return "*" + value + "*";
    if (["del", "s"].includes(tag)) return "~~" + value + "~~";
    if (tag === "br") return "  \n";
    if (tag === "hr") return "\n\n---\n\n";
    if (/^h[1-6]$/.test(tag))
      return "\n\n" + "#".repeat(Number(tag[1])) + " " + value.trim() + "\n\n";
    if (tag === "blockquote")
      return (
        "\n\n" +
        value
          .trim()
          .split("\n")
          .map((x) => "> " + x)
          .join("\n") +
        "\n\n"
      );
    if (
      ["p", "div", "section", "article", "header", "footer", "li"].includes(tag)
    )
      return "\n\n" + value.trim() + "\n\n";
    return value;
  };
  return render(tree(source))
    .trim()
    .replace(/\n(?:[ \t]*\n){2,}/g, "\n\n")
    .replace(/\0BLOCK(\d+)\0/g, (_, i) => protectedValues[Number(i)]);
}
export function plainText(source: string): string {
  const render = (n: AnyNode): string => {
    if (!isElement(n))
      return n.type === "text"
        ? textContent(n)
        : "children" in n
          ? n.children.map(render).join("")
          : "";
    if (["script", "style"].includes(n.name)) return "";
    const value = n.children.map(render).join("");
    if (["td", "th"].includes(n.name)) return "\t" + value;
    if (n.name === "img") return n.attribs.alt || "";
    return [
      "p",
      "div",
      "section",
      "article",
      "h1",
      "h2",
      "h3",
      "h4",
      "li",
      "tr",
      "table",
      "blockquote",
      "pre",
      "ul",
      "ol",
      "br",
      "hr",
    ].includes(n.name)
      ? "\n" + value + "\n"
      : value;
  };
  return render(tree(source)).trim();
}
