import { defaultCountriesDir, loadCountries } from "./config/load";
import { seed } from "./seed/seed";
import { InMemoryStore } from "./store/memory";
import type { Platform } from "./platform";

/**
 * Process-wide platform instance for the web application. The in-memory store
 * is seeded once per process. In the MVP this becomes a PostgresStore constructed
 * from DATABASE_URL and no seed runs in production.
 */
const g = globalThis as unknown as { __genelink?: Platform };

export function getPlatform(): Platform {
  if (!g.__genelink) {
    const countries = loadCountries(defaultCountriesDir());
    g.__genelink = seed(new InMemoryStore(), countries);
  }
  return g.__genelink;
}

export function resetPlatform(): Platform {
  const countries = loadCountries(defaultCountriesDir());
  g.__genelink = seed(new InMemoryStore(), countries);
  return g.__genelink;
}
