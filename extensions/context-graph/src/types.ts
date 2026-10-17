export type BrowserProvider = "chrome" | "playwright";
export interface ServerSpec {
  id: string;
  provider?: BrowserProvider;
  sessionId?: string;
  piManaged?: boolean;
  reuseExisting?: boolean;
  /** Attach to the exact saved process without changing registry metadata. */
  attachOnly?: boolean;
  managedProfile?: boolean;
  command?: string;
  args?: string[];
  mcpPath?: string;
  registry?: string;
  endpoint?: string;
  executablePath?: string;
  headless?: boolean;
}
export type BrowserOptions = Partial<ServerSpec> & {
  localMcpPath?: string;
  create?: boolean;
};
export interface BrowserPage {
  id: number;
  url: string;
  title?: string;
  selected?: boolean;
}
export interface TestAccount {
  server?: string;
  company?: string;
  user?: string;
  password?: string;
  environment?: string;
  source?: string;
}
export interface StoredAccount {
  server: string | null;
  company_code: string | null;
  account_id: string | null;
  password: string | null;
}
export interface ManualTestAccount {
  account: StoredAccount;
  replaces?: StoredAccount;
}
export interface TestAccountUpdate {
  target: TestAccount;
  candidateIndex?: number;
  revision: string;
}
export interface Attachment {
  id?: string;
  file_id?: string;
  owner_key?: string;
  account?: string;
  name?: string;
  size?: number | string;
  url?: string;
  type?: string;
  number?: string;
  postKey?: string;
  storage?: "ecdrive";
  oid?: string;
  attach_id?: string;
  ecdriveHid?: number | string;
  version?: string;
  sourceBizzSid?: string;
  sourceMenuSid?: string;
  [key: string]: unknown;
}
export interface ReaderOptions {
  signal?: AbortSignal;
  timeout?: number;
  testAccountUpdate?: TestAccountUpdate;
}
export interface PostReadOptions {
  includeParentJob?: boolean;
  includeParentJobMetadata?: boolean;
}
export interface FailedWidget {
  section: string;
  type: string;
  label: string;
  code: string;
}
export interface FailedAttachment {
  owner: string;
  expected: number;
  collected: number;
  code: string;
}
export interface DownloadOptions {
  signal?: AbortSignal;
  timeout?: number;
}
export interface LoginOptions {
  signal?: AbortSignal;
  attempts?: number;
  interval?: number;
}
