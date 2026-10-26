// Office layouts as data. An office is a w×h grid of 16px tiles holding rooms (rectangles; walls are generated
// around them) and furniture items. compile() turns one into the geometry the office runs on: walls, doors,
// walkability, desks, meeting rooms and every spot a cat can go. Pure ESM with no DOM, so the server imports it too.
// The entry point; the parts live in shared/layout/.
export * from './layout/compile.ts';
export * from './layout/schema.ts';
export * from './layout/validate.ts';
