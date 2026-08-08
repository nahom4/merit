import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { LibsqlEntityRepository, streamRegistry, type RegistryEntity } from '@merit/infrastructure';
import { wire } from '../composition.js';

/** The BMF is published as four regional files. Together they are the whole registry. */
const REGIONS = ['eo1.csv', 'eo2.csv', 'eo3.csv', 'eo4.csv'];

const BATCH = 5_000;

export const loadBmf = async (): Promise<void> => {
  const { config, db, logger } = await wire();
  const entities = new LibsqlEntityRepository(db);
  const directory = join(config.MERIT_DATA_DIR, 'bmf');

  let loaded = 0;
  for (const region of REGIONS) {
    const path = join(directory, region);
    if (!existsSync(path)) {
      logger.warn('registry file not present; skipping', { path });
      continue;
    }

    let batch: RegistryEntity[] = [];
    for await (const entity of streamRegistry(path)) {
      batch.push(entity);
      if (batch.length >= BATCH) {
        const written = await entities.upsertEntities(batch);
        if (!written.ok) throw new Error(written.error.message);
        loaded += batch.length;
        batch = [];
      }
    }
    if (batch.length > 0) {
      const written = await entities.upsertEntities(batch);
      if (!written.ok) throw new Error(written.error.message);
      loaded += batch.length;
    }
    logger.info('registry file loaded', { region, loaded });
  }

  logger.info('registry loaded', { entities: loaded });
};
