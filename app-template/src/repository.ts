export type RecordValue = string | number | boolean;

export interface EntityRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  values: Record<string, RecordValue>;
}

export interface Repository {
  list(): EntityRecord[];
  create(values: EntityRecord["values"]): EntityRecord;
  update(id: string, values: EntityRecord["values"]): EntityRecord;
  remove(id: string): void;
  restore(record: EntityRecord): void;
  clear(): void;
}

export interface LoadResult {
  records: EntityRecord[];
  recoveredFromInvalidData: boolean;
  storageAvailable: boolean;
}

export interface RepositoryBundle {
  repository: Repository;
  recoveredFromInvalidData: boolean;
  storageAvailable: boolean;
}

/** Derives the versioned storage namespace for a product from its name. */
export const storageKeyFor = (name: string): string =>
  `agent-cofounder:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:v1`;

/**
 * Single seam between the UI and its persistence backend. The UI depends only on
 * the {@link Repository} interface, so swapping browser storage for a REST API or
 * database means implementing that interface and returning it here — no component
 * changes required.
 */
export function createRepository(
  name: string,
  storage: Storage | undefined = typeof window === "undefined" ? undefined : window.localStorage,
): RepositoryBundle {
  const key = storageKeyFor(name);
  const loaded = LocalStorageRepository.load(key, storage);
  return {
    repository: new LocalStorageRepository(key, loaded.records, storage),
    recoveredFromInvalidData: loaded.recoveredFromInvalidData,
    storageAvailable: loaded.storageAvailable,
  };
}

const validRecord = (value: unknown): value is EntityRecord => {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<EntityRecord>;
  return typeof record.id === "string" && typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string" && Boolean(record.values) && typeof record.values === "object";
};

export class LocalStorageRepository implements Repository {
  constructor(
    private readonly key: string,
    private records: EntityRecord[],
    private readonly storage: Storage | undefined,
  ) {}

  static load(key: string, storage: Storage | undefined = typeof window === "undefined" ? undefined : window.localStorage): LoadResult {
    if (!storage) return { records: [], recoveredFromInvalidData: false, storageAvailable: false };
    try {
      const raw = storage.getItem(key);
      if (!raw) return { records: [], recoveredFromInvalidData: false, storageAvailable: true };
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.every(validRecord)) {
        return { records: [], recoveredFromInvalidData: true, storageAvailable: true };
      }
      return { records: parsed, recoveredFromInvalidData: false, storageAvailable: true };
    } catch {
      return { records: [], recoveredFromInvalidData: true, storageAvailable: true };
    }
  }

  list() { return [...this.records]; }

  create(values: EntityRecord["values"]) {
    const now = new Date().toISOString();
    const record = { id: crypto.randomUUID(), values, createdAt: now, updatedAt: now };
    const next = [record, ...this.records];
    this.persist(next);
    this.records = next;
    return record;
  }

  update(id: string, values: EntityRecord["values"]) {
    const existing = this.records.find((record) => record.id === id);
    if (!existing) throw new Error("That item no longer exists.");
    const updated = { ...existing, values, updatedAt: new Date().toISOString() };
    const next = this.records.map((record) => record.id === id ? updated : record);
    this.persist(next);
    this.records = next;
    return updated;
  }

  remove(id: string) {
    const next = this.records.filter((record) => record.id !== id);
    this.persist(next);
    this.records = next;
  }

  /** Re-insert a previously removed record with its original id and timestamps, powering undo. */
  restore(record: EntityRecord) {
    if (this.records.some((existing) => existing.id === record.id)) return;
    const next = [record, ...this.records];
    this.persist(next);
    this.records = next;
  }

  clear() {
    this.persist([]);
    this.records = [];
  }

  private persist(records: EntityRecord[]) {
    if (!this.storage) throw new Error("Browser storage is unavailable. Your change was not saved.");
    this.storage.setItem(this.key, JSON.stringify(records));
  }
}
