import { defaultCountriesDir, loadCountries } from "./config/load";
import { seed } from "./seed/seed";
import { InMemoryStore } from "./store/memory";
import { Platform } from "./platform";

/**
 * Process-wide platform instance for the web application. The in-memory store
 * is seeded once per process. In the MVP this becomes a PostgresStore constructed
 * from DATABASE_URL and no seed runs in production.
 *
 * GENELINK_SEED=none starts the instance empty instead, the way a fresh production
 * database starts: no personas, no listings, no cases. Everything is then created
 * through the product itself (register, publish, match, invite colleagues).
 */
const g = globalThis as unknown as { __genelink?: Platform };

function build(): Platform {
  const countries = loadCountries(defaultCountriesDir());
  return process.env.GENELINK_SEED === "none" ? new Platform(new InMemoryStore(), countries) : seed(new InMemoryStore(), countries);
}

export function getPlatform(): Platform {
  if (!g.__genelink) g.__genelink = build();
  return g.__genelink;
}

export function resetPlatform(): Platform {
  g.__genelink = build();
  return g.__genelink;
}
