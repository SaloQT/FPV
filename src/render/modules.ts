import type { RenderModule } from './contracts';
import { createAtmosphereModule } from './atmosphere';
import { createObjectsModule } from './objects';
import { createRTModule } from './rt';
import { createTerrainModule } from './terrain';
import { createVegetationModule } from './vegetation';

/** The production module list; hook order within a frame is this array order. */
export function createDefaultModules(): RenderModule[] {
  return [createAtmosphereModule(), createTerrainModule(), createVegetationModule(), createObjectsModule(), createRTModule()];
}
