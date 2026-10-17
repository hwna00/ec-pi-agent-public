import { isMap, parseDocument } from "yaml";
import { SnapshotError } from "./graph.ts";
import type { ManualTestAccount, StoredAccount, TestAccount } from "./types.ts";

const fields = ["server", "company_code", "account_id", "password"] as const;

function header(markdown: string) {
  const match = markdown.match(
    /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m,
  );
  if (!match || match.index !== 0)
    throw new SnapshotError("Post frontmatter is missing");
  const document = parseDocument(match[1]);
  if (document.errors.length || !isMap(document.contents))
    throw new SnapshotError("Invalid post frontmatter");
  return { document, match, eol: match[0].includes("\r\n") ? "\r\n" : "\n" };
}

function account(value: unknown): StoredAccount {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((name) => !fields.includes(name as any))
  )
    throw new SnapshotError("Invalid test account entry");
  return Object.fromEntries(
    fields.map((field) => {
      const v = value[field];
      if (v != null && typeof v !== "string")
        throw new SnapshotError("Test account values must be strings or null");
      return [field, v == null ? null : field === "password" ? v : v.trim()];
    }),
  ) as unknown as StoredAccount;
}

export function parseAccounts(markdown: string): StoredAccount[] {
  const { document } = header(markdown);
  let values: unknown;
  try {
    values = document.toJS({ maxAliasCount: 100 }).test_accounts;
  } catch {
    throw new SnapshotError("Invalid test_accounts frontmatter");
  }
  if (values == null) return [];
  if (!Array.isArray(values))
    throw new SnapshotError("test_accounts must be a list");
  return values.map(account);
}

export function replaceAccounts(markdown: string, accounts: StoredAccount[]) {
  const { document, match, eol } = header(markdown);
  document.set("test_accounts", accounts.map(account));
  return (
    (markdown.startsWith("\uFEFF") ? "\uFEFF" : "") +
    "---" +
    eol +
    document.toString().replace(/\r?\n/g, eol) +
    "---" +
    eol +
    markdown.slice(match[0].length)
  );
}

export function storedAccount(target: TestAccount): StoredAccount {
  return account({
    server: target.server,
    company_code: target.company,
    account_id: target.user,
    password: target.password,
  });
}

export function targetAccount(stored: StoredAccount) {
  return {
    server: stored.server,
    company: stored.company_code,
    user: stored.account_id,
    password: stored.password,
  };
}

export const sameAccount = (a: StoredAccount, b: StoredAccount) =>
  fields.every((field) => a[field] === b[field]);
const sameIdentity = (a: StoredAccount, b: StoredAccount) =>
  fields.slice(0, 3).every((field) => a[field] === b[field]);

// Collected accounts stay fresh. Only values explicitly entered by the user
// override a matching source candidate and survive a later collection.
export function effectiveTestAccounts(
  sources: TestAccount[] = [],
  manual: ManualTestAccount[] = [],
) {
  const result = sources.map(storedAccount);
  for (const entry of manual) {
    const saved = account(entry.account),
      replaces = entry.replaces && account(entry.replaces);
    let index = replaces
      ? result.findIndex((candidate) => sameAccount(candidate, replaces))
      : -1;
    if (index < 0 && replaces)
      index = result.findIndex((candidate) =>
        sameIdentity(candidate, replaces),
      );
    if (index < 0)
      index = result.findIndex((candidate) => sameIdentity(candidate, saved));
    if (index < 0) result.push(saved);
    else result[index] = saved;
  }
  return result;
}
