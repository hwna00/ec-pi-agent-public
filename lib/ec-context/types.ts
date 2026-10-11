export type BrowserProvider = "chrome" | "playwright";
export interface ServerSpec {
  id: string;
  provider?: BrowserProvider;
  sessionId?: string;
  piManaged?: boolean;
  reuseExisting?: boolean;
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
  [key: string]: unknown;
}
export interface ReaderOptions {
  workspace?: boolean;
  signal?: AbortSignal;
  timeout?: number;
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
