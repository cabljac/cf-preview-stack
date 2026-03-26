/** Parsed worker entry from the `workers` YAML input. */
export interface WorkerConfig {
  /** Path to the wrangler config file (e.g. ./api/wrangler.jsonc). */
  path: string;
  /** Working directory for wrangler commands. Inferred from config path if not specified. */
  workingDirectory: string;
}

/** A D1 database binding extracted from a wrangler config. */
export interface D1Binding {
  /** The binding name used in the Worker (e.g. DB). */
  binding: string;
  /** The original database name (e.g. mydb). */
  database_name: string;
  /** The database ID (UUID). */
  database_id: string;
  /** Optional path to migrations directory, relative to working directory. */
  migrations_dir?: string;
}

/** Parsed wrangler config with fields relevant to this action. */
export interface WranglerConfig {
  /** The worker name from the config. */
  name: string;
  /** D1 database bindings defined in the config. */
  d1_databases: D1Binding[];
}

/** Result of uploading a preview version of a worker. */
export interface PreviewResult {
  /** The worker name. */
  workerName: string;
  /** The preview URL (e.g. pr-42-api.your-subdomain.workers.dev). */
  previewUrl: string;
}

/** Result of provisioning a preview database. */
export interface DatabaseResult {
  /** The original database name from the wrangler config. */
  originalName: string;
  /** The preview database name (e.g. preview-pr-42-mydb). */
  previewName: string;
  /** The preview database UUID. */
  previewId: string;
  /** Number of migrations applied. */
  migrationsApplied: number;
}

/** All parsed action inputs. */
export interface ActionInputs {
  /** Cloudflare API token. */
  cloudflareApiToken: string;
  /** Cloudflare account ID. */
  cloudflareAccountId: string;
  /** Parsed worker configurations. */
  workers: WorkerConfig[];
  /** GitHub token for PR comments. */
  githubToken: string;
  /** Whether to post/update PR comments. */
  comment: boolean;
  /** Wrangler version to install. */
  wranglerVersion: string;
  /** Whether to run in cleanup mode. */
  cleanup: boolean;
}
