// Kept so the Perth commands in docs/perth-import.md still work: the importer is shared by every city (scripts/places/import.mjs), and this runs it for Perth.
//   node scripts/perth/import.mjs <step> ...   is   node scripts/places/import.mjs <step> --city perth ...
if (!process.argv.includes('--city')) process.argv.push('--city', 'perth');
await import('../places/import.mjs');
