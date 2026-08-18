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
  clear(): void;
}

export interface LoadResult {
  records: EntityRecord[];
  recoveredFromInvalidData: boolean;
  storageAvailable: boolean;
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
    this.records = [record, ...this.records];
    this.persist();
    return record;
  }

  update(id: string, values: EntityRecord["values"]) {
    const existing = this.records.find((record) => record.id === id);
    if (!existing) throw new Error("That item no longer exists.");
    const updated = { ...existing, values, updatedAt: new Date().toISOString() };
    this.records = this.records.map((record) => record.id === id ? updated : record);
    this.persist();
    return updated;
  }

  remove(id: string) {
    this.records = this.records.filter((record) => record.id !== id);
    this.persist();
  }

  clear() {
    this.records = [];
    this.persist();
  }

  private persist() {
    if (!this.storage) throw new Error("Browser storage is unavailable. Your change was not saved.");
    this.storage.setItem(this.key, JSON.stringify(this.records));
  }
}
