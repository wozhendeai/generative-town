/**
 * Fixed Spritesheet Layout
 *
 * Defines structural slots for the spritesheet with predetermined positions,
 * sizes, categories, and connectivity. The LLM fills in semantic fields
 * (id and description) based on the theme.
 *
 * Architecture Decision:
 * - Structural layout is deterministic in TypeScript
 * - Prevents grid corruption, duplicate positions, invalid connectivity
 * - LLM focuses purely on creative naming and descriptions
 */

import type {
  Direction,
  ConnectivityType,
  SpriteCategory,
  Placement,
  Connectivity,
} from '../types';

/**
 * Structural slot - defines position and rules, LLM fills id + description
 */
export interface SpriteSlot {
  col: number;
  row: number;
  w: number;
  h: number;
  category: SpriteCategory;
  placement: Placement;
  connectivity: Connectivity;
  /** Hint for LLM describing what kind of sprite goes here */
  hint: string;
}

interface RoadConfig {
  connects: Direction[];
  type: ConnectivityType;
  hint: string;
}

interface GroundConfig {
  hint: string;
  walkable: boolean;
}

/**
 * Build all structural slots for the spritesheet.
 * Returns 52 slots: 8 roads + 8 grounds + 4 buildings (2x2) + 32 props
 */
export function buildLayoutSlots(): SpriteSlot[] {
  const slots: SpriteSlot[] = [];

  // ─────────────────────────────────────────────────────────────────
  // Row 0: Roads (8 slots) - connectivity is fixed, IDs are thematic
  // ─────────────────────────────────────────────────────────────────
  const roadConnections: RoadConfig[] = [
    { connects: ['east', 'west'], type: 'path', hint: 'horizontal road' },
    { connects: ['north', 'south'], type: 'path', hint: 'vertical road' },
    { connects: ['north', 'east'], type: 'corner', hint: 'road corner NE' },
    { connects: ['north', 'west'], type: 'corner', hint: 'road corner NW' },
    { connects: ['south', 'east'], type: 'corner', hint: 'road corner SE' },
    { connects: ['south', 'west'], type: 'corner', hint: 'road corner SW' },
    {
      connects: ['north', 'south', 'east', 'west'],
      type: 'intersection',
      hint: '4-way intersection',
    },
    { connects: ['south', 'east', 'west'], type: 'intersection', hint: 'T-junction (south)' },
  ];

  roadConnections.forEach((road, col) => {
    slots.push({
      col,
      row: 0,
      w: 1,
      h: 1,
      category: 'ground',
      placement: { layer: 'ground', walkable: true, anchor: 'top_left' },
      connectivity: { type: road.type, connects: road.connects },
      hint: road.hint,
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Row 1: Ground surfaces (8 slots) - generic for any theme
  // ─────────────────────────────────────────────────────────────────
  const groundHints: GroundConfig[] = [
    { hint: 'primary walkable surface', walkable: true },
    { hint: 'secondary walkable surface', walkable: true },
    { hint: 'decorative/accent ground', walkable: true },
    { hint: 'pathway/trail surface', walkable: true },
    { hint: 'rough/uneven terrain', walkable: true },
    { hint: 'damaged/worn surface', walkable: true },
    { hint: 'natural growth (moss/grass)', walkable: true },
    { hint: 'hazard zone (water/lava/void)', walkable: false },
  ];

  groundHints.forEach(({ hint, walkable }, col) => {
    slots.push({
      col,
      row: 1,
      w: 1,
      h: 1,
      category: 'ground',
      placement: { layer: 'ground', walkable, anchor: 'top_left' },
      connectivity: { type: 'none', connects: [] },
      hint,
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Rows 2-3: Buildings (4 slots, 2x2 each = 16 grid cells)
  // ─────────────────────────────────────────────────────────────────
  const buildingHints = [
    'main/important building',
    'secondary building',
    'small shop or house',
    'utility or special building',
  ];

  buildingHints.forEach((hint, i) => {
    slots.push({
      col: i * 2,
      row: 2,
      w: 2,
      h: 2,
      category: 'building',
      placement: { layer: 'object', walkable: false, anchor: 'bottom_center' },
      connectivity: { type: 'none', connects: [] },
      hint,
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Rows 4-7: Props (32 slots, 1x1 each)
  // ─────────────────────────────────────────────────────────────────
  const propHints = [
    // Row 4: Infrastructure
    'light source (lamp/torch/lantern)',
    'small container (bin/pot/urn)',
    'seating (bench/stool/log)',
    'signage (post/marker/banner)',
    'utility object A',
    'utility object B',
    'tall infrastructure',
    'wall-mounted or pipe',
    // Row 5: Nature/Vegetation
    'small tree or large plant',
    'bush or shrub',
    'potted plant or flowers',
    'ground cover (grass/leaves)',
    'small rock or stone',
    'large rock or boulder',
    'water feature (puddle/pond)',
    'natural growth (moss/fungi)',
    // Row 6: Containers/Barriers
    'storage container (crate/chest)',
    'barrel or drum',
    'large container (dumpster/cart)',
    'stacked items',
    'small barrier (cone/post)',
    'large barrier (fence/wall)',
    'ground detail (manhole/grate)',
    'floor decoration',
    // Row 7: Interactive/Decorative
    'vending/service machine',
    'communication device (booth/terminal)',
    'statue or monument',
    'fountain or water feature',
    'market stall or stand',
    'wheeled transport (cart/wagon)',
    'parked vehicle',
    'storage rack or holder',
  ];

  // Indices of walkable props (flat/small items)
  const walkablePropIndices = new Set([
    11, // ground cover
    14, // puddle
    22, // manhole/grate
    23, // floor decoration
  ]);

  propHints.forEach((hint, i) => {
    const col = i % 8;
    const row = 4 + Math.floor(i / 8);

    slots.push({
      col,
      row,
      w: 1,
      h: 1,
      category: 'prop',
      placement: {
        layer: 'object',
        walkable: walkablePropIndices.has(i),
        anchor: 'bottom_center',
      },
      connectivity: { type: 'none', connects: [] },
      hint,
    });
  });

  return slots;
}

/**
 * Get the total number of slots in the layout.
 */
export function getSlotCount(): number {
  return buildLayoutSlots().length;
}
