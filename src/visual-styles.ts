import { RequestError } from './decision';
import type { SourceKey } from './types';

export const VISUAL_STYLES: { id: string; label: string; description: string; searches: Record<SourceKey, string> }[] = [
  { id: 'cinematic', label: 'Cinematic', description: 'Atmospheric photography, dramatic light and wide compositions', searches: { met: 'photograph', cosmos: 'cinematic photography', nasa: 'Earth from space', unsplash: 'cinematic light portrait', pexels: 'dramatic moody light', openverse: 'cinematic photography', flickr: 'cinematic street night', pinterest: 'cinematic aesthetic' } },
  { id: 'typography', label: 'Typography', description: 'Posters, expressive lettering and editorial graphics', searches: { met: 'poster', cosmos: 'experimental typography', nasa: 'mission poster', unsplash: 'lettering sign neon', pexels: 'typography poster wall', openverse: 'typography poster', flickr: 'signage lettering type', pinterest: 'typography poster design' } },
  { id: 'chrome', label: 'Chrome', description: 'Reflective metal, silver objects and polished surfaces', searches: { met: 'silver', cosmos: 'chrome sculpture', nasa: 'spacecraft hardware', unsplash: 'chrome reflection metal', pexels: 'metallic surface reflection', openverse: 'chrome metallic', flickr: 'chrome polished metal', pinterest: 'chrome aesthetic' } },
  { id: 'botanical', label: 'Botanical', description: 'Plants, organic forms and botanical studies', searches: { met: 'Anna Atkins', cosmos: 'botanical art', nasa: 'space plants', unsplash: 'leaves macro light', pexels: 'plant leaves shadow', openverse: 'botanical illustration', flickr: 'botanical macro leaves', pinterest: 'botanical illustration' } },
  { id: 'analog', label: 'Analog', description: 'Film photography, grain, archival paper and tactile print', searches: { met: 'photograph', cosmos: 'analog photography', nasa: 'Apollo photograph', unsplash: 'film grain analog', pexels: 'vintage film camera', openverse: 'analog film photography', flickr: '35mm film grain', pinterest: 'film photography aesthetic' } },
  { id: 'minimal', label: 'Minimal', description: 'Simple shapes, restrained color and negative space', searches: { met: 'geometric print', cosmos: 'minimal graphic design', nasa: 'moon surface', unsplash: 'minimal negative space', pexels: 'minimal architecture light', openverse: 'minimalist photography', flickr: 'minimal geometry', pinterest: 'minimal aesthetic' } },
  { id: 'surreal', label: 'Surreal', description: 'Unexpected scale, dreamlike forms and strange juxtapositions', searches: { met: 'surrealism', cosmos: 'surreal collage', nasa: 'nebula', unsplash: 'surreal fog landscape', pexels: 'dreamy surreal scene', openverse: 'surrealism', flickr: 'surreal dreamlike', pinterest: 'surreal art' } },
  { id: 'scientific', label: 'Scientific', description: 'Diagrams, specimens, technical drawings and instrument imagery', searches: { met: 'scientific drawing', cosmos: 'scientific diagram', nasa: 'scientific illustration', unsplash: 'laboratory glass instruments', pexels: 'laboratory science macro', openverse: 'scientific diagram', flickr: 'scientific specimen collection', pinterest: 'scientific illustration vintage' } },
];

export function validateStyles(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > VISUAL_STYLES.length || !value.every(id => typeof id === 'string' && VISUAL_STYLES.some(style => style.id === id))) {
    throw new RequestError('Choose styles from the available checkboxes.');
  }
  return [...new Set(value)] as string[];
}

export function styledBrief(brief: string, styles: string[]) {
  const selected = VISUAL_STYLES.filter(style => styles.includes(style.id));
  if (!selected.length) return brief;
  return `${brief}\n\nVisual direction: ${selected.map(style => `${style.label}: ${style.description}`).join('; ')}. Keep the original subject. Seek references that express these styles; do not substitute unrelated subjects.`;
}
